# Adineu Fantasy — PRD global

Version : 1ᵉʳ octobre 2026 (semaine 4 NFL). Document de référence du produit : à joindre à
tout assistant (ChatGPT, Claude…) qui doit répondre à des questions sur l'outil ou proposer des
améliorations. Les PRD détaillés par fonctionnalité sont listés en fin de document.

---

## 1. Vision

**Adineu Fantasy** est le site compagnon de la ligue NFL fantasy « Adineu » (12 managers, amis,
francophones). Il répond à trois besoins :

1. **Mémoire** : l'histoire vérifiée de la ligue (Yahoo 2019–2025), ses champions, records et rivalités.
2. **Saison en direct** : classements, matchups, force réelle des équipes, course aux playoffs (Sleeper 2026).
3. **Aide à la décision** : trades, waivers, start/sit, avec des estimations transparentes.

À terme, l'outil pourrait être ouvert au grand public (toute ligue Sleeper). Ce n'est **pas**
la priorité actuelle ; les sources commerciales (FantasyPros, etc.) sont reportées.

Ajout du 07/10 : une **vue publique pour les visiteurs hors ligue** est au backlog. Elle résume cette ligue (résultats, classement, awards et explications), sans accès au Coach privé. Elle ne suppose pas une ouverture multi-ligues. Nice-to-haves : weekly awards et notes de draft après saison. [Contrat](prd-public-weekly-awards.md).

Production : https://adineu-fantasy.bakene.tech/

## 2. Principes non négociables

Toute suggestion d'amélioration doit les respecter :

- **Ne jamais inventer.** Pas de chiffre présenté comme réel sans source. Quand une donnée
  manque, la fonctionnalité se masque ou l'affiche explicitement, plutôt que d'afficher un placeholder plausible.
- **Estimations étiquetées.** Toute probabilité ou projection est marquée « estimation Adineu »,
  jamais présentée comme officielle Sleeper/NFL. Pas de « % de chance de gagner une enchère FAAB ».
- **Gates d'activation.** Power Rankings, All-Play et Playoff Probabilities restent verrouillés
  tant que les 12 équipes n'ont pas 2 semaines complètes. La semaine en cours et les playoffs sont exclus.
- **Identité vérifiée.** Un manager = une identité canonique à travers les plateformes (Yahoo,
  Sleeper). Jamais de rapprochement deviné ; jamais de jointure de joueurs par nom seul.
- **Archive gelée.** L'archive Yahoo n'est remplacée que si chaque saison se réconcilie
  exactement (V/D/N, points pour/contre, podiums).
