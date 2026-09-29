# Adineu Fantasy — PRD global

Version : 29 septembre 2026 (semaine 4 NFL). Document de référence du produit : à joindre à
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
- **Assistants IA** : reçoivent un contexte ligue + roster copiable (`/api/context`) pour conseiller.

## 5. Fonctionnalités actuelles

| Page / outil | Ce que ça fait | Données |
|---|---|---|
| **Accueil** `/` | Stats d'archive + accès aux fonctionnalités saison 2026 en priorité | Archive + liens |
| **Standings** `/standings/` | Classement 2026 | Supabase (sync Sleeper) |
| **Power Rankings** `/power-rankings/` | Score = 45 % % de victoires, 35 % points/match, 20 % marge des 3 dernières semaines (en percentiles). **Playoff Race** (arithmétique : ordre, games back du 8e). **Playoff Probabilities** (simulation Monte Carlo seedée du reste de la saison, estimation). **All-Play** (bilan si on jouait les 11 autres chaque semaine). | Sleeper + Supabase |
| **Game Center** `/matchups/` | Live (scores + estimation pré-match), Calendrier 2026, **Récap Hebdo** (meilleur score, match le plus serré, upset, points laissés sur le banc vs lineup optimale), Archives Yahoo (face-à-face) | Sleeper + archive |
| **Équipes** `/teams/?team=` | Dossier live d'un manager : record, rang, roster (titulaires/banc/IR), alertes lineup, force par poste, all-play, FAAB restant, série, transactions récentes, Record Watch (écart aux records historiques) | Sleeper + Supabase |
| **Trade Hub** `/trades/` | Voir §6 | Sleeper + catalogue |
| **Franchises** `/franchises/` | Bilans all-time par manager (saison régulière et playoffs séparés) | Archive Yahoo |
| **Hall of Fame** `/hall-of-fame/` | Champions, records (match unique, séries), ex æquo préservés | Archive Yahoo |
| **History** `/history/` | Saison par saison 2019–2025, podiums | Archive Yahoo |
| **Rivalry Week** `/rivalry-week/` | Proposition communautaire de 6 rivalités (semaine 8) + Rivalry Tracker qui intègre les vrais matchs 2026 dès leur publication | Archive + Sleeper |
| **Coach privé** `/coach/` | Plan hebdo pour t0z : lineup, waivers, trades | APIs internes |
| **Copier contexte IA** (header) | Bloc texte : règles + roster live, à coller dans un assistant | `/api/context` |

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
- **Waiver Wire (modèle v2, `docs/prd-waiver-model-v2.md`)** : Event → Opportunity → Roster Fit → FAAB.
  Pool = tous les joueurs Sleeper non rostés. Valeur reste de saison (projections Sleeper semaines
  futures) + usage réel (snaps, carries + targets, red zone) + événements `NEWS_OVERRIDE`
  (titulaire blessé devant lui : PROMOTION, avec une durée qui dépend de la blessure ; SNAP/USAGE_SURGE).
  Deux scores séparés : **Market** (valeur pour la ligue, FAAB marché en $) et **Fit** (gain
  réel de TA lineup optimale, « Max pour toi » plafonné par ton FAAB). Jamais d'enchère exprimée en % de réussite.
- **Start/Sit Advisor** : alerte sur slot vide, blessure, bye ; propose un remplaçant (banc puis FA).
- **Règles & Scoring 2026**.

Bulletin automatique : chaque mardi, n8n appelle `/api/trades?team=t0z` et envoie le message.

## 7. Architecture

```
Archive Yahoo (JSON gelé, 2019–2025) ─┐
Supabase Postgres (sync Sleeper)  ────┼──> site statique sans framework (public/)
API Sleeper (live, lecture seule) ────┘      + serveur Node (server.js) : fichiers + /api/*
```

- **Frontend** : HTML statique par route + un point d'entrée `site.js` ; modules purs par
  fonctionnalité (calcul sans DOM ni réseau), donc testables. Pas de build, pas de bundler ;
  cache-busting manuel `?v=N`.
