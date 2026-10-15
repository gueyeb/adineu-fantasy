# Readability pass — 15 October 2026

Scope: Coach WR schedule panel, explanatory copy in Trade Hub, and SOS Explorer labels/status. This is a focused improvement pass, not an audit of every app route.

## Evidence and findings

1. **Coach — poor before, compact desktop preview verified.** The user supplied an authenticated Coach screenshot. A local copy was saved and inspected at `output/readability-audit/01-coach-before.png` (ignored by Git because this is a private screen). A fresh Chrome screenshot and accessibility tree confirmed the same layout. The header incorrectly used a generic three-column grid with only two children, squeezing its text into the 44 px index column. Unstyled inline row content glued names, teams, ranks and scope labels together. Repeating the long score unit and explanation obscured comparison.
2. **Trade Hub — dense explanatory copy identified in source.** The Trade Finder gain definition and waiver scenario introduction each presented a methodology paragraph before results. This pass retains every scoring/cost caveat under named native disclosures and keeps a short reading instruction visible. Actionable warnings, trade evidence, acquisition steps, budgets and lineup calculations are unchanged. A fresh visual pass of this route was not completed after Chrome disconnected.
3. **SOS Explorer — labels and technical metadata simplified.** Long option labels and the default snapshot hash competed with the ranking. Option text is shorter, status dates are readable, and the full snapshot identity remains in the existing methodology section. Missing-data reasons are translated into French. The distinction between current retrospective data, frozen forecasts and evaluation remains available through the perspective selector and detailed method. Numerical outputs and filtering logic are unchanged. Visual verification of this route remains outstanding after browser disconnection.

## Changes

- `coach-sos-view.js` owns the compact UI only. The roster is a captioned table: player/team, rank with French difficulty label, next three opponents. Player names open score and coverage details. Waiver candidates are grouped in a closed disclosure rather than mixed into the default roster list.
- The header has its own two-column layout instead of inheriting the indexed-panel grid. Focus outlines and minimum 44 px disclosure targets support keyboard and touch access; missing coverage never produces a fabricated score or rank.
- Snapshot IDs, raw capture timestamps, scoring units and the full explanation are retained on demand. There is one visible guardrail that SOS alone does not determine an add/start decision.
- `.method-note` is a reusable disclosure treatment for methodology across the Coach and Trade Hub. Do not globally hide paragraph text or diagnostics as a shortcut to readability.

## Reusable rules

Put the decision or comparison first. Put repeated units in headings or a named explanation. Separate roster context from market candidates. Use short human labels and dates in the default view; preserve technical provenance on demand. Keep blocking warnings and uncertainty visible. Never remove evidence or change fantasy calculations to make a screen look simpler.

## Verification and limits

507 Node tests pass, including new checks for closed-by-default disclosures, candidate grouping, partial coverage, escaping, unchanged inputs and missing-data states. `npm run check` and asset version checks pass. Build, type-check and lint scripts are not configured.

The new Coach component was rendered in Chrome on a local preview using the current public context endpoint's SOS data. Its screenshot was visually inspected at desktop width, and native disclosures were opened to verify numeric score/coverage and waiver candidates. The before image and rendered desktop screenshot were compared directly. The live screenshot was displayed through the browser tool; an additional local screenshot-file capture could not be obtained after the connection was lost. The user-supplied before capture remains available locally. No private screenshots or roster dumps are committed.

Chrome became unavailable during the narrow-viewport check. Responsive CSS is implemented, but a new mobile screenshot, full keyboard traversal, and a complete accessibility audit are not claimed. The private production Coach was inspected before deployment; deployment restarts may invalidate its in-memory session, so an authenticated production recheck requires a live browser session. Public asset fingerprints can be checked independently after push.
