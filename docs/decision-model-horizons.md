# Decision model: qualification and playoffs

The acquisition plan still optimizes qualification through week 14. Each displayed candidate also exports independent `objectiveFits` for qualification, the full playoffs (15–17), and each playoff week. Each fit compares legal roster alternatives on that window with the same lineup optimizer and cut costs. These future scenarios are not executable plans: locks, acquisitions, role and availability must be revalidated. Their gains are never added to qualification gains or interpreted as playoff odds. Missing weekly projections leave the window unpriced. Sleeper projections are fetched through week 17; regular-season coverage remains reported separately.

## Confirmed injury evidence

Use the existing private `DECISION_EVIDENCE_FILE`, version 1, scoped to league, season and target week. An `eventsById` injury entry may contain `outThroughWeek` (inclusive) or `seasonEndingConfirmed: true`, together with `type: "INJURY"`, source, observedAt and expiresAt. Existing event-group fields (`nflTeam`, `positions`) still apply. Only current, scoped evidence counts. The model never infers a four-week absence from the IR label and never equates the end of a confirmed absence window with a confirmed return. Confirmed absences override stale weekly projections. An injured player's unknown return produces an unpriced strategic score and INJURED_STASH, rather than BREAKOUT; confirmed absence throughout qualification gives zero qualification upside.

## Cut uncertainty and handcuffs

Normalized missing usage is null. Skill players with unknown usage, and RBs identified as possible handcuffs from a better-ranked same-team RB, have an unpriced option: they cannot win a quantitative cut comparison. They remain visible with UNKNOWN regret; if no covered alternative exists, the model designates no cut and blocks the claim. This is deliberately conservative: a handcuff's contingent value is not calibrated. It does not invent injury probabilities or fantasy points. Legacy callers should normalize missing usage to null. QB/K/DEF do not require skill-position usage coverage.

Trade recommendations export the total lost bench asset value as `rosterConsequences.{mine,theirs}.cutCost`, in TRADE_VALUE units, and subtract both sides' cut costs from ranking. This depth cost is separate from lineup points and never subtracted from lineup deltas again. Missing candidate cuts degrade calculation reliability. Platform locks and the actual ability to drop remain unverified.

## Passing participation

Usage evidence now includes target share, air-yards share, and optional published `rec_routes` divided by team dropbacks (attempts + sacks), plus targets per route. Route metrics require coverage of every sampled game and are never reconstructed from offensive snaps. Missing routes stay null. BUY_LOW retains its production-versus-xFP definition and exports these participation diagnostics; route coverage is not predictive validation.

## Verification

Regression checks cover injured usage surges, dated/stale absence evidence, independent playoff coverage, missing usage, possible handcuffs, published/missing route counts, and trade cut costs. Existing snapshot replay tests must reproduce the live objective fits from archived source inputs.
