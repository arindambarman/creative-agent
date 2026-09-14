import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callModel, webSearchTool, splitEvents, cleanBlocks } from '../js/model.js';

// Build an SSE response body from a list of events, optionally split at awkward byte boundaries.
const sse = (events, { chunkSize = 17, failAfter = null } = {}) => {
  const text = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== null && sent >= failAfter) return controller.error(new TypeError('network error'));
      if (sent >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(sent, sent + chunkSize));
      sent += chunkSize;
    }
  });
};

const textTurn = (parts, stopReason = 'end_turn') => [
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...parts.map(t => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } },
  { type: 'message_stop' }
];

const fakeFetch = (responses) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
};

const baseArgs = { url: 'https://x', headers: {}, body: { model: 'm', messages: [{ role: 'user', content: 'brief' }] } };

test('picks the web search tool version for the model', () => {
  assert.equal(webSearchTool('claude-sonnet-4-6').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-opus-5').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-sonnet-5').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-opus-4-5').type, 'web_search_20250305');
  assert.equal(webSearchTool('claude-haiku-4-5').type, 'web_search_20250305');
});

test('splitEvents keeps an unfinished line for the next chunk', () => {
  const { events, rest } = splitEvents('data: {"type":"a"}\r\ndata: {"ty');
  assert.deepEqual(events, [{ type: 'a' }]);
  assert.equal(rest, 'data: {"ty');
});

test('streams text across chunk boundaries', async () => {
  const { impl } = fakeFetch([new Response(sse(textTurn(['## Angle\n', 'Warm ', 'amber'])))]);
  const seen = [];
  const result = await callModel({ ...baseArgs, fetchImpl: impl, onText: t => seen.push(t) });
  assert.equal(result.text, '## Angle\nWarm amber');
  assert.equal(result.incomplete, false);
  assert.equal(seen.at(-1), '## Angle\nWarm amber');
});

test('resumes a paused web search turn and sends the partial turn back', async () => {
  const paused = [
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching trends' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"candle ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'trends 2026"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://a' }] } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'pause_turn' } }
  ];
  const { impl, calls } = fakeFetch([new Response(sse(paused)), new Response(sse(textTurn(['## Findings'])))]);
  const searches = [];
  const result = await callModel({ ...baseArgs, fetchImpl: impl, onSearch: q => searches.push(q) });

  assert.deepEqual(searches, ['candle trends 2026']);
  assert.equal(calls.length, 2);
  const resumed = calls[1].messages;
  assert.equal(resumed.length, 2);
  assert.equal(resumed[1].role, 'assistant');
  assert.deepEqual(resumed[1].content.map(b => b.type), ['text', 'server_tool_use', 'web_search_tool_result']);
  assert.deepEqual(resumed[1].content[1].input, { query: 'candle trends 2026' });
  assert.ok(!('_json' in resumed[1].content[1]));
  // Text after the search starts on its own paragraph.
  assert.equal(result.text, 'Searching trends\n\n## Findings');
});

test('citations are kept on text blocks for resumed turns', () => {
  const blocks = [{ type: 'text', text: '', citations: [] }, undefined, { type: 'text', text: 'x', citations: [{ url: 'u' }] }];
  assert.deepEqual(cleanBlocks(blocks), [{ type: 'text', text: 'x', citations: [{ url: 'u' }] }]);
});

test('flags output that hit the length limit', async () => {
  const { impl } = fakeFetch([new Response(sse(textTurn(['Half a plan'], 'max_tokens')))]);
  const result = await callModel({ ...baseArgs, fetchImpl: impl });
  assert.equal(result.incomplete, true);
  assert.equal(result.stopReason, 'max_tokens');
});

test('a dropped connection keeps the text written so far', async () => {
  const events = textTurn(['First section. ', 'Second section. ', 'Third section.']);
  const { impl } = fakeFetch([new Response(sse(events, { chunkSize: 40, failAfter: 400 }))]);
  await assert.rejects(callModel({ ...baseArgs, fetchImpl: impl }), e => {
    assert.equal(e.name, 'RunError');
    assert.ok(e.partial.startsWith('First section.'), `partial was: ${e.partial}`);
    assert.match(e.message, /Lost the connection/);
    return true;
  });
});

test('stopping a run is reported as aborted, not as an error', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { impl } = fakeFetch([abort]);
  await assert.rejects(callModel({ ...baseArgs, fetchImpl: impl }), e => e.aborted === true && e.message === 'Run stopped.');
});

test('HTTP errors surface the API message', async () => {
  const { impl } = fakeFetch([new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })]);
  await assert.rejects(callModel({ ...baseArgs, fetchImpl: impl }), /Request failed \(401\)\. invalid x-api-key/);
});

test('error events mid-stream fail the run', async () => {
  const events = [...textTurn(['Some']).slice(0, 3), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }];
  const { impl } = fakeFetch([new Response(sse(events))]);
  await assert.rejects(callModel({ ...baseArgs, fetchImpl: impl }), e => e.message === 'Overloaded' && e.partial === 'Some');
});

test('an empty response is an error', async () => {
  const { impl } = fakeFetch([new Response(sse(textTurn([])))]);
  await assert.rejects(callModel({ ...baseArgs, fetchImpl: impl }), /empty response/);
});

test('stops resuming after the continuation limit', async () => {
  const pause = () => new Response(sse(textTurn(['.'], 'pause_turn')));
  const { impl, calls } = fakeFetch(Array.from({ length: 10 }, pause));
  const result = await callModel({ ...baseArgs, fetchImpl: impl });
  assert.equal(calls.length, 6);
  assert.equal(result.stopReason, 'pause_turn');
  assert.equal(result.incomplete, true);
});
