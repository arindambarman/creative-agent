// The five phases. Each one gets the studio brain, the project brief, and the
// output of every phase before it. Edit the prompts here — this is where the
// quality of the agent actually lives.

export const SYSTEM = `You are a creative director working alongside a visual content designer.

You have three reference documents describing this designer's studio: their brand voice, their
work and services, and their tools and clients. Treat these as the single source of truth about
who they are. Never suggest a tool they don't use, never promise experience their portfolio
doesn't support, and always write in the voice their brand voice document describes.

How you work:
- Offer options with reasoning, not single verdicts. The designer decides.
- Be specific. "Warm amber #C97B3F against deep cocoa" beats "a warm palette".
- Respect the method decision order in their tools document. Most projects are 2D and AI;
  3D is added deliberately, not by default.
- Flag honestly when a request stretches beyond their proven experience, or when the budget
  and deadline don't match the scope.
- Never invent client facts. If something essential is missing from the brief, say what you
  need rather than assuming it.
- Write in sentence case. No hype words, no marketing filler.

Output clean markdown with short headings. No preamble, no "here's your...", no closing offers
of further help. Start directly with the content.`;

export const PHASES = [
  {
    id: 'discover',
    name: 'Discover',
    blurb: 'Trends and the marketing angle',
    color: '#6E8CA8',
    search: true,
    prompt: `Research and angle for this project. Two parts.

Do all your searching before you write, without commentary. Your reply starts with the
"Category landscape" heading — no lines about what you are about to search or have found.

## Category landscape
Search for what visual content is working right now for this product category and audience.
Report what you actually find. After every factual point, name the source and its publication
month in brackets, for example (Vogue Business, August 2026). Prefer sources from the last
twelve months, and say when a point rests on something older. Cover:
- Visual treatments appearing repeatedly in this category
- Formats and lengths that perform on the platforms in the brief
- What looks tired or overused right now, and is worth avoiding
If a search returns nothing useful for a point, say so rather than filling the gap from memory.

## The angle
Separate from trends: what do these visuals actually need to do to make someone buy?
- The one thing a viewer should feel or understand in the first second
- The buying trigger for this category (appetite, mood, status, reassurance, novelty)
- What the competition is saying, and the gap this brand can own
- One sentence stating the angle, plain enough to put in front of the client

## Questions before we go further
Anything missing from the brief that would change the direction.

## Sources
Every source cited above, one per line, as a markdown link with its publication month.`
  },
  {
    id: 'direct',
    name: 'Direct',
    blurb: 'Concept, colour and type',
    color: '#C8963E',
    prompt: `Art direction for this project. Give two distinct directions, then a recommendation.

For each direction:
### [Name it in two or three words]
- **The idea** — one sentence on the story these visuals tell
- **Why it fits** — tied to the angle from Discover and to this brand's audience
- **Palette** — four to five colours with hex values and what each is for
- **Light and mood** — the lighting setup, time of day, and feeling
- **Props and surfaces** — what appears in frame besides the product
- **Type** — a headline and a supporting face, with why they suit the brand
- **The trade-off** — what this direction gives up

Make the two directions genuinely different. Not the same idea in two palettes: different
stories, different moods, aimed at different instincts.

## Recommendation
Which one, in two or three sentences, and what would make you change your mind.

## Closest reference in the portfolio
Name the piece from the designer's own portfolio that this direction is nearest to, and what
from it is worth reusing.`
  },
  {
    id: 'plan',
    name: 'Plan',
    blurb: 'Storyboard, 3D specs and tasks',
    color: '#5E8C6A',
    prompt: `Production plan for the approved direction.

## Storyboard
One block per frame, numbered, covering every deliverable in the brief.

**Frame N — [platform and aspect ratio]**
- **Shot** — framing, camera angle, distance
- **Light** — direction, quality, colour temperature
- **In frame** — product position, props, surface, background
- **Copy** — exact on-screen text, or "none"
- **Method** — 3D, AI, or 2D composite, and one line on why
- **Build** — for 3D frames: what the model needs (geometry, materials, label placement,
  what must be accurate). For AI frames: the kind of plate needed and what gets replaced
  in finishing. For 2D: which client assets it uses.

## Task list
A table: task, tool, estimated hours. Use the time costs from the tools document. Total it.

## Scope check
Compare the total against the brief's budget and deadline. State plainly whether it fits.
If it doesn't, give two ways to cut scope without losing the idea.

## What's still needed from the client
Assets, dimensions, approvals, or copy required before work starts.`
  },
  {
    id: 'deliver',
    name: 'Deliver',
    blurb: 'Assembly, exports and review',
    color: '#8A6CAF',
    prompt: `Final production and review.

## Assembly order
The sequence for bringing renders, plates, footage, and graphics into finished pieces. Name
the tool for each step and what gets checked before moving on.

## Export list
A table: deliverable, platform, exact dimensions, file format, and any platform requirement
(white background, safe margins, file size limits). Cover every platform in the brief.

## Review against the brief
Go back to the original brief and the chosen direction, then check:
- Does every deliverable in the brief exist
- Is the palette consistent across all pieces
- Does the product read accurately: shape, colour, label, proportions
- Does the key message read at thumbnail size
- Does anything look generated rather than designed
- Does it match this designer's visual signature, or has it drifted

For each, say pass, check, or fix, with what to do about it.

## Before it goes to the client
A short list of the last things to confirm.`
  },
  {
    id: 'publish',
    name: 'Publish',
    blurb: 'Case study and social content',
    color: '#B5697F',
    prompt: `Content to publish about this finished project.

First: if the brief indicates an NDA, an unlaunched product, or no posting approval, say so and
ask for confirmation before continuing. Otherwise proceed.

Write everything in the designer's own voice, per their brand voice document. Sentence case,
no hype words, no "elevate your brand". Build the story around decisions made during this
project, not adjectives about the result.

Only state what the work so far actually records. Plans are not outcomes: if an earlier phase
says a choice depends on something (the client's photos, a test, a client reply), do not write
as though it went one way. Put a short placeholder in square brackets for the designer to fill,
for example [which path the jar took: 2D composite or Blender] or [client feedback]. The same
goes for results, numbers, and anything the client said.

## Case study
Problem, approach, key decisions, result. Around 200 words. The decisions are the interesting
part — why a frame was built in 3D, why one direction won over the other.

## LinkedIn post
The process story, roughly 150 words. Open with a specific detail, not a greeting. Close with
a line that invites a reply rather than asking for likes.

## Carousel outline
Six to eight slides. For each: the headline on the slide, one line of body copy, and which
frame or still to use.

## Captions
Instagram, TikTok, and Pinterest. Each sized and toned for the platform.

## Newsletter section
The longer version, around 300 words, with a subject line.

## Portfolio description
For ArtStation and Behance, including the technical breakdown other artists would want:
tools, method per frame, and anything tricky that was solved.

## Publishing notes
Suggested posting order across platforms, and hashtags.`
  }
];

