// The lead agent: four prompts that turn a place and a category into businesses worth
// approaching, and then into a message.
//
//   Target   — who to look for here, and the searches that will find them
//   Find     — run those searches, return businesses with a dated trigger and a source
//   Audit    — read a screenshot of their feed or shop and say what their pictures are not doing
//   Approach — the first message, in the designer's own voice, with one small job and a price
//
// The scoring rubric is not in these prompts: it lives in leadparse.js, so the model supplies
// evidence and the code does the arithmetic. No DOM access, so this can be tested in Node.

export const LEAD_SYSTEM = `You are a new business researcher working for a visual content designer.

You find small businesses whose pictures are holding them back, and you only ever report what
you can show. Every factual claim carries a source. If a search returns nothing useful, you say
so rather than filling the gap from memory. You never invent a business, a launch, an address,
a price, or anything about a photograph you have not seen.

You are looking for owner-run businesses, not brands with a marketing department.`;

export const JSON_ONLY = `${LEAD_SYSTEM}

Reply with JSON only. No preamble, no explanation outside the JSON.`;

export const REACH = [
  { id: 'city', label: 'In this city or town',
    line: place => `businesses based in ${place} itself` },
  { id: 'region', label: 'This area, including nearby towns',
    line: place => `businesses in ${place} and the towns and districts around it, within about an hour's travel` },
  { id: 'country', label: 'Anywhere in this country, selling online',
    line: place => `businesses anywhere in ${place} that sell online and ship nationally, wherever they are based` }
];

export const reachLine = (reach, place) =>
  (REACH.find(r => r.id === reach) || REACH[0]).line(place || 'the area');

const campaignBlock = c => `<hunting_ground>
Place: ${c.place || '(not set)'}
Reach: ${reachLine(c.reach, c.place)}
Category: ${c.niche || '(not set)'}
Platforms that matter: ${c.platforms || 'Instagram and an online shop'}
${c.notes ? `Notes from the designer: ${c.notes}` : ''}
</hunting_ground>`;

const studioBlock = docs => `<studio>
## Brand voice
${docs?.voice || '(not filled in yet)'}

## Work and services
${docs?.work || '(not filled in yet)'}
</studio>`;

const dateLine = (today = new Date()) =>
  today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// ---- Target -----------------------------------------------------------------

export function buildTargetRequest(campaign, docs, today = new Date()) {
  return `${studioBlock(docs)}

${campaignBlock(campaign)}

Today is ${dateLine(today)}.

Write the hunting plan for this place and category. Be specific to ${campaign.place || 'this place'}:
name real markets, shops, awards, publications and listings that exist there. A plan that would
read the same for any city is no use.

## Who to look for
Four or five bullets: the shape of business worth approaching here, its size, its price points,
and where it sells. Only categories the work and services document supports.

## Triggers worth watching
The things that mean a business would buy this month, in this category. One line each, with
what the evidence would look like. Rank them by how strong they are.

## Where the lists are
Six to ten named places a list of these businesses can be found in ${campaign.place || 'this place'}:
markets and fairs, food halls or concept stores and their stockist pages, award shortlists,
local publications, subscription boxes, trade bodies. Name them; do not describe them in general.

## Searches to run
Eight to twelve exact search queries, one per line in backticks, ready to paste. Mix trigger
searches (new openings, launches, awards, hiring) with list searches (stockists, exhibitors).
Each one must contain the place or a named local source.

## Who to skip
Four bullets: who in this category is not worth the message, and the visible sign of it.

Under 450 words. No preamble.`;
}

// ---- Find -------------------------------------------------------------------

export function buildFindRequest(campaign, target, { already = [], today = new Date(), want = 20 } = {}) {
  return `${campaignBlock(campaign)}

Today is ${dateLine(today)}.

${target ? `The hunting plan for this ground, written earlier. Use its searches and its named sources:

<plan>
${target}
</plan>
` : ''}
Find up to ${want} real businesses that match, all of them ${reachLine(campaign.reach, campaign.place)}.

Search before you write. Run the plan's searches, and prefer the ones that name a real local
source: a stockist page, a market's exhibitor list, an award shortlist, a "new opening" story.
Those pages list many businesses at once. Never run the same query twice.
${already.length ? `
Already in the list from earlier runs, do not return these again:
${already.slice(0, 60).map(n => `- ${n}`).join('\n')}
` : ''}
For every business, record only what the search results actually show:

- Its trigger: what changed for them recently, with the month and year, and the URL that says so.
  A business with no trigger you can source is still worth listing, with an empty triggers array.
- What you can tell about their pictures from their own site or listing. Mark these "seen": false,
  because search results are not a look at their photographs. Never describe a photograph you
  have not seen.
- Signs they can pay: price points, number of products, stockists, their own shop.
- Anything that disqualifies them: an agency or studio credited, a marketing team, nothing
  posted for months. Put it in "skip" and still return the business.

Reply with JSON only:
{"leads":[{
  "name":"Copper Fig Preserves",
  "what":"small-batch fig and honey preserves",
  "area":"Clifton, Bristol",
  "website":"https://copperfig.co.uk",
  "instagram":"copperfigpreserves",
  "contact":"hello@copperfig.co.uk or the form on their site",
  "size":"owner and two part-time staff",
  "triggers":[{"label":"new product","detail":"launched a spiced pear line for Christmas","date":"September 2026","source":"https://..."}],
  "gaps":[{"label":"no lifestyle photography","detail":"every shop photo is a jar on white","source":"https://...","seen":false}],
  "pays":[{"label":"stockists","detail":"sold in four farm shops"}],
  "skip":"",
  "note":"found on the exhibitor list for the Bristol food market"
}]}

If a search returns nothing usable, leave that ground out rather than guessing. Fewer real
businesses beats a longer list.`;
}

