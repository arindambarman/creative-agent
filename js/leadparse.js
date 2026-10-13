// Reading the model's lead list, and the arithmetic that ranks it.
//
// The rubric lives here rather than in the prompt on purpose: the model supplies evidence, the
// code does the scoring, so two runs a week apart are comparable and a score can always be
// explained by pointing at the lines that produced it.
//
// Tier A (0-4): triggers — a reason to buy this month, each with a date and a source.
// Tier B (0-4): gaps — what their pictures are not doing. Only counted from something seen.
// Tier C (0-2): can they pay.
//
// No DOM access, so this can be tested in Node.

export const APPROACH_THRESHOLD = 6;
export const CAPS = { a: 4, b: 4, c: 2 };
export const TRIGGER_POINTS = 2; // each trigger is worth two, so two triggers fill tier A

const clean = v => (typeof v === 'string' ? v.trim() : '');
const list = v => (Array.isArray(v) ? v : []);

// "https://www.copperfig.co.uk/shop?a=1" -> "copperfig.co.uk". Used as the identity of a
// business, since the same shop turns up under several names across different lists.
export function normaliseDomain(url) {
  const s = String(url ?? '').trim().toLowerCase();
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?:[:/?#]|$)/.exec(s);
  if (!m) return '';
  return m[1].replace(/\.$/, '');
}

// A business is the same business if the domain matches, or failing that the name.
export const leadKey = lead =>
  normaliseDomain(lead?.website) || String(lead?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function scoreLead(lead) {
  const triggers = list(lead?.triggers).length;
  // A gap only counts once it has actually been looked at. Search results describe a business;
  // they do not show you its photographs.
  const gaps = list(lead?.gaps).filter(g => g?.seen).length;
  const pays = list(lead?.pays).length;
  const a = Math.min(triggers * TRIGGER_POINTS, CAPS.a);
  const b = Math.min(gaps, CAPS.b);
  const c = Math.min(pays, CAPS.c);
  return { a, b, c, total: a + b + c };
}

export const isVerified = lead => list(lead?.gaps).some(g => g?.seen);
export const worthApproaching = lead => scoreLead(lead).total >= APPROACH_THRESHOLD;

// Everything the model may return about one candidate, with every field given a safe shape.
export function normaliseLead(raw, index = 0) {
  const evidence = e => ({
    label: clean(e?.label) || clean(e?.signal) || clean(e?.observation) || 'Signal',
    detail: clean(e?.detail) || clean(e?.evidence) || '',
    date: clean(e?.date),
    source: clean(e?.source),
    seen: Boolean(e?.seen)
  });
  const lead = {
    name: clean(raw?.name) || `Candidate ${index + 1}`,
    what: clean(raw?.what) || clean(raw?.sells),
    area: clean(raw?.area) || clean(raw?.place),
    website: clean(raw?.website),
    instagram: clean(raw?.instagram).replace(/^@/, ''),
    contact: clean(raw?.contact),
    size: clean(raw?.size),
    triggers: list(raw?.triggers).map(evidence).filter(t => t.detail || t.date || t.source),
    // Anything the model believes about their pictures arrives unseen until an audit confirms it.
    gaps: list(raw?.gaps).map(g => ({ ...evidence(g), seen: Boolean(g?.seen) })),
    pays: list(raw?.pays).map(evidence),
    skip: clean(raw?.skip), // a disqualifier the model spotted, e.g. an agency credit
    note: clean(raw?.note)
  };
  return { ...lead, score: scoreLead(lead) };
}

// Tolerant of the usual wrappers: fenced json, a sentence before the object, a bare array.
export function parseLeads(text) {
  const raw = String(text ?? '');
  const start = raw.search(/[{[]/);
  if (start === -1) throw new Error("Couldn't read the list of businesses. Run the search again.");
  const open = raw[start];
  const end = raw.lastIndexOf(open === '[' ? ']' : '}');
  if (end <= start) throw new Error("Couldn't read the list of businesses. Run the search again.");
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch (e) {
    throw new Error("Couldn't read the list of businesses. Run the search again.");
  }
  const found = Array.isArray(data) ? data : list(data?.leads || data?.businesses || data?.candidates);
  const leads = found.map(normaliseLead).filter(l => l.name && !/^candidate \d+$/.test(l.name));
  if (!leads.length) throw new Error('No businesses came back. Widen the area or the category, then search again.');
  return leads;
}

// Keeps the list honest: never the same business twice, never one already approached, never
// one on the do-not-contact list.
export function dedupe(incoming, existing = [], doNotContact = []) {
  const seen = new Map();
  for (const lead of existing) seen.set(leadKey(lead), lead);
  const blocked = new Set(doNotContact.map(d => normaliseDomain(d) || String(d ?? '').toLowerCase().trim()).filter(Boolean));
  const fresh = [], duplicates = [], skipped = [];
  for (const lead of incoming) {
    const key = leadKey(lead);
    if (!key) continue;
    if (blocked.has(key)) { skipped.push(lead); continue; }
    if (seen.has(key)) { duplicates.push(lead); continue; }
    seen.set(key, lead);
    fresh.push(lead);
  }
  return { fresh, duplicates, skipped };
}

// Highest score first; within a score, the ones that have been looked at, then the newest.
export function rankLeads(leads) {
  return [...(leads || [])].sort((x, y) =>
    (y.score?.total ?? 0) - (x.score?.total ?? 0)
    || Number(isVerified(y)) - Number(isVerified(x))
    || (y.created ?? 0) - (x.created ?? 0));
}

// Merges an audit's findings into a lead: its gaps are seen, so they count towards tier B.
export function applyAudit(lead, audit) {
  const gaps = list(audit?.gaps).map(g => ({
    label: clean(g?.label) || clean(g?.observation) || 'Observation',
    detail: clean(g?.detail) || clean(g?.evidence) || '',
    date: '', source: clean(g?.source) || 'screenshot', seen: true
  })).filter(g => g.label || g.detail);
  // Guesses made before anyone looked are replaced by what was actually there.
  const kept = list(lead.gaps).filter(g => g.seen && g.source !== 'screenshot');
  const merged = { ...lead, gaps: [...kept, ...gaps], strengths: list(audit?.strengths).map(clean).filter(Boolean), audited: Date.now() };
  return { ...merged, score: scoreLead(merged) };
}
