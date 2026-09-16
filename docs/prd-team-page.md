# PRD léger — Page équipe (`/teams/`)

Statut : **brouillon pour revue** (pas encore dans `docs/product-roadmap.md`, qui liste les items déjà approuvés).
Auteur : Claude (Cowork), sur demande de Babacar — ancré dans le code réel du repo au 2026-09-16.

## Pourquoi

Aujourd'hui aucune page ne répond à « comment va mon équipe ». Standings donne un rang, Trade Hub donne un roster (mais uniquement dans le contexte trade), Matchups donne un score hebdo. La page équipe est la pièce qui relie ces trois univers sur une seule URL par manager — c'est le point d'entrée naturel avant de router vers Trade Finder, Waiver Wire ou Matchup Center.

## Objectif

Une page `/teams/` qui, pour un manager donné, affiche en un coup d'œil : qui il est, où il en est (record, rang), à quoi ressemble son roster live, et s'il y a une action à prendre cette semaine (alerte lineup). Rien d'inventé : toutes les données ont déjà une source dans le repo.

## Portée v1 vs hors-scope

**Dans le scope (v1, incréments 1–2 ci-dessous) :** identité + record + roster live + alertes lineup + force de roster + liens sortants.
**Hors-scope explicite pour l'instant :** all-play record, FAAB tracker, flux de transactions, "Record Watch" — nécessitent chacun une nouvelle agrégation de données (cf. Incrément 3, non scopé en détail ici).

## Décisions d'architecture (à valider)

**1. Routing : query param, pas de route dynamique par équipe.**
Le site n'a aucun routing dynamique côté serveur — `server.js` sert des fichiers statiques (`resolvePublicPath`), et chaque route est un dossier `public/<route>/index.html` avec `data-page="X"`. `/franchises/` gère déjà exactement ce problème (12+ managers, une seule route) via `?manager=` + `window.history.replaceState`. Je propose de suivre le même pattern : `public/teams/index.html` (`data-page="teams"`) + `?team=t0z` (accepte owner name, team name ou `roster_id`, comme `findRosterByTeam` dans `scripts/league-context.js`).
*Alternative écartée pour l'instant* : générer 12 dossiers statiques (`/teams/binaries/`) façon franchise dossier — plus jolie en URL, mais duplique la logique de génération pour un gain marginal tant que personne ne demande de partager une URL d'équipe précise. Décision réversible, à revisiter si le besoin apparaît.

**2. Logique roster Sleeper : factorisée dès l'Incrément 1, pas différée.**
`scripts/league-context.js` (`getLeagueContext`, Node) et `public/assets/trade-ui.js` (`formattedRosters`, navigateur) font déjà la même chose : `/league/{id}/rosters` + `/league/{id}/users` + `players-catalog.json` → `{ownerName, teamName, starters, bench, ir}` groupés par slot. Le seuil de duplication est déjà atteint avant même la page équipe — pas la peine d'attendre une 3e occurrence pour agir, elle est déjà là.

Le repo a déjà le pattern qui rend ça facile : `league-context.js` importe `public/assets/league-settings.js`, un module "isomorphe" (pur, sans I/O) partagé entre scripts Node et navigateur. J'extrais la partie pure — pas le fetch réseau, juste le mapping — dans `public/assets/roster-view.js` (`buildRosterView({ rosters, users, playerCatalog })`, testée dans `test/roster-view.test.js`). `league-context.js` et `trade-ui.js` migrent vers cette fonction en Incrément 1 (refactor mécanique, comportement inchangé, couvert par leurs tests existants), et la page équipe l'utilise dès le départ — pas de 3e copie. `matchups-live.js` n'a besoin que d'un sous-ensemble (identité équipe, pas le groupement par slot) ; je ne le force pas à migrer maintenant, mais rien ne l'en empêche plus tard.

**3. Nouveau module autonome, pas une fonction de plus dans `site.js`.**
`site.js` fait déjà 79 Ko. `trade-ui.js` et `matchups-live.js` montrent le pattern à suivre pour une page « vivante » : un module dédié qui exporte une fonction `renderTeamsHub(container, options)`, appelé depuis `start()` dans `site.js` (à côté de `renderTradesPage` / `renderMatchupsHub`), avec ses propres fonctions pures exportées et testées (`test/teams.test.js`, 1 fichier miroir comme le reste du repo).

## Sources de données (déjà existantes — zéro nouveau backend pour la v1)