- **Lecture seule.** Le site ne modifie rien sur Sleeper (l'API est de toute façon read-only).
- **Sécurité.** Aucun secret côté navigateur ; seule la clé publique Supabase (protégée par RLS).

## 3. La ligue (règles 2026)

- Sleeper, league `1392715510830878721`, 12 équipes, **Full PPR**.
- Lineup : 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (RB/WR/TE), 1 K, 1 DEF ; 6 banc ; 1 IR (15 + IR).
- Scoring : réception 1, yards course/réception 0,1, TD course/réception 6, yards passe 0,04,
  TD passe 4, interception −2, fumble perdu −2 ; pas de bonus TE, pas de malus sack.
- Saison régulière semaines 1–14, **8 équipes sur 12 en playoffs** à partir de la semaine 15.
- Waivers : FAAB 1 000 $, déblocage mercredi 09:00 (Paris). Trade deadline semaine 12,
  revue 1 jour, 6 votes de veto.
- Byes officiels 2026 : semaines 5–14 (aucun en semaine 12, Thanksgiving).
- Source de vérité dans le code : `public/assets/league-settings.js`.

## 4. Utilisateurs

- **Les 12 managers** : consultent classements, matchups, leur équipe ; cherchent trades et waivers.
- **Le commissaire / propriétaire du site (t0z, équipe « Boukki »)** : utilise en plus le
  « Coach privé » (page protégée par mot de passe), les bulletins n8n et l'export « contexte IA ».
- **Assistants IA** : reçoivent un contexte de décision copiable (`/api/context?mode=decision`) : état live, diagnostic forces/faiblesses/pression roster, trois coupes possibles décomposées, stratégie dérivée du classement/FAAB, roster enrichi, optimisation de lineup explicite, prochain matchup Sleeper et waivers groupés par action (`ADD NOW`, `CLAIM IF CHEAP`, `WATCH`, `IGNORE`) avec potentiel stratégique, coût de coupe et gain net. `mode=compact` conserve l'export règles + roster.

## 5. Fonctionnalités actuelles

| Page / outil | Ce que ça fait | Données |
|---|---|---|
| **Accueil** `/` | Stats d'archive + accès aux fonctionnalités saison 2026 en priorité | Archive + liens |
| **Standings** `/standings/` | Classement 2026 + **Luck** (victoires réelles − all-play attendues) + **% playoffs** (estimation) + **courbe du rang** semaine par semaine | Supabase + Sleeper |
| **Power Rankings** `/power-rankings/` | Score = 45 % % de victoires, 35 % points/match, 20 % marge des 3 dernières semaines (en percentiles). **Playoff Race** (arithmétique : ordre, games back du 8e). **Playoff Probabilities** (simulation Monte Carlo seedée du reste de la saison, estimation). **All-Play** (bilan si on jouait les 11 autres chaque semaine). | Sleeper + Supabase |
| **Game Center** `/matchups/` | Live (scores + estimation pré-match + **titulaires indisponibles et points perdus**), Calendrier 2026, **Récap Hebdo** (meilleur score, match le plus serré, upset, points laissés sur le banc vs lineup optimale), Archives Yahoo (face-à-face) | Sleeper + archive |
| **Équipes** `/teams/?team=` | Dossier live d'un manager : record, rang, roster (titulaires/banc/IR), alertes lineup, force par poste, all-play, FAAB restant, série, transactions récentes, Record Watch (écart aux records historiques) | Sleeper + Supabase |
| **Trade Hub** `/trades/` | Voir §6 | Sleeper + catalogue |
| **Franchises** `/franchises/` | Bilans all-time par manager (saison régulière et playoffs séparés) | Archive Yahoo |
| **Hall of Fame** `/hall-of-fame/` | Champions, records (match unique, séries), ex æquo préservés | Archive Yahoo |
| **History** `/history/` | Saison par saison 2019–2025, podiums | Archive Yahoo |
| **Rivalry Week** `/rivalry-week/` | Proposition communautaire de 6 rivalités (semaine 8) + Rivalry Tracker qui intègre les vrais matchs 2026 dès leur publication | Archive + Sleeper |
| **Coach privé** `/coach/` | War room de Boukki : priorités ordonnées, lineup optimale, waivers avec coût de coupe, watchlist, coupes et trade | Contexte décisionnel partagé + préférences locales |
| **Copier contexte IA** (header) | Contexte de décision : état live, roster enrichi, alertes et waivers adaptés | `/api/context?mode=decision` |

## 6. Trade Hub (outil d'aide à la décision)

Onglets :
- **Trade Finder** : pour l'équipe choisie, propose des échanges **bilatéraux**.
  - Chaque proposition compare la **lineup optimale avant/après** des deux équipes, en moyenne
    hebdo projetée sur le **reste de la saison régulière** (pas une seule semaine).
  - Blessures modélisées depuis le statut Sleeper : Out ≈ 1 match manqué, IR/PUP ≈ 3 ; byes restants
    déduits. Un slot vide vaut 0 pt.
  - Recherche exhaustive 1-pour-1, 2-pour-1, 1-pour-2 avec chaque équipe + heuristiques
    (surplus/déficit, menottes RB). N'affiche que les offres où **ta lineup gagne et celle du
    partenaire ne perd pas**, avec une valeur marché proche (équité).
  - Préférences par joueur (Shop / Keep / Untouchable), stockées dans le navigateur.
  - Contre-offres voisines, message de négociation copiable.
- **Trade Calculator** : compare deux paquets de joueurs en valeur marché (0–100, rareté par
  poste, décote des paquets 2-pour-1). Ce n'est pas un gain de lineup.
- **Waiver Wire (modèle v2, `docs/prd-waiver-model-v2.md`)** : Event → Opportunity → Roster Fit → FAAB. Le [contrat de fiabilité](decision-reliability-2026-10-04.md) ajoute propriété/transactions fraîches, preuves expirantes, kickoff, scénarios ajout–coupe et horizons explicites. Les actions non vérifiées sont bloquées. Les préférences de conservation datées et le plan conditionnel multi-claims sont séparés des options individuelles, avec coupes distinctes et budget réservé.
  Pool = tous les joueurs Sleeper non rostés. Valeur reste de saison (projections Sleeper semaines
  futures) + usage réel (snaps, carries + targets, red zone) + événements `NEWS_OVERRIDE`
  (titulaire blessé devant lui : PROMOTION, avec une durée qui dépend de la blessure ; SNAP/USAGE_SURGE).
  Deux scores séparés : **Market** (valeur pour la ligue, FAAB marché en $) et **Fit** (gain
  réel de TA lineup optimale, « Max pour toi » plafonné par ton FAAB). Jamais d'enchère exprimée en % de réussite.
- **Start/Sit Advisor** : **Boom / Bust** par joueur (plancher, plafond, probabilités calibrées sur
  31 000 matchs) et lineups Actuelle / Optimale / Boom / Safe avec le mode conseillé selon tes chances
  contre l'adversaire de la semaine (< 40 % → Boom, > 60 % → Safe) ; alerte sur slot vide, blessure, bye ; propose un remplaçant (banc puis FA) ; **lineup optimisée** vs actuelle (gain en points, jamais un joueur Out titularisé) ; tableau du roster de la semaine avec **difficulté du matchup** (DvP : points concédés par l'adversaire à ce poste, ramenés vers la moyenne en début de saison) ; **comparateur jusqu'à 8 joueurs**.
