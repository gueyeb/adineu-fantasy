# PRD — Waiver Opportunity Cost (Trade Finder page)

Roadmap source: `docs/product-roadmap.md` → "Trade Finder follow-up → Later: waiver opportunity
cost, with verified FAAB settings and explicit incremental lineup gain. No synthetic acceptance
percentage or invented usage statistics."

Trade Finder counter-offer packages (the step before this one) turned out to already be shipped
— `findCounterOffers` in `trade-recommender.js` is implemented, wired into `trade-ui.js`, and
tested. So this is the actual next open item on the approved roadmap.

## Why

Trade Finder answers "who should I trade for". This answers the adjacent waiver-wire question:
"is picking up this free agent worth a FAAB bid, and how much does it actually buy my lineup?"
Same page, same trusted math already shipped for trades — not a new formula.

## Scope (v1)

- Third view on the Trade Finder page (`trade-ui.js` already switches between Finder and
  Calculator views — this adds "Waivers"), using the same roster selector already there.
- Per-team, on demand — not all 12 teams computed at once.
- One target week: the next unlocked week (same `currentWeek` concept used everywhere else).
- **Incremental lineup gain** reuses `buildProjectedLineup`/the exchange pattern from
  `trade-score.js` verbatim: optimal lineup with [your roster + candidate free agent, minus your
  weakest same-eligible-slot player] vs. your current optimal lineup. This is the exact delta
  math already shipped and tested for trades — applying it here is composition, not a new model.
- **FAAB**: shows your team's real remaining budget (`GENERAL_SETTINGS_2026.waiver.budget` minus
  `roster.settings.waiver_budget_used`, the same calculation already live on `/teams/`). Never a
  suggested bid amount, never a win probability — nobody can see other managers' bids, and the
  roadmap explicitly bans inventing one.

## Free-agent pool — the one real design decision, verified live today

Two options existed; I tested both against live Sleeper data before deciding:

1. **The static `players-catalog.json` pre-season board** (886 players, generated 2026-09-06,
   pre-draft). Rejected: it's exactly the players *already* rostered by someone on draft day. It
   would systematically miss the players people actually check waivers for — in-season risers
   who weren't draft-relevant three weeks ago.
2. **Sleeper's live per-week projections endpoint** (`/projections/nfl/{season}/{week}`) — the
   same one Playoff Probabilities already fetches. Verified live (week 3, RB+WR alone): 2114
   projected players, each with a nested `player` object (name, fantasy position, team). This
   endpoint already covers essentially every player Sleeper considers rosterable that week,
   refreshes weekly, and needs no new fetch — `loadSleeperProjections(week)` is reused unchanged.

Going with **option 2**. Free agent = any player in that week's projections whose `player_id` is
not on any of the 12 rosters (`/league/{id}/rosters`, already fetched). This avoids Sleeper's raw
12,227-player/14.6MB full catalog entirely (verified — far too heavy and full of practice-squad
noise) while staying materially more current than the pre-season board.

Pool is further capped to the top 40 free agents at your team's weakest positions by direct
Adineu-scored projection (`projectPlayerFantasyPoints`, already built), so this stays a short,
actionable list rather than a scan of hundreds of irrelevant names.

## Exclusions (so this never publishes a misleading number)

- A free agent on bye that week, or with no projection at all, is excluded — not shown with a
  fabricated zero.
- No "chance to win this bid" figure, ever — see FAAB section above.
- No projection-coverage caveat needed the way Playoff Probabilities needed one: every candidate
  shown has a real direct projection by construction (that's how the pool is built).

## Data sources (all already fetched elsewhere in this codebase, verified live)

- `/league/{id}/rosters` — who's currently rostered, and each team's `waiver_budget_used`.
- `/projections/nfl/{season}/{week}?position[]=...` — the free-agent pool + their projections.
- `GENERAL_SETTINGS_2026.waiver` — real budget/type, already in `league-settings.js`.
- `buildProjectedLineup` (`trade-score.js`) — the lineup-delta engine, reused unchanged.

## Increment

Single increment (this is composition of four already-shipped, already-tested pieces, not new
modeling): a small `waiver-opportunity.js` pure module (free-agent pool builder + per-candidate
lineup-delta scoring, unit tested) plus a "Waivers" view added to `trade-ui.js`.

## Open question for you

None on the model itself — the free-agent-pool decision above is the only real fork, and I've
made the call with the data to back it. The only thing I'd like confirmed: **cap of 40 candidates
and "weakest positions only"** — reasonable default, but say if you'd rather see all positions or
a different cap.
