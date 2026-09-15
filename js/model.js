// Calls the Messages API and streams the answer back.
//
// Handles what goes wrong on long runs: web search turns that pause and need resuming,
// outputs that hit the length limit, and connections that drop or are stopped halfway.
// When a run fails, the text written so far travels on the error so it can be kept.
//
// No DOM access and fetch is injectable, so this can be tested in Node.

const MAX_CONTINUATIONS = 5;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const RETRYABLE_STATUS = [429, 500, 502, 503, 504, 529];
const RETRYABLE_ERROR_TYPES = ['overloaded_error', 'api_error', 'rate_limit_error'];

export class RunError extends Error {
  constructor(message, partial = '', aborted = false) {
    super(message);
    this.name = 'RunError';
    this.partial = partial;
    this.aborted = aborted;
  }
}

// Newer models get the web search tool with dynamic filtering; older ones the basic one.
export function webSearchTool(model, maxUses = 10) {
  const dynamic = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable-|mythos-)/.test(model);
  return { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: maxUses };
}

// Split buffered SSE text into parsed events, returning the unfinished tail.
export function splitEvents(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop();
  const events = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try { events.push(JSON.parse(raw)); } catch (e) { /* not an event, skip */ }
  }
  return { events, rest };
}

// One response's worth of state. Content blocks are rebuilt from the stream so a paused
// turn can be sent back exactly; `text` carries on from earlier turns in the same run.
export function createTurn(priorText = '', lastType = null) {
  return { blocks: [], text: priorText, stopReason: null, lastType, usage: emptyUsage() };
}

export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 });

// Usage counts in message_start and message_delta are running totals for that response.
function readUsage(target, u) {
  if (!u) return;
  if (u.input_tokens != null) target.input = u.input_tokens;
  if (u.output_tokens != null) target.output = u.output_tokens;
  if (u.cache_read_input_tokens != null) target.cacheRead = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens != null) target.cacheWrite = u.cache_creation_input_tokens;
  if (u.server_tool_use?.web_search_requests != null) target.searches = u.server_tool_use.web_search_requests;
}

export function addUsage(a, b) {
  return {
    input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite, searches: a.searches + b.searches
  };
}

// Dollars for a run. Cache reads bill at 0.1x input, 5-minute cache writes at 1.25x.
export function costOf(usage, price, searchPrice = 0.01) {
  const perToken = n => n / 1e6;
  return perToken(usage.input) * price.input
    + perToken(usage.cacheRead) * price.input * 0.1
    + perToken(usage.cacheWrite) * price.input * 1.25
    + perToken(usage.output) * price.output
    + usage.searches * searchPrice;
}

export function applyEvent(turn, ev, on = {}) {
  switch (ev.type) {
    case 'message_start':
      readUsage(turn.usage, ev.message?.usage);
      break;
    case 'content_block_start': {
      const block = { ...ev.content_block };
      if (block.type === 'text') {
        block.text = block.text || '';
        // Text resuming after a search would otherwise run straight on from the text before it.
        if (turn.lastType && turn.lastType !== 'text' && turn.text && !turn.text.endsWith('\n')) {
          turn.text += '\n\n';
        }
      }
      if (block.type === 'thinking') { block.thinking = block.thinking || ''; block.signature = block.signature || ''; }
      if (block.type === 'server_tool_use' || block.type === 'tool_use') block._json = '';
      turn.blocks[ev.index] = block;
      if (block.type !== 'thinking') turn.lastType = block.type;
      break;
    }
    case 'content_block_delta': {
      const block = turn.blocks[ev.index];
      const d = ev.delta || {};
      if (!block) break;
      if (d.type === 'text_delta') {
        block.text += d.text;
        turn.text += d.text;
        on.text?.(turn.text);
      } else if (d.type === 'input_json_delta') {
        block._json += d.partial_json;
      } else if (d.type === 'citations_delta') {
        (block.citations ??= []).push(d.citation);
      } else if (d.type === 'thinking_delta') {
        block.thinking += d.thinking;
      } else if (d.type === 'signature_delta') {
        block.signature += d.signature;
      }
      break;
    }
    case 'content_block_stop': {
      const block = turn.blocks[ev.index];
      if (block && '_json' in block) {
        // Searches run from code execution arrive with input already filled in and no deltas.
        if (block._json) {
          try { block.input = JSON.parse(block._json); } catch (e) { block.input = block.input ?? {}; }
        } else {
          block.input = block.input ?? {};
        }
        delete block._json;
        if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input.query) {
          on.search?.(block.input.query);
        }
      }
      break;
    }
    case 'message_delta':
      turn.stopReason = ev.delta?.stop_reason ?? turn.stopReason;
      readUsage(turn.usage, ev.usage);
      break;
    case 'error': {
      const err = new Error(ev.error?.message || 'The model returned an error.');
      err.retryable = RETRYABLE_ERROR_TYPES.includes(ev.error?.type);
      throw err;
    }
  }
}