- **Waiver Wire, signaux de ligue** : tendances Sleeper 48 h (ajouts plateforme croisés avec la ligue et le modèle) et **historique FAAB** des enchères gagnées (médiane et max par poste).
- **Usage & Buy-Low** (`docs/prd-usage-score.md`) : Usage Score 0–100 (part de l'attaque de son
  équipe : targets, air yards, snaps, courses, red zone), points attendus (xFP) selon le volume, et
  signaux buy-low (produit sous son volume) / sell-high (au-dessus, hors usage élite). Par équipe :
  cibles à acheter, joueurs à vendre, roster, free agents à fort usage.
- **Règles & Scoring 2026**.

Automatisations n8n (mardi) :
- bulletin trades : `/api/trades?team=t0z` → message privé ;
- **suivi du modèle** (`docs/prd-model-tracking.md`) : `POST /api/model/weekly` enregistre l'état du
  modèle avant les waivers du mercredi (marché, projections futures, usage) et publie le bilan de la
  semaine écoulée (enchères gagnées vs prévues, erreur des projections selon leur ancienneté, suivi
  des signaux, ALGO FEEDBACK automatiques) → Telegram + Trade Hub › Règles › « Suivi du modèle ».

## 7. Architecture

```
Archive Yahoo (JSON gelé, 2019–2025) ─┐
Supabase Postgres (sync Sleeper)  ────┼──> site statique sans framework (public/)
API Sleeper (live, lecture seule) ────┘      + serveur Node (server.js) : fichiers + /api/*
```

- **Frontend** : HTML statique par route + un point d'entrée `site.js` ; modules purs par
  fonctionnalité (calcul sans DOM ni réseau), donc testables. Pas de build, pas de bundler ;
  cache-busting **automatique** par hash de contenu (`npm run assets:version`, vérifié par
  `npm run check`) ; appels Sleeper navigateur via un client partagé (`sleeper-client.js`).
- **Serveur** : `node:http` sans dépendance. Routes : `/api/health`, `/api/settings`,
  `/api/trades`, `/api/context`, `/api/free-agents` (waiver v2), `/api/lineup-advisor`,
  `/api/start-sit`, `/api/usage`, `/api/player-values`, `/api/player-status`,
  `/api/model/feedback`, `POST /api/model/weekly` (jeton), `/api/coach` (protégée).
- **Données joueurs** : Sleeper en direct (projections hebdo et futures, stats hebdo pour l'usage,
  statuts blessure et depth chart via le dump `/players/nfl` mis en cache 6 h) ; calendrier NFL
  nflverse (matchups) ; `public/data/players-catalog.json` (ECR/ADP **d'avant la draft**, encore
  utilisé pour la valeur marché du Trade Calculator).
- **Modèle** : valeur reste de saison = projections Sleeper sur 2 semaines puis 80 % projection +
  20 % usage (poids fixé par backtest 2021–2025, `docs/backtest-usage.md`, `npm run backtest`).
- **Supabase** : `owners` = identité canonique ; `owner_platform_ids` relie Yahoo/Sleeper. Suivi du
  modèle : `model_snapshots`, `waiver_market_snapshots`, `player_projection_snapshots`,
  `player_usage_snapshots`, `faab_outcomes`, `model_feedback` (lecture publique).
- **Déploiement** : Coolify derrière Cloudflare, auto sur push `main`. n8n : sync hebdo, bulletin
  trades, suivi du modèle.
- **Qualité** : environ 200 tests `node --test` (un fichier par module pur + tests HTTP) ;
  `npm run check` re-vérifie toute l'archive et les versions d'assets.

## 8. Limites connues (bonnes pistes d'amélioration)