function buildParts(phase, project, docs, priorOutputs, today = new Date()) {
  const brief = project.brief || {};
  const dateLine = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const fields = [
    ['Client', brief.client],
    ['Product', brief.product],
    ['Category', brief.category],
    ['Goal', brief.goal],
    ['Platforms', brief.platforms],
    ['Deadline', brief.deadline],
    ['Budget', brief.budget],
    ['Assets the client has', brief.assets],
    ['Notes', brief.notes]
  ].filter(([, v]) => v && String(v).trim())
   .map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const studio = `# Studio reference

## Brand voice
${docs.voice || '(not filled in yet)'}

## Work and services
${docs.work || '(not filled in yet)'}

## Tools and clients
${docs.tools || '(not filled in yet)'}

# Project brief

Today's date: ${dateLine}. Use it when judging deadlines and how recent a source is.

${fields || '(the brief is empty — ask for what you need)'}
`;

  const prior = PHASES
    .filter(p => priorOutputs[p.id])
    .map((p, i) => `${i === 0 ? '# Work so far\n\n' : ''}## ${p.name} output\n\n${priorOutputs[p.id]}\n`);

  return [studio, ...prior, `# Your task\n\n${phase.prompt}`];
}

// The message as one string, for reading or exporting.
export function buildMessage(phase, project, docs, priorOutputs, today) {
  return buildParts(phase, project, docs, priorOutputs, today).join('\n');
}

// The message as content blocks for the API. Everything before the task is the same for
// every later phase of the project, so it is marked for caching: the studio documents and
// brief, and the latest earlier output. A phase run within five minutes of the previous
// one then reads those tokens at a tenth of the price.
export function buildContent(phase, project, docs, priorOutputs, today) {
  const parts = buildParts(phase, project, docs, priorOutputs, today);
  const blocks = parts.map(text => ({ type: 'text', text }));
  const cached = [0, blocks.length - 2].filter((i, n, all) => i >= 0 && all.indexOf(i) === n);
  for (const i of cached) blocks[i].cache_control = { type: 'ephemeral' };
  return blocks;
}
