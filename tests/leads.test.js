import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseDomain, leadKey, scoreLead, parseLeads, dedupe, rankLeads, applyAudit,
  isVerified, worthApproaching, APPROACH_THRESHOLD
} from '../js/leadparse.js';
import { STATUSES, advance, dueFollowUps, counts, outcomeSummary, nextAction, isOpen } from '../js/pipeline.js';
import { buildTargetRequest, buildFindRequest, buildAuditRequest, buildApproachRequest, imageBlock, reachLine, REACH } from '../js/leads.js';

const campaign = { place: 'Bristol', reach: 'region', niche: 'small-batch food', platforms: 'Instagram, Shopify' };
const docs = { voice: 'Warm and plain.', work: 'Product ads from £250.' };

// ---- Scoring ----------------------------------------------------------------

test('a business is identified by its domain, however the link was written', () => {
  assert.equal(normaliseDomain('https://www.copperfig.co.uk/shop?a=1'), 'copperfig.co.uk');
  assert.equal(normaliseDomain('COPPERFIG.CO.UK'), 'copperfig.co.uk');
  assert.equal(normaliseDomain('not a url'), '');
  assert.equal(leadKey({ name: 'Copper Fig!', website: '' }), 'copper fig');
  assert.equal(leadKey({ name: 'Copper Fig', website: 'http://copperfig.co.uk' }), 'copperfig.co.uk');
});

test('tier A counts triggers two at a time and stops at four', () => {
  const t = n => Array.from({ length: n }, (_, i) => ({ label: `t${i}` }));
  assert.equal(scoreLead({ triggers: t(1) }).a, 2);
  assert.equal(scoreLead({ triggers: t(2) }).a, 4);
  assert.equal(scoreLead({ triggers: t(5) }).a, 4, 'capped');
});

test('a gap only scores once somebody has actually looked', () => {
  const guessed = { gaps: [{ label: 'flat photos', seen: false }, { label: 'no scenes', seen: false }] };
  assert.equal(scoreLead(guessed).b, 0);
  assert.equal(isVerified(guessed), false);
  const seen = { gaps: [{ label: 'flat photos', seen: true }, { label: 'no scenes', seen: true }] };
  assert.equal(scoreLead(seen).b, 2);
  assert.equal(isVerified(seen), true);
});

test('a trigger plus two seen gaps clears the approach threshold', () => {
  const lead = {
    triggers: [{ label: 'new product' }],
    gaps: [{ label: 'a', seen: true }, { label: 'b', seen: true }],
    pays: []
  };
  assert.equal(scoreLead(lead).total, 4 + 0);
  assert.equal(scoreLead(lead).a + scoreLead(lead).b, 4);
  const withMoney = { ...lead, pays: [{ label: 'stockists' }, { label: 'own shop' }] };
  assert.equal(scoreLead(withMoney).total, 6);
  assert.equal(worthApproaching(withMoney), true);
  assert.equal(worthApproaching(lead), false);
  assert.equal(APPROACH_THRESHOLD, 6);
});

// ---- Parsing ----------------------------------------------------------------

test('reads the lead list through the usual wrappers, and scores it', () => {
  const leads = parseLeads('Here they are:\n```json\n' + JSON.stringify({
    leads: [{
      name: ' Copper Fig ', what: 'preserves', area: 'Clifton', website: 'copperfig.co.uk',
      instagram: '@copperfig',
      triggers: [{ label: 'new product', detail: 'spiced pear line', date: 'September 2026', source: 'https://x' }],
      gaps: [{ label: 'white cutouts only', detail: 'jar on white', seen: false }],
      pays: [{ label: 'stockists', detail: 'four farm shops' }]
    }]
  }) + '\n```');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'Copper Fig');
  assert.equal(leads[0].instagram, 'copperfig', 'the @ is dropped');
  assert.deepEqual(leads[0].score, { a: 2, b: 0, c: 1, total: 3 });
});

