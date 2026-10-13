# Lead agent — build plan

A second agent in this app that finds small businesses who need visual content work, judges
whether they are worth approaching, and writes the first message in the designer's own voice.
A lead that says yes becomes a project, and the existing six phases take over from there.

Written 12 October 2026, and built the same day. What shipped: campaigns, Target, Find,
the screenshot audit, Approach, the pipeline with one follow-up, and the handoff to a project
(M0 to M4 below). Still to do: the sample frame for a lead (M5), the lead sheet export, and the
Supabase tables are written but unused until the SQL is run. The prompts have not yet met live
search results.

## The thesis

Cold outreach from a freelance designer works when the message proves three things in four
lines: that something just changed for this business, that there is a visible gap the designer
can close, and that the designer has already started. Everything in this agent exists to produce
those three things:

1. **A trigger** — a new product, a new location, a rebrand, a season, an ad campaign, a hire.
   With a date and a source link, never a guess.
2. **A gap** — what their visuals are not doing, stated from evidence, not assumed.
3. **Proof** — one portfolio piece that matches, and optionally one image made for them
   (the Images screen already does this for about $0.03).

A lead without a trigger and a gap is not a lead. The agent should say so and move on rather
than write a polite message to someone who has no reason to reply.

## What it must not do

These are design constraints, not warnings to add later.

- **No scraping of Instagram, Facebook, LinkedIn or Upwork.** Their terms forbid it and the
  accounts at risk are the designer's own. The agent uses web search, public business websites,
  and anything the designer pastes in herself.
- **No harvesting of personal email addresses.** Business contact routes only: the address or
  form a business publishes for enquiries.
- **The agent never sends anything.** It drafts; the designer sends, as with every other phase
  of this app. This also keeps volume low enough to stay personal and legal.
- **No invented observations.** "Your photos are dark" is a lie unless something was actually
  seen. Every claim in a message carries evidence, or the agent marks the lead unverified and
  asks the designer to look for thirty seconds.
- **A do-not-contact list, and dedupe by domain**, so nobody is approached twice.

Volume to aim for: five to fifteen well-researched approaches a week, one follow-up each. Not
hundreds. The economics of a freelance designer reward reply rate, not send count.

## Where leads actually come from

Honest assessment of each source, because this is the part that decides whether the agent is
useful:

| Source | What it gives | Cost | Verdict |
|---|---|---|---|
| Claude web search (already in use) | Businesses mentioned in articles, local press, "new bakery opened in…", launch announcements, award lists | $0.01 per search | **Primary.** Finds triggers, which is what matters |
| Google Places API | Local businesses by category and area, with website, rating, review count | Free tier, then paid; needs a key | **Optional second source** for local work. Gives existence, not triggers |
| Pasted lists | A directory page, a market's stall list, a trade show exhibitor list, a competitor's client list | Free | **Underrated.** The designer finds a list, the agent qualifies all of it |
| Pasted screenshots | The designer opens a candidate's feed and pastes a screenshot; the model reads it | Tokens only | **The accurate audit.** Use this before claiming anything about their visuals |
| Instagram / LinkedIn scraping | — | — | **Not building it** |

The realistic division of labour: the agent finds and pre-qualifies, the designer spends half a
minute looking at the top candidates, the agent writes from what was actually seen.

## Shape: phases, like the rest of the app

A **campaign** is the unit, the way a project is for the creative agent: one hunting ground,
one niche, run again whenever she wants more. Each campaign holds leads.

| Phase | Reads | Does | Cost per run |
|---|---|---|---|
| **Target** | Studio brain (what she sells, her rates, her portfolio categories) + the campaign settings | Writes the ideal client profile: categories, size, platforms, the triggers worth watching for, the searches to run, and what to skip. Also what a good first job looks like at her rates | ~$0.02 |
| **Find** | Target | Runs the searches. Returns a table of candidates: business, what they sell, where, the trigger found with its date and source link, and the link to their site. Says plainly when a search returned nothing usable | ~$0.15 (6 searches) |
| **Qualify** | Find, plus anything pasted | Scores every candidate against the rubric below in one batched call. Each gets a score, the evidence behind it, and what is still unknown | ~$0.02 for 20 |
| **Approach** | Qualify, studio brain, and the chosen lead | Per lead, on demand: the angle, the first message (90–130 words), one follow-up, which portfolio pieces to attach, the first job to propose with a price from her rates, and the open question to end on | ~$0.02 each |
| **Prove** (optional) | Approach | Uses the existing Images screen pipeline to make one concept frame for a top lead | ~$0.03 each |

