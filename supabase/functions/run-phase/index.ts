// Creative Agent — run-phase edge function
//
// This is the only place the Anthropic API key exists. The browser never sees it.
// Deploy with:  supabase functions deploy run-phase
// Set the key:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Lock origins: supabase secrets set ALLOWED_ORIGINS=https://you.github.io
//               (comma-separated; while unset, any origin is allowed)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

function corsHeaders(origin: string): Record<string, string> {
  const allow = ALLOWED_ORIGINS.length === 0 ? '*'
    : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  const CORS = corsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405);
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: { message: 'This site is not allowed to call the function.' } }, 403);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: { message: 'Server is missing ANTHROPIC_API_KEY.' } }, 500);

  // Identify the caller from their Supabase session.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: { message: 'Sign in to run a phase.' } }, 401);

  // Monthly budget check.
  const [{ data: profile }, { data: used }] = await Promise.all([
    supabase.from('profiles').select('monthly_token_budget').eq('id', user.id).single(),
    supabase.rpc('tokens_used_this_month', { uid: user.id })
  ]);
  const budget = profile?.monthly_token_budget ?? 1_000_000;
  if (Number(used ?? 0) >= budget) {
    return json({ error: { message: 'You have reached this month\'s usage limit. Ask the site owner to raise it.' } }, 429);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: { message: 'Invalid JSON body.' } }, 400); }
  if (!Array.isArray(body.messages)) return json({ error: { message: 'Request is missing messages.' } }, 400);

  // Only forward fields we expect, cap what the client can ask for, and allow web search only.
  const tools = Array.isArray(body.tools)
    ? (body.tools as Array<{ type?: unknown }>).filter((t) => typeof t?.type === 'string' && t.type.startsWith('web_search_'))
    : [];
  const payload = {
    model: typeof body.model === 'string' ? body.model : 'claude-sonnet-4-6',
    max_tokens: Math.min(Number(body.max_tokens) || 8000, 16000),
    stream: true,
    system: body.system,
    messages: body.messages,
    ...(tools.length ? { tools } : {})
  };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    let message = detail;
    try { message = JSON.parse(detail)?.error?.message ?? detail; } catch { /* not JSON */ }
    return json({ error: { message: `Model request failed (${upstream.status}). ${message}`.trim() } }, upstream.status || 502);
  }

  // usage_log is read-only to users under row-level security, so writes use the service role.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Pass the stream straight through, watching for the usage totals as they go by
  // so we can record them after the response finishes.
  let inTok = 0, outTok = 0, buffer = '';
  const decoder = new TextDecoder();
  const meter = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === 'message_start') inTok = ev.message?.usage?.input_tokens ?? 0;
          if (ev.type === 'message_delta') {
            outTok = ev.usage?.output_tokens ?? outTok;
            inTok = ev.usage?.input_tokens ?? inTok;
          }
        } catch { /* partial event, ignore */ }
      }
    },
    async flush() {
      // The browser writes the phase output itself once streaming finishes.
      // All this needs to record is what the run cost.
      const { error } = await admin.from('usage_log').insert({
        user_id: user.id,
        phase: typeof body.phase === 'string' ? body.phase : null,
        input_tokens: inTok,
        output_tokens: outTok
      });
      if (error) console.error('usage_log insert failed:', error.message);
    }
  });

  return new Response(upstream.body.pipeThrough(meter), {
    headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
});
