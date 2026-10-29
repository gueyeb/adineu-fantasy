# Guide de lecture ADINEU pour un assistant IA

Source unique à donner au projet ChatGPT (remplace les PRD/backtests). Mis à jour : 29/10/2026.

## Ce que l'utilisateur colle

- **Contexte IA** (« Copier contexte IA », en-tête `ADINEU AI CONTEXT v2 — DECISION`) : la
  source de vérité, datée. Roster, FAAB, statuts, disponibilités viennent de lui seul.
- **Bulletin Coach** (Telegram, mardi ~10:30) et **bilan des waivers** (jeudi ~09:00).
- **Offre de trade** (onglet Calculator ou `/api/trade-offer`).

Si le contexte manque ou date de plus de 24 h, le demander avant tout ADD/DROP/enchère.

## Sections du contexte

| Section | Contenu |
|---|---|
| LEAGUE | règles : 12 équipes, Full PPR, 1QB 2RB 2WR 1TE 1FLEX 1K 1DEF, 6 banc, 1 IR, FAAB 1000 $, deadline S12 |
| TEAM — BOUKKI (Babacar, @t0z) | bilan, rang, FAAB restant, priorité waiver |
| STRATEGY STATE | urgence playoffs (LOW/MODERATE/HIGH ; 8 qualifiés) |
| TEAM DIAGNOSIS | forces/faiblesses, pression de roster, 3 coupes candidates décomposées |
| ROSTER — PROJECTIONS & USAGE | par joueur : projection Sleeper de la semaine, ROS, usage, statut |
| LINEUP | lineup actuelle vs optimale, gain |
| WAIVER — RECOMMENDED ACTIONS | ADD NOW / CLAIM IF CHEAP / WATCH / IGNORE / UNDETERMINED |
| NEXT MATCHUP | adversaire, projections des deux côtés |
| MODEL NOTES | couverture des données, mode dégradé |

## Champs d'une ligne waiver

- `Class` : BREAKOUT, STREAMER, etc. — nature de l'opportunité, pas une action.
- `Immediate` / `Strategic` / `Market` : 0–100, valeur cette semaine / potentiel / intérêt de
  la ligue. Le marché n'est pas la valeur pour Boukki.
- `GrossGain` : gain de lineup optimale par semaine. `DropCost` : ce que coûte la coupe
  proposée. `NetGain` = les deux combinés, sur l'horizon du rôle. **C'est le chiffre de décision.**
- `Availability` / `Mode` : FREE_ADD (immédiat, sans FAAB) ou WAIVER_CLAIM (enchère, attribuée
  au prochain passage). `INFERRED … confirm in Sleeper` = déduit des règles, à vérifier.
- Trois montants FAAB distincts : `FAAB market estimate` (fourchette du marché),
  `SuggestedBid` (proposition), `PersonalMax` (plafond pour Boukki). `NOT_DETERMINED` ≠ 0 $.
- `AuctionWinProbability` : estimation non calibrée, ne bat pas encore un taux constant.
- `Coverage` : données manquantes. `ProgressionGuard` : coupe d'un joueur en progression
  organique pour une location — le modèle pénalise.

## Règles du modèle à respecter

- `UNDETERMINED` n'est pas négatif : comparaison incomplète (horizon ou transaction non
  couverts). Seul `IGNORE` est un non.
- Un joueur Out/IR/Doubtful compte 0 cette semaine, même si Sleeper affiche une projection.
- ROS (reste de saison) = projections Sleeper sur 2 semaines, puis mélange avec l'usage
  (20 % RB/WR/TE, 50 % QB), validé par backtest 2021–2025.
- Usage : snaps, targets, carries, red zone, air yards, xFP. **Pas de routes, TPRR ni first-read**
  dans nos données : ces chiffres doivent venir de sources externes datées.
- Signaux BUY_LOW / SELL_HIGH et seuils de rôle émergent : non calibrés, déclencheurs de revue.
- Trades : deux lectures (moyenne de saison depuis la première semaine affectable, et
  simulation semaine par semaine) partagent le même modèle ; les accords et le retour de
  blessure sont des hypothèses déclarées. La valeur marché (1–100) ≠ impact sur la lineup.
- Probabilité de victoire et probas playoffs : estimations Adineu, jamais officielles.
- Défenses : le score Adineu est indicatif ; la projection Sleeper reste la référence.

## Ce que le modèle ne voit pas (rôle de l'assistant)

Nouvelles postérieures à la dernière mise à jour Sleeper : blessures à l'entraînement,
changements de depth chart, trades NFL, déclarations de coachs, routes/TPRR. L'assistant les
apporte, sourcées et datées, et dit explicitement quand un fait change un verdict du contexte.
Il ne prétend jamais avoir vu Sleeper.
