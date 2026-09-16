# Product Architecture Audit — Adineu Fantasy

Requested before a home page redesign, on the reasoning that redesign decisions should be
informed by the actual state of the codebase rather than guessed. Method: read every
`public/assets/*.js` and `scripts/*.js` file's size and role, grepped for duplication and
inconsistency, and cross-checked against `AGENTS.md`'s stated conventions. Nothing below required
code changes to observe — this is diagnostic only, except the home page fix in the companion
section at the end, which was explicitly requested alongside this audit.

## What's solid (worth explicitly preserving)

- **Data integrity discipline.** `scripts/verify-static.js` (476 lines) re-derives and
  cross-checks the entire Yahoo archive on every `npm run check`: season/team counts, champion
  consistency, identity coverage, matchup counts against real W/L/T/PF, streak/record recomputation,
  podium verification. This isn't bloat — it's the thing that has caught real mistakes across this
  session and should not be trimmed.
- **"Never fabricate" discipline is genuinely followed**, not just stated in `AGENTS.md`: every
  probabilistic feature (Power Rankings gate, Playoff Race, Playoff Probabilities, matchup win %,
  Waiver Opportunity Cost) suppresses its own output rather than showing a placeholder when data is
  incomplete. This is consistent across authors and across months of the project's history, not
  just this session's additions.
- **Test coverage is real, not decorative**: one test file per pure module, `node --test`, no
  framework overhead. 143 tests currently, all passing.
- **`AGENTS.md` is accurate and current** — cross-checking it against the actual code during this
  audit found no drift. That's unusual and worth keeping up.

## Findings

### 1. Home page under-represents the live 2026 season (fixed in this pass)

`renderHome()` (`site.js`) only linked to Rivalry Week, Hall of Fame, and History — all
archive-facing. None of the seven other routes (Power Rankings, Trades, Matchups, Teams,
Standings, and everything shipped this session: Playoff Probabilities, Waiver Opportunity Cost,
Record Watch, Transactions) had any presence on the front door. A visitor arriving mid-season saw
a page framed entirely around 2019–2025. Fixed in this pass — see below.

### 2. The browser cache-busting scheme is manual and has already caused near-misses

Every asset import carries a hand-written `?v=N` query string (`site.js?v=28`, `trade-ui.js?v=11`,
etc.), and every one of the 10 route HTML files repeats the current `site.js`/`styles.css`
version. **69 occurrences of `?v=N` across the repo** need to move together whenever a shared
module changes. This isn't hypothetical: twice this session, a version bump missed a file (once
`public/index.html`, caught only by `verify-static.js` failing). The check catches it every time,
but the failure mode is "ship a stale cached module in production until someone re-runs `npm run
check`," which a pre-deploy CI hook would catch earlier than a manual run.
*Mitigation, not urgent*: either a small build step that injects a content hash automatically, or
at minimum a single source-of-truth constant + a script that rewrites every reference, instead of
sed-ing N files by hand per change.

### 3. Sleeper roster/user data is fetched independently in (at least) four client modules

`site.js`, `teams.js`, `trade-ui.js`, and `matchups-live.js` each call
`/league/{id}/rosters` and `/league/{id}/users` and re-shape the result themselves, with three
subtly different player-shaping conventions (`formattedRosters` in `trade-ui.js` differs from what
`teams.js` builds, which differs again from the shape `playoff-probabilities.js`'s caller in
`site.js` builds). Cost: extra round-trips per page load, and a standing risk that a bug fixed in
one module's roster-shaping logic doesn't get fixed in the other three.
*Mitigation, not urgent*: this is exactly what `roster-view.js`'s `listRosterIdentities` already
does for identity — it's a real precedent for factoring the fetch-and-shape step once. Only worth
doing when a fifth consumer needs it (project's own "factor at the threshold of duplication, not
before" — which the codebase has otherwise followed well).

### 4. `trade-ui.js` bypasses the site's design system

249 inline `style="..."` attributes in `trade-ui.js`, versus 1 in `teams.js`, 3 in `site.js`, 0 in
`rivalry-week.js`. Every other page composes from `styles.css` classes; the Trade Hub was built as
a self-contained set of inline styles instead, so `styles.css` doesn't fully describe the site's
visual language, and a global style change (spacing, color token, dark-mode variant) silently
won't reach the Trade Hub. Functionally fine today — worth knowing before the next visual pass
touches this page, since it would need its own conversion effort separate from a CSS-token change
elsewhere.

### 5. `site.js` is a 1,380-line single file rendering nearly every route

Not unreasonable at the site's current size (one file per *concept* like `trade-ui.js` gets its
own module; `site.js` is really "everything that didn't get its own module yet" plus routing).
Not urgent, but the next page added to the main nav is a natural point to ask whether it deserves
its own file the way `trade-ui.js` and `teams.js` already do.

## Non-findings (checked, no issue)

- Supabase usage is properly scoped: only `scripts/sync-sleeper.js` (server-side, secret key) and
  read-only publishable-key usage in `teams.js`/`site.js`, matching `AGENTS.md`'s stated boundary.
- No secrets or private platform identifiers found in public JS or archive JSON (this is actively
  checked by `verify-static.js` already).
- Navigation itself is complete and correct — every route is reachable from the header, including
  the Trades sub-menu. The home page problem (finding #1) is about the landing page's own content,
  not the site's information architecture.

## Home page redesign — what shipped in this pass

Scope was deliberately narrow: fix finding #1 only, using the existing design language and grid
CSS unchanged (no new styles, no new network calls on the highest-traffic page). The hero and the
four archive stat tiles are untouched — the stats are still accurate and still worth leading with.

The feature grid gained two cards, inserted right after the existing Rivalry Week hero: **Power
Rankings & Playoffs** (links to `/power-rankings/`, mentions the playoff probability estimate
shipped this session) and **Trade Hub** (links to `/trades/`, mentions counter-offers and waiver
opportunity cost). Hall of Fame and History keep their cards, now third and fourth rather than
first and second. This directly answers finding #1 — a mid-season visitor now sees live-season
features before archive features — without touching CSS or adding a live data dependency to the
home page.

**Deliberately not done in this pass** (flagged, not built): a live "current week" or "current
leader" snapshot on the hero would need a new Sleeper fetch on the home page itself — every other
live number on the site is fetched by the page that needs it, not pre-loaded on the landing page.
Worth doing later if wanted, but it's a new architectural pattern (home page becomes
network-dependent) that deserves its own decision rather than folding into this pass.

## Suggested sequencing

Findings #2–#5 are tech debt, not bugs — nothing here blocks a feature or is visibly broken today.
None are proposed for this pass. If any becomes worth doing, the natural trigger for each is noted
above (a fifth Sleeper-fetching consumer; the next visual pass on Trade Hub; the next new main-nav
page). Re-raise any of them when you want to schedule the work; none are time-sensitive.