Target and Find run per campaign. Qualify runs over the batch. Approach runs only on leads the
designer picks, so money is spent on leads worth writing to.

Rough cost for one campaign of twenty candidates with five approaches: **about $0.30.**

## Scoring rubric

Out of ten. Written into the prompt so scores are comparable between runs.

- **Trigger recency** (0–3) — something changed in the last 90 days, with a dated source
- **Visible gap** (0–3) — evidence that their visuals are the weak link; 0 when nothing was seen
- **Portfolio fit** (0–2) — a category she has shipped before, named from the work document
- **Reachability** (0–1) — a public business contact route, and the owner is likely the decider
- **Budget plausibility** (0–1) — price points, store count or running ads suggest they can pay

Only **6 and above** gets an approach written. Everything else stays in the list with its score
and the reason, so she can disagree and promote one by hand.

## Pipeline

Each lead carries a status: `new → approached → replied → talking → won / lost / not now`,
with the date of the last touch and the next action. Two things make this worth having:

- **Won → Start a project** creates a Creative Agent project with the brief pre-filled from
  everything the lead already knows, and the client's reply pasted into the request box. The
  Propose phase then does what it already does.
- **Outcomes feed back.** Reply rate by angle, by category and by trigger type, in a weekly
  summary. After thirty approaches this tells her which opening actually works, which is the one
  thing no amount of prompt tuning can guess.

## How it fits the existing code

Same repo, a new **Leads** section in the rail. No new dependencies, no build step.

Reused as they are: `model.js` (streaming, retries, cost), `markdown.js`, `store.js` (both
backends), `document.js` (export a lead sheet), `images.js` and `assets.js` (the Prove step),
`config.js` (model picker, prices), and the studio brain — the outreach has to sound like her
and cite real pieces, which is exactly what those three documents are for.

New files:

| File | Role | Tested in Node |
|---|---|---|
| `js/leads.js` | The agent: the five prompts, the rubric, prompt assembly | yes |
| `js/leadparse.js` | Parsing the model's lead tables and JSON, normalising domains, dedupe, scoring arithmetic | yes |
| `js/pipeline.js` | Status transitions, next-action dates, the weekly outcome summary | yes |
| `js/leadsui.js` | The Leads screens. The only new file touching the DOM | no |

Storage: a `campaigns` array beside `projects`, each with its leads. Supabase gets `campaigns`,
`leads` and `lead_touches` tables with the same row-level security pattern as `projects`, plus
a `do_not_contact` table keyed on domain.

## Build order

Each step ends with a working app and passing tests, the way the rest of this project was built.

- **M0 — Shell.** Campaign CRUD, the Leads screen, the data model, dedupe and scoring in
  `leadparse.js` with tests. No model calls yet.
  *Done when:* a campaign can be created, saved, reloaded and deleted, and `node --test` passes.
- **M1 — Target and Find.** The two prompts, the search budget, the candidate table.
  *Done when:* a real run on one niche returns at least ten candidates, each with a source link,
  and the run costs under $0.20.
- **M2 — Qualify.** The rubric, batched, with the evidence rule and the unverified state.
  *Done when:* scores on a real batch agree with the designer's own judgement on the top five,
  and nothing is claimed without a link.
- **M3 — Approach.** Messages in her voice, portfolio matching, price from her rates.
  *Done when:* she would send three of five drafts unedited.
- **M4 — Pipeline.** Statuses, next actions, do-not-contact, and **Won → Start a project**.
  *Done when:* a won lead opens a project whose brief needs no retyping.
- **M5 — Proof and export.** The concept frame for a lead, a lead sheet as PDF or CSV.
- **M6 — Supabase and measurement.** Tables, policies, and the weekly outcome summary.

M0 to M3 is the usable product. M4 is what stops it becoming a spreadsheet problem.

## The open questions

Two decisions change what gets built, and both can be settled by running M1 twice:

1. **Local businesses near her, or online brands anywhere?** Local means Places API and "new
   cafe in [city]" searches; online means launch announcements, Shopify brands and marketplace
   sellers. The campaign settings can hold both, but the first one built should be the one she
   will actually work.
2. **Does cold outreach suit her at all**, next to Upwork, where the Propose phase already
   handles inbound? If the answer is "Upwork mostly", the same machinery still pays off pointed
   at saved job searches she pastes in — Find becomes Qualify over a pasted list.

## The honest risk

Web search tells you a business exists and that something happened. It cannot see that their
photographs are flat. If the agent is allowed to guess at that, it will write confident messages
about things it never saw, and those messages are worse than no message at all — they are the
thing that makes designers look like spam. The screenshot audit in Qualify is the answer, and it
is worth building properly rather than treating as an extra.