- **Serveur** : `node:http` sans dépendance. Routes : `/api/health`, `/api/settings`,
  `/api/trades`, `/api/context`, `/api/free-agents`, `/api/lineup-advisor`, `/api/player-status`,
  `/api/coach` (protégée).
- **Données joueurs** : `public/data/players-catalog.json` (886 joueurs, ECR FantasyPros + ADP,
  **figé au 6 septembre 2026, avant la draft**) ; projections hebdo Sleeper ; statuts blessure
  Sleeper (dump de 15 Mo mis en cache 6 h côté serveur).
- **Supabase** : `owners` = identité canonique ; `owner_platform_ids` relie Yahoo/Sleeper.
- **Déploiement** : Coolify derrière Cloudflare, auto sur push `main`. n8n : sync hebdo + bulletin trades.
- **Qualité** : ~150 tests `node --test` (un fichier par module pur + tests HTTP) ;
  `npm run check` re-vérifie toute l'archive et la cohérence des versions d'assets.

## 8. Limites connues (bonnes pistes d'amélioration)

1. **Baseline ROS = projections Sleeper** : elles sous-estiment certains rôles nouveaux (Keenan Allen, Braelon Allen en semaine 4). Les règles d'événements corrigent en partie.
2. **Valeur marché des trades périmée** : catalogue d'avant la draft (06/09). Cause principale de trades qui
   paraissent absurdes. → Phase 0 du modèle (§9).
3. **Projections dépendantes de Sleeper**, sans modèle propre ni validation historique.
4. **Taux d'absence IR approximatif** : Sleeper ne dit pas combien de matchs sont déjà passés.
5. **Pas d'acceptation réelle** : aucune donnée sur ce que les managers acceptent ; la
   « faisabilité » est une heuristique.
6. **Dette technique** : `?v=N` manuel (~70 occurrences), 4 modules refetchent rosters/users
   chacun, `trade-ui.js` en styles inline, `site.js` volumineux.
7. **Mono-ligue** : ID de ligue, `t0z`, règles en dur, ce qui empêche l'ouverture au grand public.
8. **Licences** : API Sleeper non commerciale ; FantasyPros exige une licence pour redistribuer.

## 9. Feuille de route

**En cours / validé**
- Trade Finder reste-de-saison + blessures + recherche exhaustive : livré le 29/09.
- **Modèle de projection Adineu** (`docs/prd-adineu-projection-model.md`) :
  - Phase 0 : valeur ROS depuis les projections Sleeper des semaines futures (gratuit), rafraîchie chaque mardi.
  - Phase 1 : modèle opportunité × efficacité (targets, air yards, snaps via nflverse), scorer
    exact de la ligue, blend avec le consensus.
  - Phase 2 : backtest 2024–2025 par date de décision ; mise en prod seulement si le modèle bat le consensus.

**Prochain : lot 1 du benchmark Fantasy Life** (`docs/benchmark-fantasylife.md`) : Luck +
Playoff % dans Standings, courbe du rang, historique FAAB de la ligue, trending adds, points
perdus sur blessure, lineup optimisée.

**Plus tard**
- Sources commerciales, multi-ligues, comptes : ouverture grand public (reportée).
- Suivi des trades réellement acceptés pour calibrer la « faisabilité ».
- Réduction de la dette technique (cache-busting automatique, fetch roster partagé).

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
- `docs/prd-playoff-probabilities.md` : probabilités de playoffs
- `docs/prd-waiver-opportunity-cost.md` : coût d'opportunité waiver
- `docs/prd-team-page.md`, `docs/prd-team-page-increment3.md` : page équipe
- `docs/audit-product-architecture.md` : audit technique
- `docs/product-roadmap.md` : roadmap approuvée
- `AGENTS.md` : règles du dépôt (identités, archive Yahoo, tests, sécurité)
