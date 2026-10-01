# Backtest 2021–2025 — usage, projections et signaux

29/09/2026 · `npm run backtest` (`scripts/backtest-usage.js`) · données en cache dans `.cache/backtest/`.

## Synthèse 5 saisons (2021–2025, 5 139 décisions)
| Prédicteur (cible far, n = 3 652) | Erreur moyenne |
|---|---|
| Points passés | 4,06 |
| Usage (xFP) | 3,80 |
| Projection Sleeper | 3,29 |
| **80/20 projection + xFP (réglage actuel)** | **3,27** |
| 50/50 (ancien réglage) | 3,36 |

Semaine suivante (next, n = 4 046) : points passés 5,23 · xFP 5,10 · Sleeper 4,63 · 80/20 4,64 · 50/50 4,74.

Poids optimal de l'usage par saison (cible far) : 2021 : 0,4 · 2022 : 0 · 2023 : 0,1 · 2024 : 0,2 ·
2025 : 0,2. Médiane : 0,2. Par poste sur 5 saisons : RB, WR et TE ont tous 0,2. **Le réglage à 0,2
est confirmé.**

| Signal (5 saisons) | n | Évolution vs passé | Part qui progresse |
|---|---|---|---|
| Tous | 4 405 | −0,47 | 45 % |
| **SELL_HIGH** | 191 | **−6,33** | **13 %** (6–18 % selon la saison) |
| **BUY_LOW** | 290 | **+1,05** | **57 %** (52–65 % selon la saison) |

Les deux signaux vont dans le bon sens **chaque saison**. Le sell-high est très fiable ; le buy-low
est un avantage réel mais modeste (+1,5 pt de mieux que la moyenne).

**Couverture** : le nombre de décisions baisse de 2021 (1 135) à 2025 (367). Un joueur n'est
retenu que s'il a un `gsis_id` dans le dump Sleeper actuel (pour retrouver son équipe) et une
projection cette semaine-là. Les résultats par saison vont tous dans le même sens.

## QB (ajouté le 01/10/2026)
Validation « une saison écartée » sur 583 décisions : Sleeper seul 4,89, xFP QB seul 4,71, **mélange
50/50 4,37**. Poids QB = 0,5 (`FAR_WEEK_USAGE_WEIGHT_BY_POSITION`). Détails :
`docs/prd-boom-bust-qb-usage.md`.

## Détail 2024–2025 (première passe)

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
