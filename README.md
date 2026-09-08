# Adineu Fantasy

Public clubhouse and data pipeline for **Adineu**, a friends' NFL fantasy football league. The live site combines a verified Yahoo archive for 2019–2025 with [Sleeper](https://sleeper.com/) data from 2026 onward.

Status: **live** at [adineu-fantasy.bakene.tech](https://adineu-fantasy.bakene.tech/). The 2026 Sleeper league has all 12 managers, and the completed draft roster is available to the Trade Hub.

## What's here

- `supabase/schema.sql` — Postgres schema (owners, seasons, teams, matchups + a `v_standings` view). Designed so a season from any platform (Sleeper, Yahoo, eventually the old NFL Fantasy) slots into the same tables — no schema change per source.
- `scripts/sync-sleeper.js` — pulls the live league from Sleeper's public API (no auth required) and upserts it into Supabase. Idempotent, safe to re-run or schedule.
- `scripts/analyze-trades.js` — automatable in-season trade analyzer for CLI and n8n (roster diagnosis, win-win synergies, handcuff leverage).
- `server.js` — production static server plus the read-only `/api/trades?team=t0z` endpoint used by n8n.
- `public/` — framework-free clubhouse with nine routes, including the 2026 Power Rankings, Rivalry Week, and Trade Hub pages.
- `public/assets/trade-value.js` & `public/assets/trade-recommender.js` — pure, tested deterministic trade valuation and matchmaking engines.
- `public/assets/power-rankings.js` — pure, tested ranking engine. It waits for two complete regular-season weeks before publishing.
- `public/assets/rivalry-week.js` — tested records and Sleeper-mapping logic for the six proposed Week 8 rivalries, plus the Rivalry Tracker that folds played 2026 Sleeper meetings into each pair's all-time record.
- `public/assets/matchups-live.js` — 2026 Game Center: current-week scores, pregame projections, schedule browser, a Récap Hebdo tab, lineup warnings, and Yahoo head-to-head context.
- `public/assets/weekly-recap.js` — pure, tested: highest score, closest matchup, biggest upset vs. the pregame estimate, and bench points left for a completed week.
- `public/assets/playoff-race.js` — pure, tested: current playoffs standings and games-back from the 8th seed, reusing Power Rankings' own win/loss/points-for math and activation gate.
- `scripts/league-context.js` — powers `/api/context` ("Copy AI Context" button) and `/api/free-agents` (Trade Hub's Waiver Wire tab).
- `scripts/lineup-advisor.js` — powers `/api/lineup-advisor` (Trade Hub's Start/Sit Advisor tab): flags empty slots, injured starters, and bye weeks, suggests a bench or free-agent swap.
- `public/data/yahoo-history.json` — season-scoped Yahoo archive: podiums, final standings, weekly highs and 2025 player leaders.
- `public/data/yahoo-matchups.json` — 609 verified regular-season matchups for 2019–2025, with manager mappings and source URLs.
- `public/data/yahoo-playoffs.json` — 44 authenticated championship-bracket matchups for 2019–2024; the UI combines them with the eight verified 2025 playoff games.
- `supabase/yahoo-sleeper-reconciliation.md` — review checklist for linking Yahoo identities to existing Sleeper owners without guessing.

## Why it exists

The group is moving from Yahoo to Sleeper for 2026. Rather than depend on any one platform, this keeps a small, owned copy of the league's data and serves it as a public read-only site. Historical participation is stored per season; similarly named teams are never assumed to be the same manager.

Yahoo profile history confirms all 88 team-season identities across 15 historical managers, including a stable 12-manager core from 2022 through 2025. Birama spans all seven seasons: `El Fenomeno` (2019), `Ethan Hunt` (2020), Yahoo manager `Bombeul22` (2021–2025), and Sleeper displays `bm2222`/`bmb22` are one person. Mat's confirmed Sleeper displays are `MouhammadAT`/`Shiro00` for Kuro.

## Setup

1. Create a Supabase project and run `supabase/schema.sql` against it once (SQL editor, or `psql`).
2. Sync script:
   ```bash
   npm install
   cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SECRET_KEY
   npm run sync:sleeper   # uses environment variables already exported by the shell
   npm run sync:sleeper:production # loads the ignored .env.production file
   ```
3. Run `npm run dev` and open `http://localhost:8000`. Use `npm test` for ranking and trade logic and `npm run check` to validate every route and archived season before deployment. `npm start` serves the production app on `PORT` (3000 by default). Never expose the secret key in browser code.

Production is served by Coolify behind Cloudflare. n8n triggers the deployed sync weekly; the production command above is the manual refresh path. The sync is idempotent, so rerunning it updates existing rows instead of duplicating them. A separate Tuesday workflow calls `/api/trades?team=t0z`, then forwards the returned `message` to the league manager's private notification channel. Sleeper data used by that endpoint is public; no Supabase or Yahoo secret is returned.

## How Yahoo data is acquired

Yahoo's documented integration uses OAuth 2.0. A Yahoo member who can access the private league authorizes an application with Fantasy Sports Read access; the server exchanges the authorization code for an access token and refresh token, then calls resources below `https://fantasysports.yahooapis.com/fantasy/v2/`. A typical discovery request is:

```text
GET /fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json
Authorization: Bearer <access-token>
```

From there, game, league, team, standings, scoreboard, roster, and draft resources can be requested and normalized into the Supabase model. See Yahoo's [Fantasy Sports API guide](https://developer.yahoo.com/fantasysports/guide/) and [authorization-code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/).

That is the intended API path, but it is **not the source of the current archive**. OAuth authorization succeeded for the available Yahoo applications, while every tested Fantasy resource returned HTTP 403 (`This application is not authorized to perform this action`). The current 2019–2025 archive was therefore recovered from authenticated Yahoo league/history pages and captured documents. Weekly scoreboards populate `yahoo-matchups.json`; championship brackets at `?module=standings&lhst=playoff#lhstplayoff` populate `yahoo-playoffs.json`. Every extract retains its Yahoo source URL and is reconciled against the final standings or podium before publication. No Yahoo OAuth token is stored by this project. API automation remains optional if Yahoo enables Fantasy API access for the application.

## Roadmap

1. Sleeper → Supabase sync + public clubhouse ✅
2. Yahoo archive and Hall of Fame for 2019–2025 ✅
3. Yahoo regular-season scoreboards + all-time head-to-head view ✅
4. Yahoo championship brackets and postseason records for 2019–2025 ✅
5. All-time franchise dossiers and record table across 15 managers ✅
6. All-time single-game records and regular-season winning streaks ✅
7. 2026 Power Rankings route, formula, tests, and automatic two-week activation ✅ (live rankings await real matchups)
8. Week 8 Rivalry Week route, head-to-head matrix, historical cards, and live Sleeper schedule detection ✅
9. Trade Hub (Calculateur de trade, moteur de recommandations bilatérales et script n8n) ✅
10. 2026 Game Center with live Sleeper matchups, schedule, projections, and preserved Yahoo archives ✅
11. AI Context, Waiver Wire, and Start/Sit Advisor tools (`/api/context`, `/api/free-agents`, `/api/lineup-advisor`) ✅ (with confirmed 2026 NFL bye-week schedule)
12. Weekly Recap and Playoff Race, both in the Game Center / Power Rankings pages ✅
13. Rivalry Tracker 2026 — played Sleeper meetings automatically join each pair's all-time record ✅
14. Nice-to-haves: weekly awards et notes de draft après saison

## License

Not decided yet — treat as "all rights reserved" until a license file is added.
