# Yahoo–Sleeper Owner Reconciliation

This checklist deliberately separates evidence from approval. Do not merge `owners` until the league commissioner confirms each row; matching team names are strong clues, not identity proof.

## Proposed 2025 → 2026 Matches

| Yahoo manager | Yahoo team | Sleeper owner / team | Evidence | Status |
| --- | --- | --- | --- | --- |
| babttz | Boukki 🦅 | `t0z` / Boukki | Same team name | Needs confirmation |
| Tamsir | Flemme | `flemme` / flemme | Same team name | Needs confirmation |
| Bombeul22 | The Bad Man | `bm2222` / The Bad Man | Same team name | Needs confirmation |
| Ado | Estocade | `ESTOCADE` / Estocade | Same team name | Needs confirmation |
| Olivier | The energy's team | `Dioguito17` / The Energy's Team | Same team name | Needs confirmation |
| Abdoulaye | Binaries | `layemasterz` / Binaries | Same team name | Needs confirmation |
| Toughness | Saitaamaaa | `Saitaamaa22` / Saitaamaa | Same team name | Needs confirmation |
| Magatte | Don't choke | `SneakySlayerMG` / SneakySlayerMG | Matches an older Yahoo franchise name | Needs confirmation |
| Louis François | Roc boyz | `LFMendes` / Gridiron gang | Display-name initials only | Needs confirmation |
| Marius | The JeantyMan | No confirmed match | — | Unresolved |
| Mat | Hunters | No confirmed match | — | Unresolved |
| YeezyJr | Charger Charger | No confirmed match | — | Unresolved |

Sleeper currently contains 11 owned rosters. `BigRuisma` and `mouzay` have no confirmed Yahoo match, and the 2025 Yahoo league contained 12 managers. Resolve league membership before importing cross-platform owner links.

## Confirmed Yahoo Participation Changes

- The same 12 Yahoo profile identities participated from 2022 through 2025, even when their team names changed.
- Erwan and Mountaga participated in 2020–2021 and were absent from 2022 onward.
- Jonnel is confirmed in 2020; older participation remains under review.
- 72 of 88 Yahoo team-season identities are confirmed. The remaining 16 are limited to older archive records and stay explicitly unresolved.

## Import Rule

Once approved, attach the Yahoo platform ID to the existing canonical `owner_id` in `owner_platform_ids`, then upsert the season-specific `teams`. Never create cross-platform links from team-name similarity alone.
