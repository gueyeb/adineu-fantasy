# Repository Guidelines

## Project Structure & Module Organization

- `scripts/sync-sleeper.js` fetches Sleeper data and upserts it into Supabase.
- `supabase/schema.sql` defines tables, constraints, RLS policies, and `v_standings`.
- `public/` contains five static routes plus shared assets and the Yahoo archive JSON.
- `.env.example` documents server configuration; keep local values in `.env`.

Keep ingestion logic in `scripts/`, database changes in `supabase/`, and browser-facing assets in `public/`. The current frontend is framework-free and deployed through Coolify.

## Architecture & Scope

Keep platform sources, Supabase, and the read-only UI separate. Sleeper is live data for 2026 onward; `public/data/yahoo-history.json` holds the verified 2019–2025 Yahoo archive and public manager names. `owners` is canonical, with private platform IDs linked through `owner_platform_ids`. Never guess cross-platform owner matches; use `supabase/yahoo-sleeper-reconciliation.md` for manual approval.

## Build, Test, and Development Commands

- `npm install` installs dependencies.
- `npm run dev` serves `public/` at `http://localhost:8000`.
- `npm run check` validates routes, assets, years, team counts, and champions.
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
