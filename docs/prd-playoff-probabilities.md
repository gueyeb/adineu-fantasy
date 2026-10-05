# Mini-PRD — Playoff Probabilities (Power Rankings page)

Statut : **livré en production** (`2e767fb`, 29 septembre 2026).
Contexte : item approuvé dans `docs/product-roadmap.md`, vérifié contre l'API Sleeper puis implémenté sur `/power-rankings/`.

## Pourquoi

`/power-rankings/` et Playoff Race donnent l'état actuel (qui gagne, qui est dans les 8). Ils ne répondent pas à « quelles sont mes chances de finir dans les 8 » — la question que tout le monde se pose à partir de la mi-saison. Playoff Race reste volontairement arithmétique (`playoff-race.js` : *« Pas de simulation ni de pourcentage inventé »*) ; ce PRD ajoute un **second bloc, clairement distinct**, qui simule le reste du calendrier plutôt que de ne lire que le passé.

## Objectif

Sur `/power-rankings/`, une estimation Adineu (jamais présentée comme une donnée Sleeper officielle) de la probabilité, pour chaque équipe, de finir dans les 8 places de playoffs — calculée en simulant les semaines restantes de la saison régulière à partir du calendrier réel et des projections de joueurs disponibles.

## Portée

**Dans le scope :** simulation Monte Carlo du calendrier restant (jusqu'à S14), gate identique à Power Rankings, labels de couverture explicites quand une projection manque, seed reproductible.
**Hors-scope explicite :** playoffs eux-mêmes (S15+, bracket à 8), scénarios « si je gagne cette semaine » interactifs (v2 possible), historique des probabilités semaine par semaine (pas de stockage, recalcul à chaque chargement).

## Décisions d'architecture

**1. Calendrier restant : déjà disponible en entier via Sleeper, pas besoin d'un « endpoint calendrier » séparé.**
Vérifié : `GET /league/{id}/matchups/{week}` renvoie déjà les 12 rosters appariés par `matchup_id` pour **n'importe quelle semaine future**, y compris S14, avant même que les scores existent (confirmé aujourd'hui en semaine 2 — S3 à S14 renvoient déjà les paires roster_id/matchup_id, juste avec `points: 0`). Le calendrier complet S1–S14 est donc un fetch par semaine (14 max, moins les semaines déjà jouées), en parallèle.

**2. Projections : l'API Sleeper les a, y compris loin dans le futur, et gère déjà les byes.**
Vérifié : `GET /projections/nfl/2026/{week}?season_type=regular&position[]=QB&position[]=RB&...` (une requête par semaine, tous postes en un seul appel — testé, 3305 lignes) renvoie une ligne de stats projetées par joueur par semaine, jusqu'à S14 inclus. Vérifié sur Christian McCaffrey (SF) : projection présente et variable semaine par semaine (19.75 / 20.09 / 16.45 / **null en S8**, son bye confirmé / 21.87 / …) — la source distingue déjà "pas de match" de "projection basse", ce qui est exactement le signal dont on a besoin pour les labels de couverture.

**3. Score d'équipe projeté : reconverti aux règles de scoring Adineu, pas au PPR générique Sleeper.**
`public/assets/league-settings.js` expose `calculatePlayerFantasyPoints(stats)`, qui encode les règles officielles Adineu 2026. Les projections Sleeper fournissent les stats brutes (`pass_yd`, `rush_td`, `rec`, `fgm_20_29`, etc.) ; `playoff-probabilities.js` les adapte puis les rescrore avec cette fonction. Score d'équipe projeté = somme des joueurs actuellement titulaires, avec lineup figé à la date du modèle.

**4. Incertitude hebdomadaire et erreur persistante de force.**
Chaque score simulé combine la projection, le bruit hebdomadaire calibré sur les scores terminés et une erreur de force propre à l'équipe qui persiste pendant toute la saison simulée. Cette dernière est estimée à partir des résidus `score réel − projection pré-match` des lineups historiques, avec un plancher de 5 points tant que l'échantillon reste faible. Pour éviter que les projections lointaines de Sleeper donnent une fausse certitude, l'écart d'une équipe à la moyenne de la ligue est réduit de 50 % au-delà des deux prochaines semaines.