// ---- Audit ------------------------------------------------------------------

export const AUDIT_INSTRUCTION = `Below is a screenshot of this business's feed or online shop.

Describe only what is visible in the image. Do not guess at anything outside it, and do not
soften or exaggerate. If the pictures are good, say so plainly: a business whose photography is
already strong is not a lead, and saying so saves a wasted message.`;

export function buildAuditRequest(lead, campaign) {
  return `${AUDIT_INSTRUCTION}

Business: ${lead.name}${lead.what ? `, ${lead.what}` : ''}${lead.area ? `, ${lead.area}` : ''}.
${campaign?.niche ? `Category: ${campaign.niche}.` : ''}

Look for these, and only report the ones you can actually see:
- lighting and shadows that look like a phone on a kitchen counter
- backgrounds that change from picture to picture, so nothing reads as one brand
- cutouts on white only, with no scene the product lives in
- type set in a template, default fonts, headlines colliding with the product
- several products with one flat photograph each, none of them in use
- stock photography standing in for their own product
- content that has stopped, or is out of season
- a new product named in the text while the pictures still show the old one

Reply with JSON only:
{"gaps":[{"label":"short name for the problem","detail":"one line of what is visible, in plain words"}],
 "strengths":["anything that already works, one line each"],
 "verdict":"worth approaching" or "pictures are already good",
 "one_line":"the single sentence the designer could say about their pictures, warm and specific, never a put-down"}`;
}

// An image for the Messages API. Screenshots arrive from a file input as a data URL.
export function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(String(dataUrl ?? ''));
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1].toLowerCase(), data: m[2] } };
}

// ---- Approach ---------------------------------------------------------------

export function buildApproachRequest(lead, campaign, docs, today = new Date()) {
  const seen = (lead.gaps || []).filter(g => g.seen);
  const evidence = rows => rows.map(r => `- ${r.label}${r.detail ? `: ${r.detail}` : ''}${r.date ? ` (${r.date})` : ''}${r.source ? ` [${r.source}]` : ''}`).join('\n');
  return `${studioBlock(docs)}

Today is ${dateLine(today)}.

<business>
Name: ${lead.name}
Sells: ${lead.what || '(not recorded)'}
Where: ${lead.area || campaign?.place || '(not recorded)'}
Website: ${lead.website || '(none found)'}
Contact route: ${lead.contact || '(not recorded)'}
Size: ${lead.size || '(not recorded)'}

Triggers, with sources:
${evidence(lead.triggers || []) || '(none found)'}

What has actually been seen of their pictures:
${seen.length ? evidence(seen) : '(nobody has looked at their pictures yet)'}

Signs they can pay:
${evidence(lead.pays || []) || '(not recorded)'}
${lead.note ? `\nNote: ${lead.note}` : ''}
</business>

Write the first approach. This designer has no case studies with this kind of client yet, so the
message has to earn the reply on specifics and on work, not on reputation.

Rules:
- ${seen.length
    ? 'You may refer to their pictures, using only the observations above, and only one of them.'
    : 'Nobody has looked at their pictures, so the message must not say anything about them. Build it on the trigger alone.'}
- Never a put-down. "The new tin deserves a scene" rather than "your photos are flat".
- One first job, one number. Take the price from the work and services document; if it has no
  rate for this, write [set your price] and say in the notes what to consider. Never invent one.
- Anything unknown goes in [square brackets] for the designer to fill, never guessed.
- Her voice, from the brand voice document. Sentence case, no hype words, no "I hope this finds
  you well", no "I'd love to".

## Message
90 to 130 words, plain text ready to paste into an email or a contact form. First line names
what changed for them, in their own specifics. Second line names the one thing worth doing.
Then the proof: the portfolio piece from the work document that is nearest, in one line, or the
offer of a sample frame made for them. Then the first job with its price and turnaround. End
with one short question that is easy to answer.

## Subject line
Six to nine words, specific to them. No "collaboration opportunity".

## Why this angle
Two lines: the trigger it leans on and what it is betting they care about.

## Sample frame to make
One sentence describing the single image worth generating for them before sending, in the style
of this designer's work. Only if a sample would help; otherwise write "not needed".

## Attach
The portfolio pieces to attach, named as they appear in the work document, in order, one line
each on why. If the work document has nothing close, say so plainly.

## Follow-up
One message of 40 to 60 words to send five days later if there is no reply. It must add
something new, not repeat the first message. Then stop: there is no third message.

## Before sending
At most four bullets: what to check or fill in first.`;
}
