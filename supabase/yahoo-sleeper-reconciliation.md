# Yahoo–Sleeper Owner Reconciliation

This checklist deliberately separates evidence from approval. Do not merge `owners` until the league commissioner confirms each row; matching team names are strong clues, not identity proof.

## 2025 → 2026 Matches — confirmed by Babacar (2026-08-27)

All 12 Yahoo managers are now linked to a Sleeper owner. Together with the three Yahoo-only managers, the archive is fully reconciled at 88/88 team-season identities.

| Yahoo manager | Yahoo team | Sleeper owner / team | Evidence | Status |
| --- | --- | --- | --- | --- |
| babttz | Boukki 🦅 | `t0z` / Boukki | Same team name | Confirmed |
| Tamsir | Flemme | `flemme` / flemme | Same team name | Confirmed |
| Birama (`Bombeul22`) | The Bad Man | `bm2222` / The Bad Man | Commissioner confirmed the complete 2019–2026 identity chain | Confirmed 2026-08-30 |
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
- All 88 Yahoo team-season identities are confirmed across 15 historical managers.

## Import Rule

Once approved, attach the Yahoo platform ID to the existing canonical `owner_id` in `owner_platform_ids`, then upsert the season-specific `teams`. Never create cross-platform links from team-name similarity alone.

**Status: applied to Supabase (updated 2026-08-30).** All 12 confirmed pairs above are written to `owner_platform_ids`. Most Yahoo links still use the manager display name because the archive came from page extraction rather than the API; Birama's verified GUID is the exception. Backfill the other 14 GUIDs only if Yahoo exposes verified identifiers again.

Erwan, Mountaga and Jonnel are also written in as canonical Yahoo-only `owners` rows, each with a single `yahoo` platform link and no Sleeper link. Jonnel played in 2019 and 2020. Birama is not Yahoo-only: his verified Yahoo GUID and Sleeper account `bm2222` belong to the same owner.

## The final 16 participations — resolved 2026-08-27

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

**Identity correction 2026-08-30.** Babacar confirmed `bm2222 = Bombeul22 = El Fenomeno = Ethan Hunt`. The first reconciliation had incorrectly split Birama into a 2019–2020 Yahoo-only owner and a 2021–2026 current owner. No scores were missing; the 2021–2025 results were stored under `Bombeul22`.

Applied:
- `managerHistory` now has one `Birama` entry spanning all seven Yahoo seasons; `Bombeul22` remains an alias, not a separate manager.
- The verified Yahoo GUID moved onto the owner linked to Sleeper `bm2222`; the display-name placeholder and orphan Birama owner were removed.

Nice detail: YeezyJr's 2021 team was literally named "Sauvons le soldat Birama" — the group already knew him well enough to make it a running joke.

The archive is now fully identity-complete across 15 people. Backfilling true Yahoo GUIDs for the other 14 owners remains optional; nothing depends on it today.