**5. Fallback si une projection manque.**
Priorité : (a) projection Sleeper de la semaine → (b) moyenne des scores réels déjà joués par ce joueur cette saison → (c) si aucune donnée du tout (rookie jamais projeté, joueur non rostered en début de saison), moyenne de remplacement au poste. Chaque équipe affiche un **% de couverture directe** (part des points projetés qui viennent de (a) plutôt que d'un fallback) — jamais un chiffre présenté avec une fausse précision si la couverture est faible.

**6. Tiebreak confirmé.**
Sleeper applique victoires puis points marqués sur la saison (`playoff_seed_type: 0`). Le moteur utilise donc **victoires → points marqués cumulés → nom du manager**, identique à `standingsOrder` dans `playoff-race.js`.

## Sources de données

| Bloc | Source | Détail |
|---|---|---|
| Calendrier restant | Sleeper `/league/{id}/matchups/{week}` × (14 − semaine courante) | Pairing par `matchup_id`, vérifié disponible à l'avance |
| Projections joueurs | Sleeper `/projections/nfl/{season}/{week}?position[]=...` × mêmes semaines | Un seul appel multi-postes par semaine (vérifié) |
| Scoring Adineu | `calculatePlayerFantasyPoints` (`league-settings.js`) | Adaptateur de champs implémenté et testé |
| Résultats déjà joués | Réutilise `loadSleeperMatchups()` / gate `calculatePowerRankings` | Même source que Power Rankings/All-Play, aucun nouveau fetch |
| Roster/lineup actuel | Sleeper `/league/{id}/rosters` (déjà chargé ailleurs sur le site) | Lineup figé à date, hypothèse explicite |

Aucune nouvelle clé, aucun nouvel endpoint serveur — tout en lecture publique Sleeper, comme le reste du site.

## Incréments livrés

**4a — Moteur de simulation (pur, testé)**
`public/assets/playoff-probabilities.js` : adaptateur stats Sleeper → `calculatePlayerFantasyPoints`, projection d'équipe par semaine, calibration d'incertitude, moteur Monte Carlo seedé, tiebreak, calcul de couverture. Tests dédiés sur des scénarios synthétiques (pas les vraies données Sleeper) : gate S1, couverture incomplète, semaine live/playoffs exclues, 12 équipes/8 places, probabilités ≈ somme à 8, résultats déterministes à seed fixe, qualification/élimination déjà confirmées mathématiquement (ex : une équipe avec 0 chance mathématique même en gagnant tout le reste).

**4b — Intégration Power Rankings page**
Fetch calendrier + projections + lineups, appel du moteur, affichage : probabilité par équipe, couverture directe, date du modèle, paramètres d'incertitude et mention explicite « estimation Adineu, pas une donnée officielle Sleeper ».

## Risques & mitigations

- **Volume de requêtes réseau** (jusqu'à ~12-14 fetchs calendrier + ~12-14 fetchs projections, en parallèle) : coût plus élevé que les autres pages du site. → Un seul calcul par chargement de `/power-rankings/` (pas par équipe comme `/teams/`), tout en parallèle ; à mesurer une fois codé, dégradable en fenêtre plus courte si le temps de chargement devient gênant.
- **Lineup figé au jour du calcul** peut sembler faux si un manager change son roster ensuite. → Toujours mentionné explicitement (« lineups figés à la date du modèle »), cohérent avec le principe déjà appliqué ailleurs de labelliser les hypothèses.
- **Simulation perçue comme une prédiction officielle.** → Toujours "estimation Adineu", jamais un chiffre Sleeper — même garde-fou que Power Rankings.
- **Performance du Monte Carlo côté navigateur** (N simulations × 12 équipes × semaines restantes) : fixée à 3 000 simulations seedées, validées dans le navigateur sans dépendance supplémentaire.

## Ce qui ne change pas

Playoff Race (`playoff-race.js`) reste inchangé et arithmétique — ce bloc s'ajoute à côté, jamais à la place. Aucun changement de schéma Supabase, aucune nouvelle dépendance npm, aucun nouvel endpoint serveur.

## Extension locale du 05/10 — Context et Coach

Le pont serveur réutilise le même moteur et une préparation de données désormais partagée avec
le navigateur. Probabilité, couverture, date, paramètres et hypothèses sont exportés ; lineup ou
calendrier incomplet bloque le calcul. Les projections historiques rechargées restent une limite,
car elles ne sont pas certifiées pré-match. Playoff Race reste indépendante et arithmétique.
Extension non déployée ; voir [le suivi](decision-reliability-2026-10-04.md).