test('a bare array works too, and an unusable reply explains itself', () => {
  assert.equal(parseLeads('[{"name":"A Shop","triggers":[]}]').length, 1);
  assert.throws(() => parseLeads('I could not find anything.'), /Couldn't read the list/);
  assert.throws(() => parseLeads('{"leads":[]}'), /Widen the area/);
});

test('the same business never arrives twice, and blocked ones never arrive at all', () => {
  const existing = [{ name: 'Copper Fig', website: 'https://copperfig.co.uk' }];
  const incoming = [
    { name: 'Copper Fig Preserves', website: 'http://www.copperfig.co.uk/shop' }, // same domain
    { name: 'Hearth & Grain', website: 'hearthgrain.com' },
    { name: 'Old Mill Bakery', website: 'oldmill.co.uk' }
  ];
  const { fresh, duplicates, skipped } = dedupe(incoming, existing, ['https://oldmill.co.uk']);
  assert.deepEqual(fresh.map(l => l.name), ['Hearth & Grain']);
  assert.deepEqual(duplicates.map(l => l.name), ['Copper Fig Preserves']);
  assert.deepEqual(skipped.map(l => l.name), ['Old Mill Bakery']);
});

test('ranking puts the best first, and the looked-at ahead of the guessed', () => {
  const make = (name, total, seen) => ({ name, score: { total }, gaps: [{ seen }] });
  const order = rankLeads([make('low', 3, true), make('guessed', 7, false), make('seen', 7, true)]);
  assert.deepEqual(order.map(l => l.name), ['seen', 'guessed', 'low']);
});

test('an audit replaces the guesses with what was seen and rescores', () => {
  const lead = {
    name: 'Copper Fig',
    triggers: [{ label: 'new product' }],
    gaps: [{ label: 'guessed thing', seen: false }],
    pays: []
  };
  const audited = applyAudit(lead, {
    gaps: [{ label: 'phone lighting', detail: 'overhead daylight, phone shadow' }, { label: 'no scene', detail: 'jars on white only' }],
    strengths: ['the label design is good']
  });
  assert.deepEqual(audited.gaps.map(g => g.seen), [true, true], 'the guess is gone');
  assert.equal(audited.score.b, 2);
  assert.equal(audited.score.total, 4);
  assert.deepEqual(audited.strengths, ['the label design is good']);
  assert.ok(audited.audited > 0);
});

// ---- Pipeline ---------------------------------------------------------------

test('approaching a lead stamps it and sets the one follow-up', () => {
  const now = Date.UTC(2026, 9, 12);
  const lead = advance({ name: 'x' }, 'approached', { now, note: 'emailed' });
  assert.equal(lead.status, 'approached');
  assert.equal(lead.approachedAt, now);
  assert.equal(lead.nextAt, now + 5 * 86400000);
  assert.equal(lead.nextAction, 'Follow up once, then stop');
  assert.equal(lead.touches.length, 1);
  // Won later: the approach stamp survives, and nothing is waiting.
  const won = advance(lead, 'won', { now: now + 86400000 });
  assert.equal(won.approachedAt, now);
  assert.equal(won.nextAt, 0);
  assert.equal(isOpen(won), false);
  assert.equal(won.touches.length, 2);
});

test('follow-ups come due, and closed leads never do', () => {
  const now = Date.UTC(2026, 9, 12);
  const waiting = advance({ name: 'a' }, 'approached', { now: now - 6 * 86400000 });
  const fresh = advance({ name: 'b' }, 'approached', { now });
  const dead = advance({ name: 'c' }, 'lost', { now: now - 30 * 86400000 });
  const due = dueFollowUps([waiting, fresh, dead], now);
  assert.deepEqual(due.map(l => l.name), ['a']);
  assert.equal(nextAction('won'), '');
});

test('counts cover every status', () => {
  const c = counts([{ status: 'new' }, { status: 'approached' }, { status: 'approached' }, {}]);
  assert.equal(c.total, 4);
  assert.equal(c.new, 2, 'a lead with no status is new');
  assert.equal(c.approached, 2);
  assert.equal(c.won, 0);
  assert.ok(STATUSES.every(s => s.id in c));
});

test('outcomes group by trigger, and a rate waits for ten approaches', () => {
  const lead = (trigger, status) => ({ triggers: [{ label: trigger }], status, approachedAt: 1 });
  const few = outcomeSummary([lead('new product', 'replied'), lead('hiring', 'lost')]);
  assert.equal(few.approached, 2);
  assert.equal(few.replied, 1);
  assert.equal(few.rate, null, 'too few to mean anything');
  const many = outcomeSummary([
    ...Array.from({ length: 6 }, () => lead('new product', 'replied')),
    ...Array.from({ length: 6 }, () => lead('hiring', 'lost'))
  ]);
  assert.equal(many.rate, 50);
  assert.equal(many.rows[0].trigger, 'new product');
  assert.equal(many.rows[0].replied, 6);
});

// ---- Prompts ----------------------------------------------------------------

test('the hunting ground, the place and the reach reach every prompt', () => {
  const target = buildTargetRequest(campaign, docs, new Date('2026-10-12T09:00:00Z'));
  assert.match(target, /Place: Bristol/);
  assert.match(target, /towns and districts around it/, 'the reach is spelled out');
  assert.match(target, /named places a list of these businesses can be found in Bristol/);
  assert.match(target, /12 October 2026/);
  assert.match(target, /Warm and plain\./, 'her voice document is there');
  assert.equal(reachLine('country', 'India'), REACH[2].line('India'));
});

test('Find is told what it already has, and never to describe unseen pictures', () => {
  const req = buildFindRequest(campaign, '## Searches to run\n`new bakery bristol`', { already: ['Copper Fig'], want: 15 });
  assert.match(req, /up to 15 real businesses/);
  assert.match(req, /- Copper Fig/);
  assert.match(req, /Never describe a photograph you\s*\n?have not seen/);
  assert.match(req, /"seen": false/);
  assert.match(req, /<plan>/);
  assert.doesNotMatch(buildFindRequest(campaign, ''), /<plan>/);
});

test('the audit asks only for what is in the picture', () => {
  const req = buildAuditRequest({ name: 'Copper Fig', what: 'preserves', area: 'Clifton' }, campaign);
  assert.match(req, /Describe only what is visible/);
  assert.match(req, /pictures are already good/, 'it is allowed to say they do not need her');
  assert.match(req, /Copper Fig, preserves, Clifton/);
});

test('screenshots become image blocks, and anything else is refused', () => {
  assert.deepEqual(imageBlock('data:image/png;base64,QQ=='), {
    type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' }
  });
  assert.equal(imageBlock('https://example.com/a.jpg'), null);
  assert.equal(imageBlock(''), null);
});

test('the approach may only mention pictures that were actually seen', () => {
  const base = {
    name: 'Copper Fig', what: 'preserves', area: 'Clifton',
    triggers: [{ label: 'new product', detail: 'spiced pear line', date: 'September 2026', source: 'https://x' }],
    pays: [{ label: 'stockists', detail: 'four farm shops' }]
  };
  const unseen = buildApproachRequest({ ...base, gaps: [{ label: 'flat', seen: false }] }, campaign, docs);
  assert.match(unseen, /must not say anything about them/);
  assert.match(unseen, /nobody has looked at their pictures yet/);

  const seen = buildApproachRequest({ ...base, gaps: [{ label: 'no scene', detail: 'jars on white', seen: true }] }, campaign, docs);
  assert.match(seen, /only one of them/);
  assert.match(seen, /- no scene: jars on white/);
  assert.match(seen, /\[set your price\]/, 'a missing rate is never invented');
  assert.match(seen, /Follow-up/);
});
