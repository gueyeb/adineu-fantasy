# PRD — Défenses : matchup et streaming

Statut : implémenté localement, 14/10/2026. Origine : retour d'usage sur le graphique « Week 6
Fantasy Defenses » (PPRRankings / Yahoo, données nflfastR) — le moteur s'appuie presque uniquement
sur la projection Sleeper pour les défenses.

## Problème

Une projection Sleeper de défense ne dit pas pourquoi : elle ne distingue pas une défense forte
d'une défense moyenne qui affronte une attaque en difficulté. Pour streamer une défense, il faut
voir la pression attendue, le score attendu de l'adversaire, sa propension aux turnovers, les
absences qui comptent et la semaine suivante.

## Solution et périmètre

Section « Défenses : matchups et streaming » dans l'onglet Start/Sit du Trade Hub
(`GET /api/defense-matchups?week=`), une ligne par défense de la semaine :

- **taux de sacks projeté** = 67 % du taux de sacks concédé par l'attaque adverse + 33 % du taux
  de sacks de la défense, sur les 8 derniers matchs de chaque équipe (saison précédente comprise) ;
- **points implicites de l'adversaire**, dérivés du spread et du total des cotes ;
- **taux d'interceptions et fumbles perdus** de l'attaque adverse ;
- **score attendu** au barème de la ligue : sacks projetés + interceptions + fumbles + score
  « points concédés » (loi normale, écart-type 10, autour du total implicite) + TD défensifs moyens ;
  affiché à côté de la projection Sleeper ;
- **lecture** par quadrant (pression × points implicites, médianes de la semaine) ;
- **horizon de streaming** : somme des scores attendus sur 2 semaines, bye compris ;
- **contexte blessures** : QB adverse absent ou QB annoncé différent du titulaire, pass rushers
  titulaires absents, OL adverses listés absents ;
- **fiabilité** : LOW sans cotes ou avec moins de 3 matchs, MEDIUM sous 6, sinon HIGH ;
- détenteur dans la ligue ou « Libre ».

Hors périmètre (pour l'instant) : remplacer la projection Sleeper dans le moteur de décision,
chiffrer les blessures, pondérer la qualité du QB remplaçant.

## Approche technique

- **Module pur** `public/assets/defense-matchup.js` (`teamRates`, `impliedPoints`,
  `expectedPointsAllowedScore`, `evaluateDefenseMatchup`, `quadrantFor`, `buildDefenseMatchups`),
  testé par `test/defense-matchup.test.js`.
- **Données gratuites** : nflverse `stats_team_week_{saison}.csv` (dropbacks = tentatives + sacks,
  sacks subis, interceptions, fumbles perdus, sacks défensifs, TD défensifs et spéciaux) et
  `games.csv` (`spread_line` = marge attendue de l'équipe à domicile, `total_line`, QB titulaires
  annoncés). `getTeamWeeks` met en cache 12 h ; `getSchedule` lit désormais les cotes et les QB.
- **Blessures** : index Sleeper (`depth_chart_position`, `depth_chart_order`, statut). Les OL n'ont
  pas d'ordre de profondeur chez Sleeper : leur titularité est inconnue et l'affichage le dit.

## Critères de succès

- Le classement d'une semaine retrouve l'ordre du graphique de référence (semaine 6 : KC, PIT, DEN,
  BAL en haut ; ARI @ LAR, WAS @ SF en bas).
- Une défense « libre » à fort score attendu sur 2 semaines est visible en un coup d'œil.
- Le score attendu est validé hors échantillon avant d'entrer dans le moteur de décision.
  **Backtest 2021–2025 (`docs/backtest-defense.md`) : non validé.** Seul, il classe moins bien que
  Sleeper ; un mélange à 25 % n'apporte qu'un gain marginal et irrégulier. Il reste affiché à titre
  d'explication, hors moteur.

## Cas limites et contraintes

- Pas de cotes publiées : pas de points implicites, pas de score attendu, fiabilité LOW.
- Début de saison : la fenêtre de 8 matchs reprend la saison précédente (changements d'effectif non
  corrigés).
- Bye la semaine suivante : l'horizon ne compte qu'un match et l'affiche.
- Coefficients (67/33, écart-type 10, TD moyens) repris ou fixés, non calibrés : à backtester sur
  2021–2025 avant tout usage dans le moteur.
