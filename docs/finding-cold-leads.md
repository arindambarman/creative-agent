# Finding cold leads — the detection system

How the lead agent decides who to approach, written for the state we are actually in: no
clients yet, no referrals, no case studies. Companion to `lead-agent-plan.md`, which covers the
screens and the build order. Written 12 October 2026.

## The constraint that shapes everything

With no clients, a pitch has nothing to stand on. Proof does. One concept frame made for a
specific business, sent unasked, outperforms any amount of "I'd love to work with you" — and
this app can produce that frame for about $0.03 using their own product photo as a reference.

So the detection system is not looking for "businesses that might like design". It is looking
for **businesses where one image will visibly beat what they have now, where the owner decides,
and where visuals are tied to money.** That is a much narrower and much more findable thing.

## The funnel

Four stages, cheapest filter first, so the expensive work only ever touches good candidates.

```
Hunting ground   one niche × one place × one platform        decided once a week
      ↓
Enumerate        50–100 names from public lists              cheap, mostly search
      ↓
Signal scan      who shows a buying signal                   search + their own site
      ↓
Visual audit     what is actually wrong with their pictures  human + screenshot, 30 seconds each
      ↓
Proof + message  5 a week, 2 with an image made for them     $0.03 each
```

The breakage point in every system like this is stage four. Search can tell you a business
exists and that something happened to it. It cannot see that their photography is flat. Claims
about someone's visuals must come from something actually looked at, or they must not be made.

## Choosing the hunting ground

One niche at a time, because the whole point is that the same concept treatment, the same
message and the same proof work across the list. Switching niches every day means starting from
nothing every day.

A niche qualifies when all four are true:

1. **Pictures are the storefront.** Someone decides to buy from a photograph.
2. **The owner decides.** One to twenty people, no marketing department, no agency.
3. **They sell online**, so better visuals are traceable to revenue.
4. **It matches work already in the portfolio**, so there is something honest to attach.

Fits her work: specialty food and drink (roasters, bakeries, preserves, chocolate, hot sauce,
tea), home and lifestyle (candles, ceramics, soap, home fragrance), small-batch beauty, and
furniture or interiors studios. Each of those sells on appetite and mood, which is what her
lighting does.

## The signal taxonomy

This is the actual decision rule. Three tiers, because they answer three different questions:
*will they buy now*, *do they need it*, and *can they pay*.

### Tier A — a trigger: a reason to buy this month (0–4)

Each worth 2, capped at 4. Every one needs a date and a source link.

- **Running paid ads** with weak creative. The strongest single signal: money is already being
  spent on distribution, and the asset it is spending on is visible. The Meta Ad Library is
  public and searchable by brand, so the creative can be seen and named.
- **A product just launched or is about to.** New flavour, new scent, new line, new packaging.
- **A new location, stall or stockist.** Their first shop, a new city, a listing in a store.
- **Hiring a social media or content person.** Budget plus admitted pain, stated publicly.
- **A rebrand or new packaging** that their photographs have not caught up with.
- **A crowdfunding campaign that just delivered**, so they have customers and no photos.
- **A seasonal window** that is theirs to hit: gifting, festival, summer range.

### Tier B — a gap: evidence they need her specifically (0–4)

Scored only from something actually seen: their site, their listings, their ads, or a screenshot
of their feed. Worth 1 each.

- Product shots taken on a kitchen counter in overhead daylight, with the shadow of the phone
- Backgrounds that change from post to post, so nothing reads as one brand
- Cutouts on white only, no lifestyle scene anywhere
- Type set in a template with default fonts, and headlines that collide with the product
- Several products, one photograph each, none of them in use
- Stock photography on the home page of a brand that makes a physical thing
- Stale: the feed stopped months ago, or the seasonal content is out of season
- The new product is announced in text but every photograph still shows the old one

### Tier C — they can pay (0–2)

- Price points, number of SKUs, stockists or store count suggest real revenue
- Review volume or waitlists suggest demand, not a hobby

### Disqualifiers — drop regardless of score

- An agency or in-house designer is credited anywhere
- No online presence at all, or nothing posted in six months
- A brand large enough to have a marketing team
- Already on the do-not-contact list, or approached before

