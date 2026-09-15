# CLAUDE.md

Context for Claude Code working on this repository. Read this before making changes.

## What this is

Creative Agent — an AI creative director for a visual content designer. It takes a short client
brief and produces research, art direction, a storyboard, a task breakdown, a delivery checklist,
and the content to publish about the finished work.

It is a **static site** with no build step. Plain HTML, CSS, and ES modules. It is served from
GitHub Pages, optionally backed by Supabase.

## The owner

Madhumanti Barman, Visual Content Designer. Background: about three years as a 3D artist, now
working in 2D design, AI tools, and 3D. Clients are product and lifestyle brands — food and
beverage, home and lifestyle, fashion, beauty, and newer interior work. Tools: Photoshop,
Illustrator, InDesign, Canva, Adobe Express, AI image and video generation, Premiere Pro, After
Effects, CapCut, Blender, Substance Painter, ZBrush. She does not use Maya.

The app is also meant to be forked by other designers, so nothing about her specifically should
be hard-coded outside `js/seed.js` and `docs/`.

## Architecture

```
Client brief
    ↓
Creative agent  ──  three studio brain docs (brand voice, work and services, tools and clients)
    ↓               one project brief file that every phase reads and writes back to
Five phases: discover → direct → plan → deliver → publish
```

Two run modes, chosen by whether `js/config.js` has Supabase credentials:

- **Local** (default): API key in `localStorage`, calls `api.anthropic.com` directly from the
  browser using the `anthropic-dangerous-direct-browser-access` header. Projects live in one
  browser. No sign-in.
- **Supabase**: magic-link sign-in, projects and studio docs on the user's account, every phase
  run kept as history. The API key lives only in the `run-phase` edge function.

`js/store.js` hides the difference behind one interface. `js/app.js` must never call
`localStorage` or Supabase directly — always go through `store`.

## File map

| File | Role |
|---|---|
| `index.html` | Shell and all CSS. Dark workbench theme. |
| `js/app.js` | State, rendering, events, phase history UI. The only file that touches the DOM. |
| `js/phases.js` | **The agent itself.** System prompt, five phase prompts, prompt assembly. |
| `js/model.js` | Messages API streaming: resumes `pause_turn`, flags truncation, keeps partial text on failure. No DOM. |
| `js/markdown.js` | `md()` renderer and `esc()`. No DOM. |
| `tests/*.test.js` | Unit tests for `model.js` and `markdown.js`, run with Node's built-in runner. |
| `js/store.js` | Storage adapter: local and Supabase backends behind one interface. |
| `js/seed.js` | Starter studio-brain text for new users. Templates with [brackets] to fill in. |
| `js/config.js` | Supabase URL and anon key, model name. Empty by default. |
| `supabase/schema.sql` | Tables, row-level security, allowlist trigger, usage function. |
| `supabase/functions/run-phase/index.ts` | Deno edge function. Holds the API key, checks budget, streams through, logs usage. |
| `docs/*.md` | Full studio brain documents, for pasting in. Reference only, not loaded by the app. |
| `README.md` | Public feature overview. |
| `SETUP.md` | Deployment instructions for both modes. |

## Conventions

- **No frameworks, no build step, no npm.** ES modules loaded directly. Keep it that way.
- **No new dependencies** without a clear reason. The only external imports are Google Fonts
  and, in Supabase mode, `@supabase/supabase-js` from esm.sh.
- CSS lives in `index.html` in one `<style>` block, using the CSS variables defined at the top.
  Use those variables; never hard-code colours.
- Phase colours are defined in `js/phases.js` and used for nav dots and output borders.
- Sentence case in all UI copy. No hype words, no exclamation marks. Errors say what went wrong
  and what to do about it. Empty states invite an action.
- Buttons say what happens: "Save brief", not "Submit".
- Escape all user and model text with `esc()` before inserting into HTML.
- Keep responsive down to 820px; the layout collapses to one column.
- Respect `prefers-reduced-motion` (already handled in `index.html`).

## Current state

Working and tested:
- Local mode end to end: projects, brief, all five phases, streaming, inline editing, markdown
  export, error handling, persistence across reloads.
- Phase history: every run, edit, and restore is kept (last 5 per phase in local mode, in
  `project.history`; all runs in `phase_runs` in Supabase mode). View and restore from the
  History button on a phase.
- Long runs: web search `pause_turn` is resumed automatically (up to 5 times), length-limit and
  refusal stops show a notice, Stop aborts a run, and partial text from a stopped or dropped run
  can be kept.
- Failures: overloaded, rate-limit, server errors and dropped connections retry up to 3 times
  (2, 5, 10 seconds), discarding that request's half-written text. A stream silent for 2 minutes
  is stopped rather than left hanging.
- Every prompt includes today's date, so deadlines and source recency are judged correctly.
- Unit tests for streaming and markdown. Browser-tested with a stubbed `fetch`.
- All five phases run against the real API (claude-sonnet-4-6) with a test brief on
  14 September 2026. That run surfaced the date, sourcing, invented-outcome and stall issues fixed
  above.

Lessons from the real run, worth keeping in mind when editing prompts:
- With `web_search_20260209`, searches run inside code execution: `server_tool_use` blocks named
  `web_search` arrive with `input` already filled, and no `citations` are returned. Sources only
  appear if the prompt asks for them in the text.
- Publish will write plans up as finished results unless told plainly that it may not.
- Research connections can drop mid-search; the retry covers it, but Discover is the slowest phase.
- Sign-in screen renders and validates, tested with a stubbed Supabase client.

Written but not yet tested against a live Supabase project:
- `js/store.js` remote backend (now sends the user's session token to `run-phase`)
- `supabase/schema.sql`
- `supabase/functions/run-phase/index.ts` (origin allowlist via `ALLOWED_ORIGINS`, usage logged
  with the service role, only web search tools forwarded)

## Known gaps, roughly in priority order

1. **Image uploads.** Client photos, logos, and references should go to Supabase Storage and be
   attached to a project. Currently there is no upload anywhere.
2. **Live Supabase test.** Run the full flow against a real project before sharing the site.
3. **Side-by-side comparison** of two history versions.
4. **Markdown renderer** in `js/markdown.js` is deliberately minimal. Extend it rather than adding
   a library, unless there's a strong reason.
5. **Resuming a dropped research run.** A retry restarts the current request from scratch, so a
   Discover run that drops late repeats its searches. Worth revisiting if drops stay common.

## Things not to do

- Don't add a bundler, framework, or TypeScript to the frontend.
- Don't move the API key into client-side code in Supabase mode.
- Don't hard-code Madhumanti's details into `app.js` or `phases.js`; they belong in the studio
  brain, which the user edits.
- Don't remove the web-search tool from the `discover` phase. Trend data must come from live
  sources with dates, never from model memory.
- Don't make the agent give single verdicts. Phases that offer options (especially `direct`)
  should keep offering options with reasoning.
- Don't drop the NDA and posting-approval check at the top of the `publish` phase prompt.

## Testing

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly fails: browsers block ES modules on `file://`.

Unit tests use Node's built-in runner (Node 22 or later), no npm install needed:

```bash
node --test
```

Keep new logic that doesn't need the DOM in its own module so it can be tested this way.

After any UI change, also verify in the browser: create a project, save a brief, open each phase,
run one, stop one and keep the partial output, open History and restore, edit an output, reload
the page, and export. Check the browser console is clean.

## The prompts matter most

`js/phases.js` is where the quality of this product lives. Before adding features, prefer
tightening the phase prompts based on real output. A vague result is usually a prompt problem,
not a code problem.
