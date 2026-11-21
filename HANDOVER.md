# Agent session handover

Updated: 2026-11-21. Read `AGENTS.md` before continuing.

## Current state — 21 November

- ADIN-17 fixed and deployed in `88be7c1`: weekly optimizer gets the target week,
  excludes byes/absent players and never falls back to rank/ADP when a weekly
  projection is missing. Incomplete eligible coverage yields null gain/optimum,
  no proposed swaps and a visible warning. Optimal/Boom/Safe share exclusions.
- Coolify deployment `js08o40o8wwc8880g88w4wsk` Running on `88be7c1`;
  production `/api/version` matches 15/15 local hashes including lineup-advisor.
- 738 tests passed, static checks passed; four subsequent targeted version/Coach
  HTTP tests passed after extending the source fingerprint manifest. No build,
  type checker or linter configured. Initial sandbox HTTP failures were EPERM;
  the complete rerun outside the sandbox passed.
- Plane now has **15 completed / 2 open** tickets. ADIN-15/16 reviews completed,
  then ADIN-1/3/5/8/11/12/13/17 completed with dated evidence.
- See [full review](docs/plane-status-review-2026-11-21.md) and the structured
  [fixed-snapshot trade comparison](docs/trade-snapshot-review-2026-11-21.json).
  Current roadmap reconciled; older dated entries are historical.
- Production Coach/journal verified with the user's authenticated session at
  390×844, no overflow or console errors. Sessions live in server memory:
  deployment logs out the user; a second login was needed during this audit.
- n8n reviewed read-only: Tuesday sync Europe/Paris at 10:00; Thursday review
  inherits Europe/Berlin at 09:00 (same Paris offset/DST on checked dates).
  Successful executions on 10/17 and 12/19 November. Coach notify gate published
  (`notify !== false`), successful 10/17 November runs. No manual notification
  sent, workflow/credential changed, or Sleeper transaction performed.
- Supabase/Sleeper public score audit S1–S10 MATCH; RB/WR S7 snapshots from
  20 October directly verified. Model coefficients unchanged after S9–S10 and
  four-week expert benchmark review; no robust universal winner.

### Remaining work

1. **ADIN-10** (renamed to journal adoption): real operator choices/reasons still
   absent; UI and reviews are functional. Do not invent choices or infer refusals.
2. **ADIN-14** (renamed to in-game observation): deploy/mobile/scenario/details
   checks passed, but actual progression during an NFL game remains unobserved.

Role-profile evaluation (20 windows) and SOS QB/TE decision remain open on the
roadmap; QC completion does not declare them shipped. This session's changes
exclude pre-existing `CLAUDE.md`, `docs/player-intelligence-n8n.md`,
`scripts/audit-nfl-injuries.js` and `test/audit-nfl-injuries.test.js` edits.
The roadmap's pre-existing Plane migration metadata was preserved while updating
its current status. Temporary preview server stopped after verification.

## Archived handover — 8 November (superseded by the current state above)

## Completed this session

- Audited the requested Plane backlog against repository evidence and production
  Supabase, using read-only queries. Full findings:
  [Plane status review](docs/plane-status-review-2026-11-08.md).
- Reconnected OAuth for `plane-dakhine`; confirmed workspace `dakhine-hq`
  (Dakhine HQ), project ADIN `867cd2b5-546a-40d9-a47a-9734ce265358`.
  `plane-khayma` is a different workspace and cannot resolve ADIN tickets.
- Read all 14 existing ADIN tickets. Updated descriptions of ADIN-7, 8, 9, 10,
  13 and 14 with evidence and remaining checks; no tickets closed.
- Created ADIN-15: projections/FAAB S9–S10 review, next check 2026-11-10.
- Created ADIN-16: expert benchmark verdict after four valid scored weeks,
  earliest expected review 2026-11-17. These dates depend on completed weeks
  and successful captures; no scheduled execution was created.
- Added detailed real-data validation to ADIN-10. Two/four-week reviews exist;
  claims lost keep net null and incomplete windows are not published as reviews.

## Findings to preserve

- Latest checked production model feedback: S8, generated 2026-11-03
  09:00:29 UTC. Weekly S9 snapshot exists. S8 Adineu MAE is worse than Sleeper
  at horizons 2 and 3, slightly better at 4. Do not adjust coefficients from
  this single week.
- S8 auction Brier: 0.218 vs constant baseline 0.248, 29 scored bids.
  Auction probability, rival bid interval coverage and winning-price range
  coverage are distinct metrics.
- Expert benchmark has only S7/S8 scored in the checked report; FantasyPros
  available, Draft Sharks/CBS not configured. Adineu equals Sleeper at horizon 0;
  this comparison does not test the long-horizon usage blend.
- Journal roster 1 last checked sync: 2026-11-05 08:00:45 UTC. Reviews at
  two weeks through S7 and four through S5. MODEL_PLAN S7–S9 have no explicit
  `details.choices`; never infer refusal from an absent transaction.
- Hockenson S5: 31 points produced over four weeks but only 1.7 actually started.
  Player production, realized lineup contribution and hindsight optimal lineup
  gains must remain distinct. Bo Nix's +20.18 is a hindsight counterfactual,
  with no recorded cut; S7 trade option was not recorded and is not scorable.

## Next actions

1. ADIN-10 / ADIN-12: verify the authenticated Coach journal at mobile 390 px,
   including real move, lost claim and skipped recommendation. Explicit choices
   must come from the operator; do not manufacture an adoption example in prod.
2. ADIN-14: mobile verification, observation during an NFL game and dated
   deployed-version evidence. Browser access host was unavailable in this session.
3. ADIN-15: after S9 completes, read feedback and compare identical cohorts by
   position/horizon, FAAB Brier and interval coverage. Do not run a data-writing
   weekly job merely to inspect existing reports.
4. ADIN-16: review once at least four valid pre-kickoff captures have been scored;
   postpone the verdict if coverage is insufficient.
5. ADIN-7/9/13: finish operational/manual and deployment evidence before closing.
   Existing documentation and passing tests alone do not prove deployment.

## Verification and workspace

- `npm test`: 717 passed, zero failures.
- `npm run check`: passed (11 routes, 15 franchises, 609 regular-season and
  52 playoff Yahoo games).
- Follow-up: 24 targeted decision-log, decision-counterfactual and
  decision-journal tests passed.
- No application code, model weights, production data or n8n workflow changed.
- Pre-existing edits to `CLAUDE.md` and `docs/product-roadmap.md` were left
  untouched and excluded from this session's commit.