**Score = A + B + C, out of 10. Approach at 6 or more.** Below that the lead stays in the list
with its score and reasons, so she can disagree and promote one by hand.

The shape to aim for: a Tier A trigger plus two Tier B observations is a message that writes
itself. A high Tier B score with no Tier A is a good business to watch, not to message today.

## Where the names come from

Public, workable, in rough order of value for this niche. Nothing here involves scraping a
social platform.

| Source | How it is used |
|---|---|
| **Meta Ad Library** | Public and searchable by advertiser. Finds small brands spending money and shows the creative they are spending it on |
| **Retailer and stockist pages** | A good food hall, concept store or farm shop lists its brands. A hand-curated list of exactly the right businesses, built by a buyer |
| **Market, fair and exhibitor lists** | Makers' markets, craft fairs, trade shows publish exhibitor directories |
| **Subscription box contents** | "This month's box" pages name six small makers at a time |
| **Local press and "new opening" coverage** | The trigger and the date arrive together |
| **Award and shortlist pages** | Great Taste, local food awards, design awards: filtered for quality, and they are proud enough to post about it |
| **Crowdfunding, delivered** | They have customers, an audience, and usually no photography budget left |
| **Job posts** | A small brand hiring for content, with the salary as a budget signal |
| **Google Places / Maps** | For local work: category plus area, with website and review count. Needs an API key; check the current free allowance before relying on it |
| **Marketplace listings** | Etsy, Amazon Handmade and similar, where listing imagery is visible and often the weakest part |

Search patterns worth keeping in the Target phase, with the niche and place substituted in:

- `new [product category] brand launched [place] 2026`
- `best new [category] [city]` and `[city] [category] award winners`
- `[concept store or food hall] our brands` / `stockists`
- `[city] makers market exhibitor list 2026`
- `"now hiring" social media content [category] small brand`
- `[category] rebrand new packaging 2026`
- `kickstarter [category] shipped backers 2026`

## The visual audit, done honestly

The step that makes the message land, and the one most likely to be faked by a model that cannot
see. How it works in the app:

1. The agent returns the top candidates with their trigger and their links.
2. She opens the feed or store and pastes a screenshot into the lead.
3. The model reads what is actually there and fills the Tier B list from it.
4. A lead with no screenshot and no visible store imagery stays **unverified** — the message may
   not claim anything about their pictures, only about the trigger.

Thirty seconds of looking per candidate, on maybe ten candidates a week. That is the entire
manual cost of the system, and it is what keeps it from becoming spam.

## The approach, proof first

What goes out, for a designer with no case studies:

- **Line one names their trigger**, with the detail that proves it was actually read.
- **Line two names one thing** their pictures are not doing, from the audit. One, not a list.
  Never a put-down: "the new tin deserves a scene" rather than "your photos are bad".
- **Then the proof**: an image made for them, or the nearest portfolio piece. "I remade your
  [product] as a [treatment] scene to show what I meant — here it is, yours either way."
- **One small first job with a price** from her rates. Not a package menu. One thing, one number.
- **One specific question** that is easy to answer.

Ninety to a hundred and thirty words. Sent to the business's own published contact route. One
follow-up after five days, then stop. No third message, ever.

## The week, in numbers

A realistic rhythm for one person doing this alongside client work:

| Step | Volume |
|---|---|
| Candidates enumerated | 50 |
| Pass the signal scan | 20 |
| Audited by eye | 10 |
| Approached | 5, of which 2 carry an image made for them |
| Model cost | about $0.40 |

Expect roughly one in five to reply when the research is real and the proof is attached, and a
small fraction of those to turn into paid work — industry-typical ranges for well-researched,
proof-first outreach, not a promise. At five a week that is a conversation most weeks and a
first paid job within a month or two, which is the honest answer to "how long".

What makes this compound rather than grind: every approach is logged with its angle, its
trigger type and its outcome, so after thirty of them the agent can say which opening actually
earned replies. That is the number worth optimising, and it cannot be guessed in advance.

## What this does not replace

Cold outreach is slow at the start by nature. The same signal engine is worth pointing at the
faster channels while it warms up: Upwork posts pasted into the Propose phase, which already
works; the stockist and market lists above, which are also places to meet owners in person; and
the first two or three jobs taken at a price that buys case studies rather than margin.
