# Adineu Fantasy

Public standings site and data pipeline for **Adineu**, a friends' NFL fantasy football league running since the early 2020s — Yahoo through 2025, [Sleeper](https://sleeper.com/) from 2026 on.

Status: **early build**. Phase 1 (Sleeper sync → live standings) is in progress; Yahoo 2025 history is a planned Phase 2.

## What's here

- `supabase/schema.sql` — Postgres schema (owners, seasons, teams, matchups + a `v_standings` view). Designed so a season from any platform (Sleeper, Yahoo, eventually the old NFL Fantasy) slots into the same tables — no schema change per source.
- `scripts/sync-sleeper.js` — pulls the live league from Sleeper's public API (no auth required) and upserts it into Supabase. Idempotent, safe to re-run or schedule.

## Why it exists

Yahoo retired this league's history to a single season and the group is moving to Sleeper for 2026. Rather than depend on any one platform, this keeps a small, owned copy of the league's data and serves it as a public read-only site — plus it's a clean excuse to apply data-reconciliation practice (same friends, same teams, no shared IDs across platforms) to something with zero stakes.

## Setup

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + service role key
```

Run `supabase/schema.sql` once against your Supabase project (SQL editor, or `psql`), then:

```bash
npm run sync:sleeper
```

Wire that command into a weekly schedule (n8n, cron, whatever) once it's deployed — see the script's header comment for details.

## Roadmap

1. Sleeper → Supabase sync + public standings page (this repo, in progress)
2. Yahoo 2025 season import into the same schema
3. Power rankings, all-time head-to-head, franchise records
4. Nice-to-haves: draft grades, trade analyzer

## License

Not decided yet — treat as "all rights reserved" until a license file is added.
