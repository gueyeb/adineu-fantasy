# Adineu Fantasy

Public clubhouse and data pipeline for **Adineu**, a friends' NFL fantasy football league. The live site combines a verified Yahoo archive for 2019–2025 with [Sleeper](https://sleeper.com/) data from 2026 onward.

Status: **live** at [adineu-fantasy.bakene.tech](https://adineu-fantasy.bakene.tech/). The 2026 Sleeper league has all 12 managers and rosters synced; its draft is scheduled for September 6 at 22:00 Paris time.

## What's here

- `supabase/schema.sql` — Postgres schema (owners, seasons, teams, matchups + a `v_standings` view). Designed so a season from any platform (Sleeper, Yahoo, eventually the old NFL Fantasy) slots into the same tables — no schema change per source.
- `scripts/sync-sleeper.js` — pulls the live league from Sleeper's public API (no auth required) and upserts it into Supabase. Idempotent, safe to re-run or schedule.
- `public/` — framework-free clubhouse with seven routes, including a data-ready 2026 Power Rankings page.
- `public/assets/power-rankings.js` — pure, tested ranking engine. It waits for two complete regular-season weeks before publishing.
- `public/data/yahoo-history.json` — season-scoped Yahoo archive: podiums, final standings, weekly highs and 2025 player leaders.
- `public/data/yahoo-matchups.json` — 609 verified regular-season matchups for 2019–2025, with manager mappings and source URLs.
- `public/data/yahoo-playoffs.json` — 44 authenticated championship-bracket matchups for 2019–2024; the UI combines them with the eight verified 2025 playoff games.
- `supabase/yahoo-sleeper-reconciliation.md` — review checklist for linking Yahoo identities to existing Sleeper owners without guessing.

## Why it exists

The group is moving from Yahoo to Sleeper for 2026. Rather than depend on any one platform, this keeps a small, owned copy of the league's data and serves it as a public read-only site. Historical participation is stored per season; similarly named teams are never assumed to be the same manager.

Yahoo profile history confirms all 88 team-season identities across 16 historical managers, including a stable 12-manager core from 2022 through 2025. Birama closes the archive with `El Fenomeno` (2019) and `Ethan Hunt` (2020).

## Setup

1. Create a Supabase project and run `supabase/schema.sql` against it once (SQL editor, or `psql`).
2. Sync script:
   ```bash
   npm install
   cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SECRET_KEY
   npm run sync:sleeper   # uses environment variables already exported by the shell
   npm run sync:sleeper:production # loads the ignored .env.production file
   ```
3. Run `npm run dev` and open `http://localhost:8000`. Use `npm test` for ranking logic and `npm run check` to validate every route and archived season before deployment. Never expose the secret key in browser code.

Production is served by Coolify behind Cloudflare. n8n triggers the deployed sync weekly; the production command above is the manual refresh path. The sync is idempotent, so rerunning it updates existing rows instead of duplicating them.

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
5. All-time franchise dossiers and record table across 16 managers ✅
6. All-time single-game records and regular-season winning streaks ✅
7. 2026 Power Rankings route, formula, tests, and automatic two-week activation ✅ (live rankings await real matchups)
8. Nice-to-haves: draft grades and trade analyzer

## License

Not decided yet — treat as "all rights reserved" until a license file is added.
