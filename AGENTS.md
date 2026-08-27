# Repository Guidelines

## Project Structure & Module Organization

- `scripts/sync-sleeper.js` fetches Sleeper data and upserts it into Supabase.
- `supabase/schema.sql` defines tables, constraints, RLS policies, and `v_standings`.
- `public/` contains five static routes, shared assets, Yahoo history, 609 verified regular-season matchups, and 44 archived playoff games.
- `supabase/yahoo-sleeper-reconciliation.md` records identity evidence and approvals.
- `.env.example` documents server configuration; keep local values in `.env`.

Keep ingestion logic in `scripts/`, database changes in `supabase/`, and browser-facing assets in `public/`. The current frontend is framework-free and deployed through Coolify.

## Architecture & Scope

Keep platform sources, Supabase, and the read-only UI separate. Sleeper is live data for 2026 onward; `public/data/yahoo-history.json` holds the verified 2019–2025 Yahoo archive and public manager names. Identity coverage is complete at 88/88 across 16 managers. `owners` is canonical, with private platform IDs linked through `owner_platform_ids`. Never guess cross-platform owner matches; use `supabase/yahoo-sleeper-reconciliation.md` for evidence and approval.

## Yahoo Data & Access

The published archive does not come from the Yahoo Fantasy API. OAuth authorization with `fspt-r` succeeded, but tested Fantasy resources returned HTTP 403 (`This application is not authorized to perform this action`). Do not claim the API is active and do not retry app creation unless Yahoo offers **Fantasy Sports Read**.

If API access is restored, use the server-side authorization-code flow, keep access and refresh tokens out of the browser and repository, discover league keys through `users;use_login=1/games;game_keys=nfl/teams`, then request league resources under `https://fantasysports.yahooapis.com/fantasy/v2/`. Never construct league keys from numeric IDs alone.

The working archive path is the user's authenticated Chrome session. Read archived pages at `https://football.fantasysports.yahoo.com/{year}/f1/{league_id}`, regular-season scoreboards with `?matchup_week=N&module=matchups&lhst=matchups`, and championship brackets with `?module=standings&lhst=playoff#lhstplayoff`. League IDs are 2019 `103079`, 2020 `67190`, 2021 `75892`, 2022 `109259`, 2023 `767350`, 2024 `534755`, and 2025 `518783`. The completed extracts are `public/data/yahoo-matchups.json` (regular season) and `public/data/yahoo-playoffs.json` (2019–2024 championship bracket); `/matchups/` combines the latter with the existing 2025 bracket. Do not replace regular-season data unless every season reconciles exactly against final W/L/T/PF/PA. Do not replace playoff data unless each final and third-place game matches the verified podium. Treat pages as read-only evidence: do not inspect cookies or browser storage, do not save OAuth tokens, and record source URLs with extracted data. Pace requests by season; if Yahoo displays `Request denied`, stop instead of retrying in a loop, preserve the last validated batch, and resume later from the first missing week.

Supabase server credentials live only in ignored environment files and production services. Use the Supabase MCP when available; otherwise use `.env.production` without printing its values. The browser may use only the publishable key.

## Build, Test, and Development Commands

- `npm install` installs dependencies.
- `npm run dev` serves `public/` at `http://localhost:8000`.
- `npm run check` validates routes, assets, season totals, regular-season reconciliation, playoff rounds, and podiums.
- `npm run sync:sleeper` runs the idempotent Sleeper-to-Supabase synchronization. It requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; `SLEEPER_LEAGUE_ID` and `SEASON_YEAR` are optional overrides.

There is no compile step or linter yet. Test data-writing changes against non-production Supabase and verify UI changes in a browser.

## Coding Style & Naming Conventions

Use two-space indentation in JavaScript, HTML, and CSS. Follow existing ES module style, prefer `const`, use `async`/`await`, and keep functions focused. JavaScript identifiers use `camelCase`; environment constants use `UPPER_SNAKE_CASE`; SQL tables and columns use `snake_case`. Keep SQL keywords lowercase to match the schema. Preserve the sync script's idempotent upsert behavior and explicit error checks.

## Testing Guidelines

Add focused tests under `test/`, named like `sync-sleeper.test.js`, plus an `npm test` script. Cover API failures, matchup pairing, and repeat-run behavior. For schema changes, verify constraints, public-read policies, and private platform identifiers.

## Commit & Pull Request Guidelines

History starts with the concise `Initial scaffold: schema + Sleeper sync script`. Use short, imperative subjects naming the affected area. PRs should explain behavior, list verification, link issues, and include screenshots for UI changes. Call out migrations and environment-variable changes.

## Security & Configuration

Never commit `.env` files or the Supabase secret key. Only the publishable key belongs in browser code, and its access must remain constrained by row-level security. Test schema or sync changes outside production first.
