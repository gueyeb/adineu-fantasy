# Calendriers par équipe et rivalités — 22 novembre 2026

Route : `/matchups/#teams`, onglet « Équipes & SOS ». Données publiques Sleeper,
lecture seule ; aucune migration, nouvelle variable d’environnement ou dépendance.

Une équipe : bilan V/D/N, adversaires et scores semaine par semaine. Deux équipes :
tableau côte à côte avec une ligne par semaine, et duel virtuel utilisant leurs
propres scores de la même semaine indépendamment des adversaires réels. Camembert
A/B/égalités, nombres et légende accessibles. Export texte WhatsApp avec titres,
emojis, synthèse et détail du duel ; copie manuelle de secours si presse-papiers refusé.

Les bilans utilisent uniquement des semaines régulières terminées avec une ligne
par roster connu, des paires de deux et des scores numériques. Une semaine entièrement
à zéro est non confirmée, jamais assimilée à six égalités. Une semaine incomplète
est exclue pour toute la ligue. Aucun résultat live/futur ou playoff dans les bilans.

- SOS brut : moyenne des points réellement encaissés sur ces semaines.
- ROS brut : moyenne des PPG actuels des futurs adversaires, une occurrence par
  rencontre restante, semaine en cours incluse. Toute affiche/moyenne manquante
  empêche le ROS global ; couverture indiquée.
- Référence hors soi : moyenne des PPG des autres équipes, équipondérées.
- SOS/ROS ajusté : brut moins cette référence ; positif = plus dur, négatif = plus
  doux que le groupe d’adversaires possibles. Rang 1 = écart le plus élevé ; ex aequo
  préservés. Cette référence uniforme n’impose pas un modèle des contraintes Sleeper.

Aucun ajustement du duel virtuel ou des résultats officiels. Le ROS est une estimation
descriptive : blessures, byes NFL, changements d’effectif et incertitude non modélisés.

## Vérification avant livraison

Syntaxe Node des trois modules, `npm run check`, versions d’assets et `git diff --check`
valides. Sept tests dédiés : scores/égalité, couverture, répétitions, duel virtuel,
exclusion live/playoffs/incomplets, neutralité d’un round-robin et référence hors soi
indépendante de ses propres scores. Contrôle navigateur à 390 px : aucune largeur
supérieure au viewport ; tableau défilant, camembert, sélecteurs et copie fonctionnels.

Suite complète : 759 tests, 757 réussis et deux échecs préexistants dans
`player-intelligence.test.js:47` et `player-intelligence-service.test.js:39`.
Les deux ont été reproduits sur une extraction du HEAD antérieur `c4595e2`, sans
les changements calendriers. Ils concernent la déduplication du stockage privé
joueurs et sont hors de cette livraison. Pas de compilation, typecheck ou linter configuré.

Suivi séparé : ADIN-19 pour la lisibilité visuelle générale du site et du Coach.
