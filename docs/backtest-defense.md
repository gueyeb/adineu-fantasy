# Backtest — matchups défensifs (2021–2025)

Date : 14/10/2026. Script : `npm run backtest:defense` (`scripts/backtest-defense.js`, données en cache
dans `.cache/backtest`). Modèle testé : `public/assets/defense-matchup.js` (docs/prd-defense-matchups.md).

## Protocole

Chaque semaine 1 → 17 de 2021 à 2025 est rejouée avec ce qui était connu avant le coup d'envoi :
statistiques d'équipe des matchs précédents (8 derniers, saison précédente comprise) et cotes de la
semaine (nflverse). Pour chaque défense : score attendu Adineu, projection Sleeper d'avant-match
rescorée au barème de la ligue, mélanges des deux — comparés aux points réellement marqués au barème
de la ligue. 2558 défense-matchs, moyenne réelle 7,39 pts.

Le critère qui compte pour le streaming est le **classement de la semaine** : corrélation de
Spearman moyenne par semaine, et score réel moyen des 5 / 10 défenses que chaque prédicteur classe en tête.

## Résultats (toutes semaines)

| Prédicteur | MAE | Pearson | Spearman / semaine | Top 5 réel | Top 10 réel |
|---|---|---|---|---|---|
| Sleeper seul | 4,59 | 0,254 | 0,253 | 9,96 | 9,31 |
| 25 % Adineu | 4,55 | 0,267 | 0,259 | 10,13 | 9,35 |
| 50 % Adineu | 4,54 | 0,266 | 0,252 | 9,92 | 9,31 |
| 75 % Adineu | 4,55 | 0,253 | 0,236 | 9,79 | 9,15 |
| Adineu seul | 4,61 | 0,234 | 0,222 | 9,49 | 8,95 |

Par saison (Spearman / top 5 réel) :

| Saison | Sleeper | Adineu | 50/50 |
|---|---|---|---|
| 2021 | 0,251 / 10,2 | 0,224 / 9,32 | 0,251 / 10,15 |
| 2022 | 0,162 / 9,28 | 0,178 / 9,44 | 0,183 / 9,98 |
| 2023 | 0,225 / 10,32 | 0,192 / 9,4 | 0,225 / 10,09 |
| 2024 | 0,34 / 10,55 | 0,304 / 10,12 | 0,335 / 10,36 |
| 2025 | 0,286 / 9,47 | 0,209 / 9,2 | 0,268 / 9,02 |

## Conclusion

- **Seul, le modèle Adineu fait moins bien que Sleeper** (Spearman 0,222 contre 0,253 ; top 5 à
  9,49 pts contre 9,96). Sleeper intègre déjà l'essentiel de ce que disent sacks, cotes et turnovers.
- **Un mélange à 25 % est marginalement meilleur** (Spearman 0,259, top 5 à 10,13 pts) mais le gain
  (+0,006) n'est pas régulier d'une saison à l'autre : 2025 est moins bon. Ce n'est pas une preuve.
- Décision : le score attendu reste **affiché à côté** de la projection Sleeper, pour expliquer un
  matchup (pression, points implicites, QB remplaçant), **sans entrer dans le moteur de décision**.
  À retester en fin de saison 2026 avec un échantillon plus grand ou des variantes (pondération
  67/33, fenêtre, écart-type des points concédés).
- Prédire une défense reste difficile : même la meilleure corrélation tourne autour de 0,26.
- Limite : les projections Sleeper des saisons passées sont lues aujourd'hui ; elles sont supposées
  être les versions d'avant-match.