1. **Projections Sleeper comme base** : elles sous-estiment certains rôles nouveaux et vieillissent
   pour les semaines lointaines. Corrigé en partie par les événements (waiver v2) et le mélange avec
   l'usage (20 %). Le suivi hebdo mesurera leur vieillissement réel.
2. **Prix du point FAAB (3 $) non calibré** : il manque des enchères comparables. Calibrage
   automatique à partir des snapshots du mardi (premiers résultats mi-octobre).
3. **Valeur marché du Trade Calculator périmée** : catalogue d'avant la draft (06/09).
4. **Taux d'absence IR approximatif** : Sleeper ne dit pas combien de matchs sont déjà passés.
5. **Pas d'acceptation réelle** : aucune donnée sur ce que les managers acceptent ; la
   « faisabilité » d'un trade est une heuristique.
6. **Pas de volatilité propre à chaque joueur** : testée et rejetée (elle dégradait la saison test) ;
   re-testée automatiquement à chaque recalibrage. Les lineups Boom / Safe diffèrent donc rarement
   de l'optimale.
7. **Dette technique restante** : styles inline des onglets Calculator et Règles, taille de `site.js`.
8. **Mono-ligue** : ID de ligue, `t0z`, règles en dur, ce qui empêche l'ouverture au grand public.
9. **Licences** : API Sleeper non commerciale ; FantasyPros exige une licence pour redistribuer.

## 9. Feuille de route

