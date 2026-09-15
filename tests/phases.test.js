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

test('first phase caches the studio and brief block only', () => {
  const blocks = buildContent(phase('discover'), project, docs, {}, today);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(b => Boolean(b.cache_control)), [true, false]);
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