| Bloc UI | Source | Détail |
|---|---|---|
| Sélecteur + identité (owner, team name) | Sleeper `/league/{id}/rosters` + `/users` | même mapping que `findRosterByTeam` (`scripts/league-context.js:59`) et `formattedRosters` (`trade-ui.js:136`) |
| Record + rang live | Supabase `v_standings` | requête identique à `loadLiveStandings()` (`site.js:274`), filtrée sur `owner_name` |
| Roster live (titulaires/banc/IR) | Sleeper rosters + `public/data/players-catalog.json` | logique de `getLeagueContext` (`scripts/league-context.js:81`), déjà généralisée à n'importe quelle équipe (pas juste "myTeam") |
| Alertes lineup (slot vide, blessure, bye) | `GET /api/lineup-advisor?team=X` | **existe déjà**, accepte n'importe quel `team`, aucun changement serveur requis |
| Power Rank (si débloqué) | `calculatePowerRankings()` (`public/assets/power-rankings.js`) | même gate que `/power-rankings/` — n'afficher que si `ready: true`, jamais une valeur pré-saison |
| Force de roster par poste | `calculatePlayerTradeProfile().tradeValue` (`public/assets/trade-value.js`) | agrégation nouvelle mais sur des valeurs déjà calculées ailleurs (Trade Hub) |

Aucune de ces sources ne nécessite une clé privée côté navigateur : `v_standings` et les tables `owners`/`teams` ont déjà une policy `public read`, et Sleeper est en lecture publique.

## Incréments (chacun livrable et testable seul)

**Incrément 1 — Dossier équipe live (P0)**
- Scaffold route : `public/teams/index.html`, entrée `routes` dans `site.js` (nav + dispatch), entrée dans `scripts/verify-static.js` (sinon `npm run check` casse).
- Extraction `public/assets/roster-view.js` (`buildRosterView`) + `test/roster-view.test.js`, migration de `scripts/league-context.js` et `trade-ui.js` vers cette fonction (comportement inchangé, tests existants doivent continuer à passer).
- Sélecteur d'équipe (12 managers) avec deep-link `?team=`.
- Bloc identité : nom d'équipe, manager, record + rang live (`v_standings`).
- Roster live : titulaires par slot (QB/RB/RB/WR/WR/TE/FLEX/K/DEF), banc, IR — réutilise le rendu visuel déjà existant du Trade Hub (mêmes classes CSS, pas de nouveau design system à inventer).
- Alertes lineup embarquées via `/api/lineup-advisor?team=X` (slot vide / blessure / bye).
- Tests : au moins une fonction pure testée pour la résolution du `?team=` par défaut et le groupement des slots, sur le modèle de `test/lineup-advisor.test.js`.
- *Definition of done* : `npm test` et `npm run check` passent, page fonctionnelle pour les 12 managers, dégradation propre si Sleeper est indisponible (même pattern try/catch que `renderStandings`).

**Incrément 2 — Différenciation (P1)**
- Force de roster par poste (`calculateRosterStrength(roster)` — nouvelle fonction pure, testée) : agrège `tradeValue` par poste, normalise vs médiane de la ligue (nécessite les 12 rosters, déjà chargés en Incrément 1 pour le sélecteur).
- Étiquette need/surplus par poste, dérivée du même calcul — toujours labellisée "estimation Adineu", jamais présentée comme une note officielle (même discipline que Power Rankings / probabilités de matchup).
- Badge Power Rank quand le gate est débloqué (rank + composantes, comme sur `/power-rankings/`).
- Liens sortants contextuels : "Chercher des trades pour cette équipe" → `/trades/?team=X`, "Voir le prochain matchup" → `/matchups/`.

**Incrément 3 — Nice-to-have (P2, non détaillé ici)**
All-play record, FAAB restant (probablement direct dans `roster.settings` Sleeper — à vérifier), flux de transactions récentes, proximité avec un record Hall of Fame. Chacun mérite son propre mini-PRD quand on y arrive — pas de scope à l'avance sur des sources de données non confirmées.

## Risques & mitigations

- **Routing par query param, moins "partageable" qu'une URL par équipe.** → Acceptable en v1 (précédent `/franchises/`), révisable si demande réelle. Réversible.
- **Duplication Sleeper (3e implémentation du même fetch).** → Assumée sciemment, factorisation seulement à la règle de trois si l'Incrément 2 la rend douloureuse.
- **`/api/lineup-advisor` n'a pas de contrôle d'appartenance** : n'importe qui peut déjà lire l'alerte lineup de n'importe quelle équipe via l'API. L'exposer sur une page publique rend ce fait visible plutôt que de le créer — cohérent avec la philosophie "site en lecture seule publique" déjà appliquée partout ailleurs, mais à confirmer explicitement avant de merger (pas une régression silencieuse).
- **Force de roster / needs-surplus perçus comme un jugement de valeur.** → Même garde-fou que le reste du site (AGENTS.md) : toujours labellisé estimation, jamais un chiffre officiel, jamais un boost caché dans une autre métrique.

## Ce qui ne change pas

Aucun changement de schéma Supabase, aucune nouvelle dépendance npm, aucun nouvel endpoint serveur pour l'Incrément 1. Le seul risque de régression est `npm run check` si la route n'est pas ajoutée à `scripts/verify-static.js` en même temps que `site.js`.