**Livré (29/09 – 01/10/2026)** : Trade Finder reste de saison (blessures, recherche exhaustive,
cartes lisibles) · Waiver Wire v2 (événements, Market vs Fit) · lot 1 Fantasy Life (Luck, % playoffs,
courbe du rang, historique FAAB, tendances, points perdus sur blessure, lineup optimisée) · Usage
Score et buy-low / sell-high · probabilités de playoffs corrigées et calibrées · backtest 2021–2025 ·
matchups (DvP) et comparateur Start/Sit · suivi hebdomadaire du modèle · dette technique (versions
d'assets automatiques, client Sleeper partagé).

**Livré (01/10/2026)** : **Boom / Bust** (plancher, plafond, Boom %, Bust % calibrés sur 31 000
matchs, lineups Boom / Safe et mode conseillé selon le match) · **Usage Score des QB** (et poids
d'usage QB de 50 % dans la valeur reste de saison, validé hors échantillon). Détails :
`docs/prd-boom-bust-qb-usage.md`.

**Prochain** : suivi des trades réellement acceptés (calibrer la « faisabilité ») · Game Exposure ·
seuils des signaux par poste via backtest · ajustements du prix FAAB et du poids d'usage quand le
suivi hebdo le justifie.

**Plus tard** : modèle de projection 100 % maison · sources commerciales, multi-ligues, comptes
(ouverture grand public, reportée).

## 10. Comment proposer une amélioration

**Format ALGO FEEDBACK** : quand une recommandation révèle une faiblesse générale, la remonter
sous cette forme. Elle sera transformée en règle et en test de non-régression, jamais en
correction ponctuelle d'un seul joueur :
```
ALGO FEEDBACK — <RÈGLE, ex. NEWS_OVERRIDE / ROSTER_FIT>
Player: …   Current output: …   Expected: …
Cause: …    Proposed rule: …
```

Une bonne suggestion précise :
- le **problème utilisateur** (quel manager, quelle décision, à quel moment de la semaine) ;
- la **donnée source** exacte (et si elle est gratuite/licenciée, disponible en direct ou historique) ;
- le **comportement si la donnée manque** (masquer, étiqueter, dégrader) ;
- la **métrique de succès** et, pour un modèle, comment le **backtester** sans fuite de données futures ;
- sa compatibilité avec les principes du §2.

Calendrier type d'une semaine : matchs jeudi → lundi ; données complètes mardi ; waivers
mercredi 09:00 (Paris) ; lineups à fixer avant chaque match.

## 11. Documents détaillés

- `docs/prd-adineu-projection-model.md` : modèle de projection (chantier 2)
- `docs/prd-waiver-model-v2.md` : modèle waiver v2 (Market vs Fit, NEWS_OVERRIDE)
- `docs/benchmark-fantasylife.md` : comparatif Fantasy Life et fonctionnalités à reproduire
- `docs/prd-usage-score.md` : Usage Score et buy-low / sell-high
- `docs/prd-model-tracking.md` : suivi hebdo du modèle (snapshots du mardi, bilan, ALGO FEEDBACK automatique)
- `docs/prd-boom-bust-qb-usage.md` : Boom / Bust et usage des QB (résultats de validation)
- `docs/backtest-usage.md` : backtest 2021–2025 (poids usage 20 %, sell-high et buy-low validés chaque saison)
- `docs/prd-playoff-probabilities.md` : probabilités de playoffs
- `docs/prd-waiver-opportunity-cost.md` : coût d'opportunité waiver (historique, remplacé par le Fit du waiver v2)
- `docs/prd-team-page.md`, `docs/prd-team-page-increment3.md` : page équipe
- `docs/audit-product-architecture.md` : audit technique (+ suivi du 01/10 : dette résolue)
- `docs/product-roadmap.md` : roadmap approuvée
- `AGENTS.md` : règles du dépôt (identités, archive Yahoo, tests, sécurité)

### Mise à jour du 05/10 — rythme marché (DEC-08)

Le rythme marché historique fondé sur `max(ROS, projection, points récents)`, les poids
75/50 %, le partage inféré et le bonus de contingence est remplacé par
`PROJECTION_WINDOW_V1`. ROS reste la base ; une projection cible temporaire est limitée
à la fenêtre de rôle. Un match exceptionnel ne devient plus un rythme durable. Méthode
et limites sont exportées ; calibration FAAB et provenance complète restent ouvertes.
Voir [le contrat et les validations](decision-reliability-2026-10-04.md).

### 05/10 — provenance et archive locale des décisions

Couverture par joueur/semaine et dates réelles de chargement exportées ; diagnostics xFP
sur fenêtre commune et unité de trend corrigée. CLI `decision:snapshot` : archive privée
immutable et relecture hors réseau avec cutoff, intégrité et audit opérationnel. Livré en
local uniquement. Replay des calculs sur inputs bruts, historique réel et calibration restent
ouverts. Voir [le contrat détaillé](decision-reliability-2026-10-04.md).

### 05/10 — snapshots de calcul V2

Collecte locale des inputs et empreinte du modèle, puis recalcul hors réseau du marché,
fit, actions et plan avec le même évaluateur que le live. Test de reproduction exacte et
parcours fichier→CLI validés. L’extraction initiale des features reste figée ; historique réel,
backtests complets et calibration restent ouverts. Aucun déploiement.
Voir [le contrat V2](decision-reliability-2026-10-04.md).

### 05/10 — replay des features raccordé

Les nouveaux inputs V2 réextraient usage/xFP, ROS, événements et disponibilité depuis les
sources archivées, puis reconstruisent roster, contraintes et budget. Même extraction que
le live, sans réseau, tests de reproduction et de variations source. La limite d’extraction
figée de la première livraison V2 est levée pour ces nouvelles captures. Historique réel,
mesure des résultats et calibration restent ouverts. Aucun déploiement.
Voir [le contrat](decision-reliability-2026-10-04.md).

### 05/10 — évaluation des résultats et début de l’historique local

CLI `decision:evaluate` : résultats indépendants, erreurs de projections par horizon,
contrôles opérationnels et fourchettes FAAB versus gagnants par poste/durée. Rejet des
observations futures/partielles et des conflits ; aucune calibration automatique ni probabilité
inférée des seuls gagnants. Première capture locale réelle t0z le 05/10 à 08:00:19 UTC,
reproduction exacte hors réseau. Observation du lundi, jamais assimilée à du pré-match dimanche.
Collecte multi-semaines et résultats sourcés restent à constituer. Aucun déploiement.
Voir [le contrat](decision-reliability-2026-10-04.md).

### 05/10 — retour complémentaire intégré localement

Moteur Monte Carlo existant réutilisé dans Context/Coach avec couverture/hypothèses ; préparation
partagée avec les pages, Playoff Race toujours arithmétique. Métriques waiver canoniques et test
d’invariant entre outils. Journal immutable des recommandations, choix explicites et bilans 2/4
semaines ; WATCH/IGNORE suivis également. Journal initial de 60 recommandations sans choix inventé.
Voir [le contrat et ses limites](decision-reliability-2026-10-04.md). Aucun déploiement.

### 05/10 — WOPR numérique : validation préalable

CLI de validation et comparaison de sources numériques versionnées : période, univers/IDs,
unités, volumes absolus, formule, moyennes et lineage. Contradictions bloquées, routes manquantes
nulles, aucune probabilité de rebond. Garde prêt ; ingestion réelle attend les fichiers numériques
des graphiques et leur univers confirmé. Exemple fictif dans docs/examples, aucun changement
de paramètres ou déploiement. Voir [le contrat](decision-reliability-2026-10-04.md).
