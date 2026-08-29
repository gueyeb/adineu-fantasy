# Power Rankings Eval

## Capability checks

- Zero or one completed week keeps the ranking unpublished.
- Two completed weeks for all 12 teams activate a 12-row ranking.
- A dominant synthetic team ranks first under the documented 45/35/20 formula.
- The live week and playoff rows never contribute to the regular-season score.
- Equal performances keep the same score and rank.

## Regression checks

- The pre-draft route renders real Sleeper league and draft status without matchup data.
- All seven static routes still load their shared versioned assets.
- Public assets contain no Supabase secret or private platform identifiers.

## Ship signal

`npm test` and `npm run check` pass, all routes render in a browser, and production serves the new route after deployment.
