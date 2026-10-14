# Backtest — challenger de l'usage : expected points ffopportunity (2021–2025)

14/10/2026 · `npm run backtest:ffopportunity` (`scripts/backtest-ffopportunity.js`) · données en cache
dans `.cache/backtest/` · PRD : `docs/prd-model-challenge.md` (chantier 4).

## Protocole

Mêmes décisions que `npm run backtest` (semaines 4→13, 2021–2025, données connues à la date) :
6 072 décisions, 5 740 avec une ligne ffopportunity (jointure par `gsis_id`). Le challenger est la
moyenne de `total_fantasy_points_exp` (ffverse/ffopportunity, modèle play-by-play) sur les trois
mêmes semaines passées que notre xFP. Cibles : moyenne PPR des semaines N+2→N+5 (« far », l'horizon
où le modèle live mélange usage et Sleeper) et semaine N (« next »). Les poids des mélanges sont
choisis **une saison écartée** : aucune saison ne note son propre poids.

## Résultats (erreur absolue moyenne, pts)

| Cible far (n = 4 048) | MAE |
|---|---|
| Points passés | 4,28 |
| Notre xFP (usage) | 4,00 |
| xFP ffopportunity | 3,79 |
| Projection Sleeper | 3,58 |
| Sleeper + notre xFP, poids écarté | 3,53 |
| **Sleeper 80/20 notre xFP (live)** | **3,51** |
| Sleeper + ffopportunity, poids écarté (0,3–0,4) | 3,51 |

Semaine suivante (n = 4 513) : Sleeper 5,02 · notre xFP 5,41 · ffopportunity 5,24 · live 4,99 ·
Sleeper + ffopportunity 4,98.

Par poste (far, live contre Sleeper + ffopportunity) : QB 4,56 / 4,57 · RB 3,65 / 3,61 ·
WR 3,47 / 3,46 · TE 2,84 / 2,88.

## Conclusion

- **Seul, ffopportunity est un meilleur signal d'usage que notre xFP** (3,79 contre 4,00 ; meilleur
  à chaque poste et 4 saisons sur 5, égal en 2021). Le play-by-play voit la qualité des opportunités (profondeur,
  zone rouge) que nos parts Sleeper résument mal.
- **Mélangé à Sleeper, il n'apporte rien de mesurable** : 3,51 contre 3,51, ± 0,04 selon le poste,
  dans les deux sens. Sleeper intègre déjà l'essentiel ; ce qui reste est du bruit.
- Décision : **non adopté**. Le gain ne paie pas une dépendance de plus (fichier publié avec un jour
  de retard, jointure par `gsis_id`, joueurs sans identifiant perdus). Le poids QB à 0,5 et le 0,2
  RB/WR/TE sont reconfirmés.
- Piste ouverte : utiliser ffopportunity pour les signaux BUY_LOW / SELL_HIGH (écart points réels −
  attendus), qui reposent sur l'usage seul ; à tester avant tout branchement.
