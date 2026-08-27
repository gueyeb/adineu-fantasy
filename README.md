# Adineu Fantasy

Public standings site and data pipeline for **Adineu**, a friends' NFL fantasy football league running since the early 2020s — Yahoo through 2025, [Sleeper](https://sleeper.com/) from 2026 on.

Status: **live build**. The site combines Sleeper standings for 2026 onward with a verified Yahoo archive for 2019–2025.

## What's here

- `supabase/schema.sql` — Postgres schema (owners, seasons, teams, matchups + a `v_standings` view). Designed so a season from any platform (Sleeper, Yahoo, eventually the old NFL Fantasy) slots into the same tables — no schema change per source.
- `scripts/sync-sleeper.js` — pulls the live league from Sleeper's public API (no auth required) and upserts it into Supabase. Idempotent, safe to re-run or schedule.
- `public/` — framework-free clubhouse with standings, matchups, history and Hall of Fame routes.
- `public/data/yahoo-history.json` — season-scoped Yahoo archive: podiums, final standings, weekly highs and 2025 player leaders.

## Why it exists

The group is moving from Yahoo to Sleeper for 2026. Rather than depend on any one platform, this keeps a small, owned copy of the league's data and serves it as a public read-only site. Historical participation is stored per season; similarly named teams are never assumed to be the same manager.

## Setup

1. Create a Supabase project and run `supabase/schema.sql` against it once (SQL editor, or `psql`).
2. Sync script:
   ```bash
   npm install
   cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SECRET_KEY
   npm run sync:sleeper   # uses environment variables already exported by the shell
   npm run sync:sleeper:production # loads the ignored .env.production file
   ```
3. Run `npm run dev` and open `http://localhost:8000`. Use `npm run check` to validate every route and archived season before deployment. Never expose the secret key in browser code.

Wire the sync command into a weekly schedule (n8n, cron, whatever) once it's deployed — see the script's header comment for details.

## Roadmap

1. Sleeper → Supabase sync + public standings page ✅ (this repo)
2. Reconcile Yahoo manager profiles with canonical owners, without guessing aliases
3. Power rankings, all-time head-to-head, franchise records
4. Nice-to-haves: draft grades, trade analyzer

## License

Not decided yet — treat as "all rights reserved" until a license file is added.
