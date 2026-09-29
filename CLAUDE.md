# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` first — its repository, testing, identity, and security rules (Power Rankings formula, Access Matrix, Yahoo API/archive procedures, coding style) are authoritative and are not repeated here.

## Current State (not derivable from code)

- Production: `https://adineu-fantasy.bakene.tech/`
- Sleeper 2026: league `1392715510830878721`, 12 owners/rosters, `in_season`. Draft `1392715511942352896` completed Sunday, September 6, 2026 at 22:04 Paris time (snake, 15 rounds, 60s picks).
- Yahoo archive: 2019–2025 complete and reconciled — 609 regular-season matchups, 44+8 playoff games, 88/88 identities across 15 managers. Birama = `El Fenomeno` (2019) / `Ethan Hunt` (2020) / Yahoo `Bombeul22` (2021–2025) / Sleeper `bm2222` then display `bmb22`, one canonical owner. Mat's confirmed Sleeper displays are `MouhammadAT` then `Shiro00` for Kuro.
- `/power-rankings/` is data-ready but intentionally locked at 0/2 until every 2026 team has two complete regular-season weeks. The same page's **Playoff Race** section (`public/assets/playoff-race.js`) shares that exact gate — it reuses `calculatePowerRankings`'s wins/losses/points-for output, just re-sorted into classic standings order, with "games back" from the 8th seed. No simulated odds, ever.
- `/franchises/`, `/hall-of-fame/`, Trade Hub are all live and derive client-side from the archive JSON + Supabase.
- `/rivalry-week/`'s Rivalry Tracker (`buildSleeperSeasonMeetings` + `buildRivalryRecords`' third `liveMeetings` argument, both in `public/assets/rivalry-week.js`) folds a 2026 Sleeper meeting into a pair's all-time record as soon as a real, non-zero-score matchup between those two managers is published — any week, not just the proposed Week 8 slot.
- `/matchups/` is the 2026 **Game Center** (`public/assets/matchups-live.js`): Live (current-week Sleeper scores + pregame win estimate), Calendrier 2026 (week picker), **Récap Hebdo** (`public/assets/weekly-recap.js`: highest score, closest matchup, biggest upset vs. the pregame estimate, and points left on the bench — computed against the actual optimal lineup for that roster), and Archives 2019-2025 (the original Yahoo head-to-head/rivalry matrix, now lazy-loaded as a tab instead of the whole page). Win probability is explicitly labeled an Adineu estimate and is suppressed whenever a lineup or projection coverage is incomplete — never shown as an official number.
- `GET /api/context` (JSON or `?format=text`) aggregates league rules + the caller's live Sleeper roster (starters/bench/IR) into one copy-pasteable block; the site header's "Copier contexte IA" button is its main consumer. `GET /api/free-agents` (optional `position`/`limit`) returns the players-catalog entries not on any of the 12 rosters, grouped by position — surfaced as the Trade Hub's "Waiver Wire" tab. Both live in `scripts/league-context.js`, mirroring the `/api/trades` pattern (pure functions + a CLI + an injectable server route).
- Trade Finder values trades on a **rest-of-regular-season weekly average** (`restOfSeasonEstimate` in `trade-score.js`: healthy rate × share of remaining games after Sleeper injury status — Out 1 game, IR/PUP 3 (expected remainder of the 4-game minimum) — and bye). Empty starter slot = 0 pts (never null/"incomplete"); injuries are `notes` (confidence MEDIUM), not warnings. `findTradeProposals` also runs an exhaustive 1-for-1/2-for-1/1-for-2 search (`findLineupUpgrades`) and drops any proposal where my delta ≤ 0 or partner delta < 0 (handcuff excepted). Injury statuses reach the browser via `GET /api/player-status`. Market value still comes from the pre-draft catalog (2026-09-06) — see `docs/prd-adineu-projection-model.md` (own projection model, Phase 0 = weekly catalog refresh).
- Waiver Wire = **model v2** (`public/assets/waiver-model.js`, `docs/prd-waiver-model-v2.md`): `getFreeAgents` pools every unrostered Sleeper player, values rest-of-season from Sleeper future-week projections, reads real usage from Sleeper `/stats` (snaps, carries+targets, red zone), flags `NEWS_OVERRIDE` events (PROMOTION = better-`search_rank` teammate Out/IR — not depth chart, Sleeper updates it after the injury; SNAP/USAGE_SURGE), and returns separate **Market** (FAAB $ at `PRICE_PER_POINT`) and, with `?team=`, **Fit** (optimal-lineup gain, max bid capped by remaining FAAB). `getPlayersIndex` caches a slim `/players/nfl` for 6h; `getInjuryStatuses` derives from it. `waiver-opportunity.js` was removed (superseded by Fit).
- Benchmark Fantasy Life lot 1 (`docs/benchmark-fantasylife.md`) is live: `/standings/` shows Luck (`standings-luck.js`: actual − all-play expected wins, same gate) + Playoff % + an inline-SVG rank-history chart; `/api/free-agents` also returns `trending` (Sleeper `/players/nfl/trending/add`, 48h) and `faabHistory`/`faabByPosition` (winning `waiver_bid`s) via `league-market.js`; Game Center cards list unavailable starters (Out/IR…) with ≈points lost; `/api/lineup-advisor` returns `optimal` (`compareWithOptimalLineup`: current vs optimal lineup gain). `weeklyEstimate` returns 0 for Out/IR **before** reading a projection — Sleeper keeps stale projections for Out players.
- Playoff odds (`computeLivePlayoffOdds` in site.js, shared by Power Rankings and Standings) map Sleeper rosters to canonical Supabase managers **by team name** (`buildPlayoffProbabilityContext(currentWeek, matchupRows, expectedManagers)`); Sleeper display names differ from Supabase owners (`t0z`/`tOz`, `Shiro00`/`MouhammadAT`, `bmb22`/`Birama`) and the mismatch used to drop those teams from every simulated game. An unmatched team now aborts the estimate instead of publishing a wrong number.
- `GET /api/usage?team=` (`getUsageReport` → pure `public/assets/usage-score.js`, `docs/prd-usage-score.md`): Usage Score 0–100 per RB/WR/TE from Sleeper `/stats` shares (targets, air yards, snaps, carries, red zone vs same-week team totals), per-position least-squares xFP refit each call, `BUY_LOW`/`SELL_HIGH` signals. Trade Hub tab "Usage & Buy-Low" (`#usage`). Every Trade Hub tab with a roster (Finder, Waivers, Start/Sit, Usage) has its own team selector sharing `selectedRosterId`.
- Rest-of-season value is shared (`public/assets/rest-of-season.js`, `usageAdjustedRosPpg`): Sleeper projections for the next `DIRECT_PROJECTION_WEEKS` (2), then a 50/50 blend with usage xFP for RB/WR/TE (Sleeper's far weeks are stale). Used by Waiver v2 ("ROS (proj.+usage)") and the Trade Finder, which also gives a small bonus for buying a BUY_LOW / selling a SELL_HIGH.
- `GET /api/player-values` (`loadPlayerValues` in `scripts/analyze-trades.js`) serves the same per-player `rosPpg`/usage signals to the browser Trade Finder that `/api/trades` and n8n use — one computation, no drift between page and bulletin. `rosPpg` already averages the bye in as 0, so `restOfSeasonEstimate` must not subtract the bye again.
- Playoff odds are calibrated (`docs/prd-playoff-probabilities.md`): a persistent per-team strength error (`estimateTeamStrengthSd`, from completed-week residuals, floor `MIN_TEAM_STRENGTH_SD`) plus a 50 % shrink of projected edges beyond `NEAR_WEEKS` (2).
- `GET /api/lineup-advisor` (`scripts/lineup-advisor.js`) flags every starter that is an empty slot, has a Sleeper `injury_status`, or is on a bye (using official `BYE_WEEKS_2026` in `league-settings.js`), and suggests the best bench player or free agent to swap in. Surfaced as the Trade Hub's "Start/Sit Advisor" tab. Fetches Sleeper's full `/players/nfl` dump (~15MB) for injury status, cached in-process for 6h.

## Commands

```bash
npm install                        # install deps (only dependency: @supabase/supabase-js)
npm run dev                        # serve public/ at http://localhost:8000
npm start                          # production server + /api/trades on $PORT (default 3000)
npm test                           # node --test — runs everything in test/
node --test test/trade-value.test.js   # run a single test file
npm run check                      # scripts/verify-static.js — validates routes, asset versions, data reconciliation
npm run sync:sleeper                # Sleeper -> Supabase, needs SUPABASE_URL/SUPABASE_SECRET_KEY
npm run sync:sleeper:production     # same, loads ignored .env.production
npm run analyze:trades -- --team=t0z --json   # CLI trade analyzer (also --team=all)
npm run context -- --team=t0z --json          # CLI "Copy AI Context"
npm run waivers -- --position=RB --limit=15   # CLI waiver wire report
npm run advisor -- --team=t0z --json          # CLI Start/Sit Advisor
```

There is no build step, bundler, or linter — plain ES modules run directly by Node and loaded natively by the browser.

## Architecture

Three data layers feed one static, framework-free frontend:

1. **Frozen Yahoo archive** — `public/data/yahoo-*.json`. Hand-verified historical evidence (2019–2025). Never regenerated at runtime; only replace it after the reconciliation checks in `AGENTS.md` pass.
2. **Live Supabase (Postgres)** — `supabase/schema.sql`. `owners` is the canonical cross-platform identity; `owner_platform_ids` maps a Sleeper/Yahoo/NFL platform user ID to one `owner`, so `seasons`/`teams`/`matchups` work identically for any platform without a schema change. `supabase/functions/sync-sleeper` is an edge-function mirror of `scripts/sync-sleeper.js`.
3. **Live Sleeper REST API** — called directly, unauthenticated, both from the browser (`public/assets/site.js`) and from Node (`scripts/analyze-trades.js`, `scripts/sync-sleeper.js`) for anything that must reflect the current week (rosters, settings, standings).

**Server (`server.js`)**: a dependency-free `node:http` static file server for `public/`, plus three read-only JSON routes: `/api/health`, `/api/settings` (serves `public/assets/league-settings.js` constants), and `/api/trades` (wraps `scripts/analyze-trades.js`, used by n8n's weekly workflow). `resolvePublicPath` guards against path traversal outside `public/`. `createAppServer({ analyze })` accepts an injected `analyze` function specifically so `test/trade-api.test.js` can hit the real HTTP handler without a network call.

**Frontend**: every route is a static `index.html` that loads `public/assets/site.js`, the single shared entry point. It reads `document.body.dataset.page` to render the header/nav, then imports per-feature pure modules — `power-rankings.js`, `playoff-race.js`, `rivalry-week.js`, `matchups-live.js` (Game Center, which itself imports `weekly-recap.js`), `trade-ui.js` (which itself uses `trade-value.js` + `trade-recommender.js`). These modules take data in and return computed results with no DOM/network access, which is what makes them unit-testable in `test/` via plain `node --test`. Module imports are cache-busted with `?v=N` query strings; `scripts/verify-static.js` (`npm run check`) enforces that every route's HTML references the same `site.js`/`styles.css` version, so bumping a version means updating it everywhere and re-running `check`.

**Trade Hub data flow**: `scripts/analyze-trades.js` fetches live rosters/users from Sleeper, loads `public/data/players-catalog.json`, and calls the pure `trade-recommender.js`/`trade-value.js` logic — usable identically from the CLI, from `/api/trades`, and from the n8n trade-alert workflow.

**Tests** (`test/*.test.js`) mirror the pure modules 1:1 (`power-rankings`, `playoff-race`, `rivalry-week`, `matchups-live`, `weekly-recap`, `trade-value`, `trade-recommender`, `league-settings`, `lineup-advisor`) plus `*-api.test.js` files for each HTTP route (`/api/trades`, `/api/context`, `/api/free-agents`, `/api/lineup-advisor`) via `createAppServer`'s injected dependencies. No test touches real Supabase or the network.
