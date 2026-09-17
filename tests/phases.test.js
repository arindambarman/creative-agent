import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, buildContent, buildMessage } from '../js/phases.js';

const project = { brief: { client: 'Hearth & Grain', deadline: '3 October 2026' } };
const docs = { voice: 'Plain and warm.', work: 'Candles.', tools: 'Photoshop.' };
const today = new Date('2026-09-14T12:00:00Z');
const phase = id => PHASES.find(p => p.id === id);

test('includes today\'s date and the brief', () => {
  const text = buildMessage(phase('discover'), project, docs, {}, today);
  assert.match(text, /Today's date: 14 September 2026/);
  assert.match(text, /- Client: Hearth & Grain/);
});

test('Propose sits right after Discover, is optional, and later phases read it', () => {
  assert.deepEqual(PHASES.map(p => p.id), ['discover', 'propose', 'direct', 'plan', 'deliver', 'publish']);
  assert.equal(phase('propose').optional, true);
  const text = buildMessage(phase('direct'), project, docs, { discover: 'Research.', propose: '## Proposal\nHello' }, today);
  assert.match(text, /## Discover output[\s\S]*## Propose output[\s\S]*Hello/);
  assert.match(phase('plan').prompt, /Propose output/);
  assert.match(phase('publish').prompt, /never publish its price/);
});

test('every phase has a summary focus', () => {
  for (const p of PHASES) assert.ok(p.summary, `${p.id} has no summary focus`);
});

test('includes the original client request only when there is one', () => {
  const withRequest = buildMessage(phase('discover'), { brief: { ...project.brief, request: 'Need 3 posts.' } }, docs, {}, today);
  assert.match(withRequest, /## Original client request[\s\S]*<client_request>\nNeed 3 posts\.\n<\/client_request>/);
  assert.doesNotMatch(buildMessage(phase('discover'), project, docs, {}, today), /Original client request/);
});

test('earlier phases a phase does not need in full arrive as their summary', () => {
  const discover = '## Summary\n- Angle: quiet morning\n\n## Category landscape\nLong research text';
  const direct = '## Summary\n- Quiet morning #F4EDE1\n\n### Quiet morning\nLong direction text';
  const plan = buildMessage(phase('plan'), project, docs, { discover, direct }, today);
  assert.match(plan, /## Discover output \(summary\)\n\n- Angle: quiet morning/);
  assert.doesNotMatch(plan, /Long research text/);
  assert.match(plan, /## Direct output\n\n## Summary[\s\S]*Long direction text/); // Plan reads Direct in full

  const deliver = buildMessage(phase('deliver'), project, docs, { discover, direct }, today);
  assert.match(deliver, /## Direct output \(summary\)/);
  assert.doesNotMatch(deliver, /Long direction text/);
});

test('outputs saved before summaries existed are sent in full', () => {
  const text = buildMessage(phase('deliver'), project, docs, { discover: 'Old research, no summary.' }, today);
  assert.match(text, /## Discover output\n\nOld research, no summary\./);
});

test('every phase reads in full only phases that come before it', () => {
  PHASES.forEach((p, i) => {
    for (const id of p.readsInFull || []) {
      const at = PHASES.findIndex(x => x.id === id);
      assert.ok(at > -1 && at < i, `${p.id} reads ${id}, which does not come before it`);
    }
  });
});

test('studio block uses the one-hour cache, the last earlier output the five-minute cache', () => {
  const blocks = buildContent(phase('plan'), project, docs, { discover: 'Research.', direct: 'Two directions.' }, today);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(blocks[2].cache_control, { type: 'ephemeral' });
  assert.equal(blocks[3].cache_control, undefined);
});

test('first phase caches the studio and brief block only, on the five-minute cache', () => {
  const blocks = buildContent(phase('discover'), project, docs, {}, today);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(b => Boolean(b.cache_control)), [true, false]);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' }); // its tools make the prefix unshareable
  assert.match(blocks[1].text, /^# Your task/);
});

test('later phases also cache the latest earlier output, never the task', () => {
  const prior = { discover: 'Research.', direct: 'Two directions.' };
  const blocks = buildContent(phase('plan'), project, docs, prior, today);
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks.map(b => Boolean(b.cache_control)), [true, false, true, false]);
});

test('earlier blocks stay byte-identical from one phase to the next, so caches carry over', () => {
  const direct = buildContent(phase('direct'), project, docs, { discover: 'Research.' }, today);
  const plan = buildContent(phase('plan'), project, docs, { discover: 'Research.', direct: 'Two directions.' }, today);
  assert.equal(plan[0].text, direct[0].text);
  assert.equal(plan[1].text, direct[1].text);
});
