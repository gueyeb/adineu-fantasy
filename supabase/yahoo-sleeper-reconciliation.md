# Yahoo–Sleeper Owner Reconciliation

This checklist deliberately separates evidence from approval. Do not merge `owners` until the league commissioner confirms each row; matching team names are strong clues, not identity proof.

## 2025 → 2026 Matches — confirmed by Babacar (2026-08-27)

All 12 Yahoo managers are now linked to a Sleeper owner. Together with the four Yahoo-only managers, the archive is fully reconciled at 88/88 team-season identities.

| Yahoo manager | Yahoo team | Sleeper owner / team | Evidence | Status |
| --- | --- | --- | --- | --- |
| babttz | Boukki 🦅 | `t0z` / Boukki | Same team name | Confirmed |
| Tamsir | Flemme | `flemme` / flemme | Same team name | Confirmed |
| Bombeul22 | The Bad Man | `bm2222` / The Bad Man | Same team name | Confirmed |
| Ado | Estocade | `ESTOCADE` / Estocade | Same team name | Confirmed |
| Olivier | The energy's team | `Dioguito17` / The Energy's Team | Same team name | Confirmed |
| Abdoulaye | Binaries | `layemasterz` / Binaries | Same team name | Confirmed |
| Toughness | Saitaamaaa | `Saitaamaa22` / Saitaamaa | Same team name | Confirmed |
| Magatte | Don't choke | `SneakySlayerMG` / SneakySlayerMG | Matches an older Yahoo franchise name | Confirmed |
| Louis François | Roc boyz | `LFMendes` / Gridiron gang | Display-name initials only | Confirmed |
| Marius | The JeantyMan | `BigRuisma` | Confirmed by Babacar directly (no name overlap) | Confirmed |
| Mat | Hunters | `MouhammadAT` / Kuro | Confirmed by Babacar directly (no name overlap) | Confirmed |
| YeezyJr | Charger Charger | `mouzay` | Confirmed by Babacar directly (no name overlap) | Confirmed |

Sleeper's 12 owned rosters now all have a confirmed Yahoo manager on the other end. Nothing left unmatched at the owner level for the current core.

## Confirmed Yahoo Participation Changes

- The same 12 Yahoo profile identities participated from 2022 through 2025, even when their team names changed.
- Erwan and Mountaga participated in 2020–2021 and were absent from 2022 onward.
- Jonnel is confirmed in both 2019 and 2020.
- All 88 Yahoo team-season identities are confirmed across 16 historical managers.

## Import Rule

Once approved, attach the Yahoo platform ID to the existing canonical `owner_id` in `owner_platform_ids`, then upsert the season-specific `teams`. Never create cross-platform links from team-name similarity alone.

**Status: applied to Supabase (2026-08-27).** All 12 confirmed pairs above are written to `owner_platform_ids` as `(owner_id, platform='yahoo', platform_user_id=<Yahoo manager display name>)`. No true Yahoo GUID was captured for these 12 profiles because the archive came from page extraction rather than the API; Birama's later profile link is the exception. Backfill the other GUIDs only if Yahoo exposes verified identifiers again.

Erwan, Mountaga and Jonnel are also written in as canonical Yahoo-only `owners` rows, each with a single `yahoo` platform link and no Sleeper link. Jonnel played in 2019 and 2020. Birama is the fourth Yahoo-only owner and is linked with his verified Yahoo GUID.

## The final 16/88 — resolved 2026-08-27

Babacar confirmed 14 team-seasons directly from memory, then confirmed Birama's two seasons from Yahoo team pages and his linked profile. These updates moved `identityCoverage.confirmedParticipations` from 72 to 88:

| Team-season | Manager | Existing owner |
| --- | --- | --- |
| Elephant de Gbamph (2019, 2020) | Marius | `BigRuisma` |
| The energy's team (2019, 2020) | Olivier | `Dioguito17` |
| Binaries (2019, 2020) | Abdoulaye | `layemasterz` |
| Sneaky slayer's (2019, 2020) | Magatte | `SneakySlayerMG` |
| Toughness's Team (2019) | Toughness | `Saitaamaa22` |
| Hunters (2019) | Mat | `MouhammadAT` |
| Banana Kings (2019) | Mountaga | (Yahoo-only owner) |
| YeezyJr's Team (2019) | YeezyJr | `mouzay` |
| Ruff Ryders (2019) | Louis François | `LFMendes` |
| Power Bearers (2019) | Jonnel | (Yahoo-only owner) — Jonnel actually played 2019 *and* 2020, not just 2020 as first thought |

**Resolved 2026-08-27 — 88/88.** Babacar confirmed both via Yahoo's own team pages (`/2020/f1/67190/1` = "Ethan Hunt", `/2019/f1/103079/1` = "El Fenomeno") and a linked Yahoo profile: both are **Birama**. Also confirmed: Jonnel played both the 2019 and 2020 seasons (not just 2020 as first thought) — already reflected above.

Applied:
- `managerHistory` in `yahoo-history.json` gained a `Birama` entry (`2020: "Ethan Hunt"`, `2019: "El Fenomeno"`); `identityCoverage.confirmedParticipations` is now 88/88.
- A new `owners` row for Birama, linked via `owner_platform_ids` (`platform='yahoo'`, `platform_user_id='EJDLPDHIUHU3DRTZ35VD2RQORU'` — his actual Yahoo profile GUID, not a display-name placeholder like the other 15 links, since Babacar's link happened to surface it).

Nice detail: YeezyJr's 2021 team was literally named "Sauvons le soldat Birama" — the group already knew him well enough to make it a running joke.

The archive is now fully identity-complete. Next real question is whether to backfill true Yahoo GUIDs for the other 15 `owner_platform_ids` rows (currently keyed on display name) — not urgent, nothing depends on it today.
