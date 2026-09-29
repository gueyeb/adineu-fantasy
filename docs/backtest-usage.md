# Backtest 2024–2025 — usage, projections et signaux

29/09/2026 · `npm run backtest` (`scripts/backtest-usage.js`) · données en cache dans `.cache/backtest/`.

## Méthode
- Pour chaque saison 2024 et 2025 et chaque semaine de décision N = 4 → 13, on rejoue le modèle
  **avec uniquement ce qui était connu à ce moment-là** : stats des 3 semaines précédentes, et les
  mêmes fonctions que le site en direct (`buildPlayerWeeks`, `calculateUsageScores`).
- Données : stats et projections hebdo Sleeper (même format qu'en direct) ; équipe NFL de chaque
  joueur semaine par semaine via nflverse (`stats_player_week_{saison}.csv`, lien par `gsis_id`).
- Cibles :
  - **far** = moyenne PPR des semaines N+2 à N+5 (matchs joués, au moins 2), l'horizon où le site
    mélange projection et usage ;
  - **next** = points de la semaine N.
- 1 215 décisions RB/WR/TE (886 avec une cible far).

## Résultats — cible « far »
| Prédicteur | Erreur moyenne (pts) | Corrélation |
|---|---|---|
| Points passés (moyenne récente) | 3,78 | 0,67 |
| Usage (xFP) | 3,68 | 0,67 |
| Projection Sleeper | 3,14 | 0,75 |
| 50/50 projection + xFP (ancien réglage) | 3,22 | 0,73 |
| **80/20 projection + xFP (nouveau réglage)** | **3,12** | — |

Poids optimal de l'usage (axe projection ↔ xFP) :

| | Tous | RB | WR | TE |
|---|---|---|---|---|
| Cible far | 0,2 | 0,1 | 0,1 | 0,3 |
| Cible next | 0,2 | 0,1 | 0,2 | 0,2 |

Stable d'une saison à l'autre : l'erreur far vaut 3,32 → 3,30 en 2024 et 2,90 → 2,86 en 2025
(projection seule → 80/20). À 50/50, elle remonte à 3,44 et 2,92.

**Décision** : `FAR_WEEK_USAGE_WEIGHT` passe de 0,5 à **0,2** (`public/assets/rest-of-season.js`).

**Limite** : le test utilise la projection Sleeper *fraîche* de la semaine N comme niveau du joueur.
En direct, les semaines lointaines ont des projections vieillies, moins bonnes. Le vrai optimum
pour ces semaines est donc probablement un peu au-dessus de 0,2 (0,2–0,3), mais pas 0,5. Pour le
mesurer, il faudra archiver chaque semaine les projections futures de Sleeper (à mettre en place).

## Signaux buy-low / sell-high (cible far vs points passés)
| Signal | n | Évolution moyenne | Part qui fait mieux qu'avant |
|---|---|---|---|
| Tous les joueurs | 1 029 | −0,27 pt | 47,5 % |
| **SELL_HIGH** | 50 | **−5,97 pts** | **16 %** |
| BUY_LOW | 59 | +0,66 pt | 59 % |

- Sell-high : fortement validé, la production revient vers le volume.
- Buy-low : effet positif mais modeste. Ça reste un signal d'appoint, pas une certitude.

## Prochaines améliorations possibles
- Archiver chaque mardi les projections futures de Sleeper, pour tester vraiment les semaines lointaines.
- Tester des poids de composite (Usage Score) et des seuils de signaux différents par poste.
- Étendre aux QB (volume = dropbacks), qui ne sont pas couverts par l'usage aujourd'hui.
