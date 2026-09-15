# Creative Agent

An AI creative director for visual content designers. It turns a short client brief into a
complete production plan — research, direction, storyboard, task breakdown, delivery checklist —
and then writes the content you publish about the finished work.

Built to run as a static site on GitHub Pages with a Supabase backend, so anyone can fork it and
make it their own.

---

## Why it exists

Most of the work in a design project happens before anyone opens Photoshop: figuring out the
angle, choosing a direction, planning the shots, scoping the hours. And most of the value lost
after a project happens because the work never gets written up or posted.

This agent handles both ends. It knows your voice, your portfolio, and your tools, so its
suggestions are yours rather than generic.

---

## How it works

Six phases run in order, one of them optional. Each produces output you review and edit before the next one starts,
and each reads and writes the same shared project brief — so the palette chosen on day one still
matches the storyboard, the 3D shot list, and the final captions.

| Phase | What it does |
|---|---|
| **Discover** | Current trends for the client's category, plus the marketing angle |
| **Propose** *(optional)* | A proposal ready to paste into Upwork: meets the client's screening instructions, answers their questions, sets price, milestones and timeline. Later phases hold to what it promises |
| **Direct** | Concept, color palette, and type direction — as options, not verdicts |
| **Plan** | Frame-by-frame storyboard, 3D model specs, task breakdown with time estimates |
| **Deliver** | Assembly checklist, platform exports, review against the original brief |
| **Publish** | Case study, LinkedIn post, carousel, captions, newsletter, portfolio write-up |

---

## Features

### Knows your studio, not a generic one
- Three reference documents — brand voice, work and services, tools and clients — shape every suggestion
- Every user has their own studio brain, so the agent adapts to a different designer entirely
- Recommends the software you actually use and skips the ones you don't
- Pulls the closest match from your own portfolio as a reference for each new brief
- Flags honestly when a project would stretch beyond your proven experience

### Discover — research and angle
- Current trend research for the client's category, from live web search with sources and dates
- The marketing angle: what the visuals need to make a viewer feel or do
- Competitor and category scan, so the direction isn't a copy of what everyone else is doing
- Never relies on model memory for anything time-sensitive

### Direct — concept and art direction
- Two or three distinct creative directions with reasoning behind each
- Color palettes with hex values, tied to the brand and the category
- Type pairings and hierarchy
- The story the visuals tell, in one line you can put in front of a client

### Plan — storyboard and production
- Frame-by-frame storyboards with camera angle, lighting, props, and on-screen copy
- A method flag per frame — 3D, AI, or 2D — with the reason
- 3D model specs when a frame needs one: geometry, materials, label placement
- Task breakdown mapped to your software, with time estimates
- Scope check against the client's budget and deadline before you commit

### Deliver — assembly and review
- Assembly checklist for bringing renders, footage, and graphics into final exports
- Correct sizes for every platform in the brief
- Review pass against the original brief, catching drift before the client sees it
- Quality checks: does the label read at thumbnail size, is the palette consistent, does anything look generated rather than designed

### Publish — turn finished work into content
- Case study from the project record: the problem, the approach, the decisions, the result
- LinkedIn post in your voice, built around the process story rather than "here's my new work"
- Carousel outline, slide by slide, telling the before-to-after story
- Captions for Instagram, TikTok, and Pinterest, toned and sized per platform
- Newsletter section with the longer version of the story
- ArtStation and Behance descriptions, including the technical breakdown other artists care about
- Behind-the-scenes angle: what you tried first, why the final direction won
- Suggests which frames and stills to use for each format
- Hooks, calls to action, hashtags, and a posting order across platforms
- Checks for client approval and NDA status before drafting anything public

### Working with it
- Paste a client request straight from Upwork, email or chat, and the brief fills itself in — with a list of what the client didn't say
- Project workspace keeping the brief, phase outputs, and reference images together
- Upload client photos, logos, and references directly into a project
- Edit any output in place; your edits carry forward into later phases
- Version history per phase, so you can compare attempts instead of losing the earlier one
- Export the whole project as one PDF, Word document or markdown file to send to a client

### Built for sharing
- Static site on GitHub Pages — fork it and deploy in minutes
- Supabase handles sign-in, database, and file storage
- API key lives server-side in an edge function and never appears in the code
- Invite-only access with an allowlist
- Row-level security, so each user sees only their own projects
- Optional per-user API keys and usage budgets for cost control

---

## Design principles

- **Options, not verdicts.** Your taste stays the decision-maker. The agent widens what you consider and cuts the time from brief to first frame.
- **Sourced, not remembered.** Anything time-sensitive comes from live search with dates attached.
- **Honest about method.** Recommends 3D when a product needs exact accuracy, rather than defaulting to generated imagery — and says plainly when AI was used.
- **Honest about scope.** Won't promise experience that isn't in your portfolio.
- **You stay in the loop.** Every phase pauses for your approval before the next one runs.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Static site on GitHub Pages |
| Backend | Supabase — Auth, Edge Functions, Postgres, Storage |
| Model | Claude via the Anthropic API, with web search |

---

## Roadmap

Planned, not yet built:
- [x] Version history per phase, with restore
- [ ] Side-by-side comparison of two versions
- [x] PDF and Word export of the full project plan
- [ ] Per-user API keys and usage budgets
- [ ] Moodboard generation from the chosen direction
- [ ] Reusable project templates for recurring client types
- [ ] Scheduled publishing straight to social platforms

---

## Getting started

1. Fork this repository and enable GitHub Pages
2. Create a Supabase project and run the included schema
3. Add your Anthropic API key as a Supabase secret
4. Deploy the edge function
5. Sign in and fill in your three studio brain documents

Full setup instructions in [SETUP.md](SETUP.md).

---

Built by [Madhumanti Barman](https://www.artstation.com/madhumanti), Visual Content Designer.