// Blocks ready to send back as an assistant turn: no gaps, no empty text, no parse scratch.
export function cleanBlocks(blocks) {
  return blocks
    .filter(b => b && !(b.type === 'text' && !b.text))
    .map(({ _json, ...b }) => b);
}

function toRunError(e, partial) {
  if (e instanceof RunError) return e;
  if (e?.name === 'AbortError') return new RunError('Run stopped.', partial, true);
  if (e instanceof TypeError) {
    const err = new RunError(`Lost the connection to the server (${e.message}). Check your connection and run again.`, partial);
    err.retryable = true;
    return err;
  }
  const err = new RunError(e?.message || 'The run failed for an unknown reason.', partial);
  err.retryable = Boolean(e?.retryable);
  return err;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

// Rejects if `promise` doesn't settle within `ms`. The API sends ping events while it works,
// so a long silence means the connection has stalled rather than the model being slow.
function withIdleLimit(promise, ms, onStall) {
  let timer;
  const stall = new Promise((_, reject) => {
    // Reject before cleaning up: cancelling a reader settles its pending read at once.
    timer = setTimeout(() => { reject(new StallError()); onStall?.(); }, ms);
  });
  return Promise.race([promise, stall]).finally(() => clearTimeout(timer));
}

class StallError extends Error {}

// One request and its stream. Throws a RunError carrying the text so far on any failure.
async function requestTurn({ url, headers, body, messages, signal, onText, onSearch, fetchImpl, idleMs, text, lastType }) {
  const stalled = partial => new RunError(
    `The connection went quiet for ${Math.round(idleMs / 1000)} seconds, so the run was stopped. Run again, or keep what was written.`,
    partial
  );
  // One controller per request, so a stall can cancel it while Stop still works.
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort();
  signal?.addEventListener('abort', forwardAbort);
  if (signal?.aborted) ctrl.abort();

  const turn = createTurn(text, lastType);
  try {
    let res;
    try {
      res = await withIdleLimit(
        fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ ...body, messages }), signal: ctrl.signal }),
        idleMs, () => ctrl.abort()
      );
    } catch (e) {
      throw e instanceof StallError ? stalled(text) : toRunError(e, text);
    }
    if (!res.ok) {
      let detail = '';
      const raw = await res.text().catch(() => '');
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch (e) { detail = raw; }
      const err = new RunError(`Request failed (${res.status}). ${detail}`.trim(), text);
      err.retryable = RETRYABLE_STATUS.includes(res.status);
      throw err;
    }

    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await withIdleLimit(reader.read(), idleMs, () => {
          ctrl.abort();
          reader.cancel().catch(() => {});
        });
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = splitEvents(buf);
        buf = rest;
        for (const ev of events) applyEvent(turn, ev, { text: onText, search: onSearch });
      }
      if (buf.trim()) for (const ev of splitEvents(buf + '\n').events) applyEvent(turn, ev, { text: onText, search: onSearch });
    } catch (e) {
      const err = e instanceof StallError ? stalled(turn.text) : toRunError(e, turn.text);
      err.usage = turn.usage; // tokens streamed before a failure are still billed
      throw err;
    }
    return turn;
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function callModel({
  url, headers, body, signal, onText, onSearch, onRetry,
  fetchImpl = fetch, idleMs = 120000, retryDelays = RETRY_DELAYS_MS
}) {
  const messages = [...body.messages];
  let text = '', lastType = null, usage = emptyUsage();

  for (let attempt = 0; ; attempt++) {
    let turn;
    for (let retry = 0; ; retry++) {
      try {
        turn = await requestTurn({ url, headers, body, messages, signal, onText, onSearch, fetchImpl, idleMs, text, lastType });
        break;
      } catch (e) {
        if (e.usage) usage = addUsage(usage, e.usage);
        e.usage = usage;
        if (!e.retryable || retry >= retryDelays.length) throw e;
        // Discard this request's half-written turn and send the same request again.
        onText?.(text);
        onRetry?.(retry + 1, retryDelays[retry], e.message);
        try { await wait(retryDelays[retry], signal); } catch (abort) { throw new RunError('Run stopped.', e.partial || text, true); }
      }
    }
    text = turn.text;
    lastType = turn.lastType;
    usage = addUsage(usage, turn.usage);

    // Long web search turns pause; sending the partial turn back lets the server carry on.
    if (turn.stopReason === 'pause_turn' && attempt < MAX_CONTINUATIONS) {
      messages.push({ role: 'assistant', content: cleanBlocks(turn.blocks) });
      continue;
    }

    if (!text.trim()) {
      throw new RunError(turn.stopReason === 'refusal'
        ? 'The model declined this request. Check the brief for anything that could read as harmful, then run again.'
        : 'The model returned an empty response. Try running the phase again.');
    }
    return {
      text,
      usage,
      stopReason: turn.stopReason,
      incomplete: ['max_tokens', 'pause_turn', 'refusal'].includes(turn.stopReason)
    };
  }
}
