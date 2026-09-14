// Calls the Messages API and streams the answer back.
//
// Handles what goes wrong on long runs: web search turns that pause and need resuming,
// outputs that hit the length limit, and connections that drop or are stopped halfway.
// When a run fails, the text written so far travels on the error so it can be kept.
//
// No DOM access and fetch is injectable, so this can be tested in Node.

const MAX_CONTINUATIONS = 5;

export class RunError extends Error {
  constructor(message, partial = '', aborted = false) {
    super(message);
    this.name = 'RunError';
    this.partial = partial;
    this.aborted = aborted;
  }
}

// Newer models get the web search tool with dynamic filtering; older ones the basic one.
export function webSearchTool(model) {
  const dynamic = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable-|mythos-)/.test(model);
  return { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 10 };
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
  return { blocks: [], text: priorText, stopReason: null, lastType };
}

export function applyEvent(turn, ev, on = {}) {
  switch (ev.type) {
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
        try { block.input = JSON.parse(block._json || '{}'); } catch (e) { block.input = {}; }
        delete block._json;
        if (block.type === 'server_tool_use' && block.input?.query) on.search?.(block.input.query);
      }
      break;
    }
    case 'message_delta':
      turn.stopReason = ev.delta?.stop_reason ?? turn.stopReason;
      break;
    case 'error':
      throw new Error(ev.error?.message || 'The model returned an error.');
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
    return new RunError(`Lost the connection to the server (${e.message}). Check your connection and run again.`, partial);
  }
  return new RunError(e?.message || 'The run failed for an unknown reason.', partial);
}

export async function callModel({ url, headers, body, signal, onText, onSearch, fetchImpl = fetch }) {
  const messages = [...body.messages];
  let text = '', lastType = null;

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ ...body, messages }), signal });
    } catch (e) {
      throw toRunError(e, text);
    }
    if (!res.ok) {
      let detail = '';
      const raw = await res.text().catch(() => '');
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch (e) { detail = raw; }
      throw new RunError(`Request failed (${res.status}). ${detail}`.trim(), text);
    }

    const turn = createTurn(text, lastType);
    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = splitEvents(buf);
        buf = rest;
        for (const ev of events) applyEvent(turn, ev, { text: onText, search: onSearch });
      }
      if (buf.trim()) for (const ev of splitEvents(buf + '\n').events) applyEvent(turn, ev, { text: onText, search: onSearch });
    } catch (e) {
      throw toRunError(e, turn.text);
    }
    text = turn.text;
    lastType = turn.lastType;

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
      stopReason: turn.stopReason,
      incomplete: ['max_tokens', 'pause_turn', 'refusal'].includes(turn.stopReason)
    };
  }
}
