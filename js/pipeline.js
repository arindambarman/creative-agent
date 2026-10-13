// Where each lead has got to, and what to do about it next.
//
// Cold outreach fails in two ordinary ways: the follow-up never happens, and the same business
// gets messaged twice. Both are bookkeeping, so they live here as plain data.
//
// No DOM access, so this can be tested in Node.

const DAY = 86400000;

export const STATUSES = [
  { id: 'new', label: 'New', hint: 'Found, not approached yet' },
  { id: 'approached', label: 'Approached', hint: 'First message sent', followUpDays: 5 },
  { id: 'replied', label: 'Replied', hint: 'They answered', followUpDays: 2 },
  { id: 'talking', label: 'In conversation', hint: 'Discussing the work', followUpDays: 3 },
  { id: 'won', label: 'Won', hint: 'They said yes', done: true },
  { id: 'lost', label: 'No', hint: 'Not interested', done: true },
  { id: 'later', label: 'Not now', hint: 'Right business, wrong moment', followUpDays: 90 },
  { id: 'skip', label: 'Skip', hint: 'Not a fit, do not contact', done: true }
];

export const statusInfo = id => STATUSES.find(s => s.id === id) || STATUSES[0];
export const isOpen = lead => !statusInfo(lead?.status).done;

// The next thing to do, in the words she would use. Only statuses that wait have one.
export function nextAction(status) {
  switch (status) {
    case 'approached': return 'Follow up once, then stop';
    case 'replied': return 'Answer them';
    case 'talking': return 'Send the brief or the price';
    case 'later': return 'Check back';
    default: return '';
  }
}

// Moving a lead on: records the touch, sets when to look at it again, and never loses history.
export function advance(lead, status, { now = Date.now(), note = '' } = {}) {
  const info = statusInfo(status);
  const touches = [...(lead.touches || []), { at: now, status, note }];
  return {
    ...lead,
    status,
    touches,
    lastTouch: now,
    nextAction: nextAction(status),
    nextAt: info.followUpDays ? now + info.followUpDays * DAY : 0,
    // Approaching the same business twice is the one unrecoverable mistake, so it is stamped.
    approachedAt: status === 'approached' ? (lead.approachedAt || now) : lead.approachedAt || 0
  };
}

export function dueFollowUps(leads, now = Date.now()) {
  return (leads || []).filter(l => l.nextAt && l.nextAt <= now && isOpen(l));
}

export function counts(leads) {
  const out = { total: (leads || []).length };
  for (const s of STATUSES) out[s.id] = 0;
  for (const lead of leads || []) out[statusInfo(lead.status).id]++;
  return out;
}

// What actually earned replies. After thirty approaches this is the only number worth tuning:
// which kind of trigger gets an answer, and which is a waste of a week.
export function outcomeSummary(leads) {
  const byTrigger = new Map();
  const replied = new Set(['replied', 'talking', 'won']);
  for (const lead of leads || []) {
    if (!lead.approachedAt) continue;
    const label = (lead.triggers?.[0]?.label || 'no trigger').toLowerCase();
    const row = byTrigger.get(label) || { trigger: label, approached: 0, replied: 0, won: 0 };
    row.approached++;
    if (replied.has(lead.status)) row.replied++;
    if (lead.status === 'won') row.won++;
    byTrigger.set(label, row);
  }
  const rows = [...byTrigger.values()].sort((a, b) => b.replied - a.replied || b.approached - a.approached);
  const approached = rows.reduce((n, r) => n + r.approached, 0);
  const repliedTotal = rows.reduce((n, r) => n + r.replied, 0);
  return {
    rows,
    approached,
    replied: repliedTotal,
    // Below ten approaches a rate is noise, and acting on noise is how good angles get dropped.
    rate: approached >= 10 ? Math.round((repliedTotal / approached) * 100) : null
  };
}
