# PRD — Fantasy SOS Explorer V1.1

Date : 15 octobre 2026. Statut : premier incrément moteur implémenté localement ; API, archives, interface et Coach à faire. Non déployé. Position : WR, scoring Full PPR. Cette version remplace le périmètre exclusivement ROS du brouillon V1 par un SOS temporel et vérifiable.

## Objectif et garde-fous

Comparer les 32 franchises NFL selon les défenses rencontrées et à venir, puis vérifier chaque semaine les prévisions réellement émises. Séparer saison régulière fantasy ADINEU (W1–14), playoffs fantasy (W15–17) et saison NFL (W1–18).

V1.1 reste explicative et en lecture seule sur les plateformes. Aucun ajustement de `rosPpg`, `effectivePpg`, projections Sleeper, FAAB, gains nets, coupes, ordre waiver ou `coherence.publishable`. Les snapshots sont des écritures internes du job serveur, jamais un effet de bord d'une lecture HTTP. Aucun rang fictif ni prévision historique reconstruite présentée comme authentique.

## P0 — Audit du dépôt au 15/10/2026

| Brique vérifiée | Disponible | Adaptation nécessaire |
|---|---|---|
| `public/assets/defense-vs-position.js` | `buildDefenseVsPosition`, valeurs `allowedPerGame`, `games`, `adjusted`, moyenne NFL pondérée par match ; `SHRINK_GAMES = 3` | Ajouter enveloppe de provenance, validité et observations par match ; réutiliser le calcul sans double régression |
| `scripts/lineup-advisor.js` | DvP construit depuis les stats Sleeper des semaines antérieures et les adversaires nflverse | Les échecs de semaines sont actuellement ignorés ; exposer les lacunes. `teamOf` utilise l'équipe actuelle du joueur : insuffisant pour une archive fiable après transfert |
| `scripts/league-context.js`, `getSchedule` | nflverse `games.csv`, REG, semaine, équipes, `kickoffAt`, `completed`, source ; cache 12 h ; alias LA → LAR | Préserver `game_id`, saison, dates de collecte et validation de complétude ; normalisation explicite des 32 équipes |
| `scripts/decision-evidence.js` | `easternKickoffIso` convertit l'heure Eastern vers UTC | Réutiliser ; kickoff absent = calendrier invalide, jamais match supposé futur |
| `public/assets/league-settings.js` | Full PPR, saison régulière W14 et début playoffs W15 | Lire ces constantes ; expliciter la borne W17 de l'horizon playoffs |
| `scripts/model-tracking.js` | Job hebdomadaire, premier snapshot conservé sauf option force, feedback et persistance | Réutiliser l'orchestration ; payload SOS absent. L'option force existante ne doit pas écraser les archives SOS |
| `scripts/decision-snapshot.js` | Archive locale, hash, cutoff et replay | Réutiliser les principes d'intégrité, sans confondre snapshots de décisions privées et calendrier public |
| `scripts/coach-assistant.js`, `scripts/ai-context.js` | Explications Coach et export IA existants | Ajouter un objet SOS partagé, sans changer les décisions |

Contrat de référence : [feedback DvP](decision-feedback-dvp-2026-10-06.md), [suivi hebdomadaire](prd-model-tracking.md). Aucun appel externe ni validation de fraîcheur des données de production n'a été effectué pour cet audit de code.

Le DvP n'est donc pas limité à des rangs. Le blocage P0 porte sur la qualité/provenance des observations, les équipes historiques des joueurs et la complétude du calendrier. Un tableau incomplet de joueurs ne prouve pas un total WR valide. Un zéro est accepté seulement si le match est complet et que le total zéro est attesté ; `null`, chaîne vide et absence ne deviennent jamais zéro.

## Fenêtres et perspectives

| Horizon | Inclusion | Usage |
|---|---|---|
| `PAST` | W1 à dernière semaine NFL entièrement terminée, matchs confirmés terminés | Contextualiser la production passée |
| `NEXT_3` | Trois prochains matchs non commencés de chaque équipe, jusqu'à W18 | Court terme ; trois matchs, pas trois semaines |
| `FANTASY_ROS` | Semaine courante à W14, matchs non commencés | Saison régulière ADINEU ; défaut |
| `FANTASY_PLAYOFFS` | W15–17, matchs non commencés | Stratégie playoffs |
| `NFL_ROS` | Semaine courante à W18, matchs non commencés | Fin de saison NFL |

`CURRENT` utilise les dernières données validées ; `AS_OF_SNAPSHOT` relit exactement un calcul archivé ; `EVALUATION` compare des prévisions archivées et des résultats confirmés. Une combinaison non pertinente est refusée : l'évaluation concerne les prévisions futures archivées, pas le PAST rétrospectif.

PAST courant est rétrospectif et peut changer avec les statistiques disponibles. PAST figé agrège les difficultés pré-match réellement archivées, avec couverture explicite ; il n'est jamais substitué par le PAST courant. Dans les deux cas, libeller la perspective. Une comparaison passé/futur n'est pas une causalité ni une mesure d'ajustement au niveau des adversaires déjà rencontrés par chaque défense.

Pendant une semaine mixte : PAST s'arrête à la dernière semaine entièrement terminée ; les matchs déjà joués de la semaine courante restent visibles dans le calendrier avec leur statut, mais hors PAST et hors futur. Tout match dont `kickoff <= asOf`, même sans score final, est exclu du futur. Les reports suivent le calendrier validé ; un changement de kickoff invalide le cache courant sans modifier l'archive.

Byes visibles, exclus des dénominateurs. Une semaine sans match ne devient BYE que si le calendrier complet le confirme ; sinon `SCHEDULE_UNKNOWN`. Ne jamais qualifier de COMPLETE une équipe dont le calendrier est incomplet. La fin d'horizon sans match produit `NO_REMAINING_GAMES`, pas une difficulté nulle.

## Contrats proposés

Modules ES purs et pages statiques, serveur `node:http`, sans bundler. Nouveaux chemins ci-dessous : propositions, pas capacités existantes.

```ts
type SosHorizon = "PAST" | "NEXT_3" | "FANTASY_ROS" | "FANTASY_PLAYOFFS" | "NFL_ROS";
type SosViewMode = "CURRENT" | "AS_OF_SNAPSHOT" | "EVALUATION";
type Coverage = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
type SosWindow = {
  horizon: SosHorizon; startWeek: number; endWeek: number;
  asOf: string; snapshotId: string | null; viewMode: SosViewMode;
};
type SosOpponent = {
  week: number; gameId: string; opponent: string; kickoff: string;
  opponentWrPprAllowed: number | null; opponentWrGames: number;
  adjustedDifficulty: number | null;
  status: "COVERED" | "MISSING_DVP";
};
type TeamWrSos = {
  team: string; position: "WR"; window: SosWindow;
  gamesInWindow: number; coveredGames: number; coveragePct: number;
  coverageStatus: Coverage; scheduleComplete: boolean;
  reason: string | null; sosScore: number | null; rank: number | null;
  difficulty: "FAVORABLE" | "NEUTRAL" | "DIFFICULT" | null;
  opponents: SosOpponent[]; byeWeeks: number[];
};
type WrSosResponse = {
  snapshotId: string; asOf: string; season: number; scoring: "FULL_PPR";
  window: SosWindow; methodologyVersion: string; shrinkGames: number;
  leagueAverage: number | null; rankedTeams: number;
  sources: { schedule: Source; dvp: Source };
  teams: TeamWrSos[]; warnings: string[];
};
type Source = {
  name: string; url: string; fetchedAt: string; dataThroughWeek: number | null;
  completedWeeks: number[]; inputHash: string;
};
```

Ajouter au bundle les inputs numériques par défense (`team`, `games`, `allowedPerGame`, semaines couvertes, raisons d'invalidité), la table d'alias versionnée et le hash des paramètres. `snapshotId` identifie le bundle commun à tous les horizons ; `window.snapshotId` vaut null en CURRENT et l'identifiant archivé en lecture historique. Aucun identifiant privé de roster dans ce bundle.

Une table explicite canonique des 32 équipes définit les codes nflverse, DvP et Sleeper, incluant LA/LAR ; les codes inconnus provoquent une anomalie explicite. Pas de rapprochement approximatif. `game_id` est conservé depuis nflverse, jamais fabriqué à partir d'une semaine et de noms.

## Calcul déterministe

1. Valider saison, calendrier, kickoffs, unicité des matchs et équipes ; capturer un unique `asOf` UTC pour tout le bundle.
2. Construire le DvP WR avec des semaines entièrement terminées, collectées avant le cutoff. Vérifier Full PPR contre les paramètres de ligue et identifier l'équipe de chaque joueur à la semaine observée. Si cette identité n'est pas prouvée, invalider les observations concernées.
3. Calculer `mu = sum(n_d * P_d) / sum(n_d)` sur les observations valides. Pas de moyenne non pondérée des moyennes défensives. Zéro observation valide : moyenne et scores null.
4. `D_d = (n_d * P_d + k * mu) / (n_d + k)`. Garder **k = 3** pour V1.1, aligné sur le moteur actuel ; k = 4 reste une hypothèse de backtest, sans modification silencieuse du DvP existant. Paramètre et version archivés. Ne pas réajuster `adjusted` une seconde fois.
5. SOS = moyenne des `D_d` des adversaires couverts dans la fenêtre, chaque rencontre comptant une fois, y compris un même adversaire affronté deux fois. Sur couverture partielle, score indicatif uniquement.
6. Arrondir le score à deux décimales pour publication et égalités ; classer décroissant avec rangs de compétition (1, 1, 3), puis code canonique alphabétique pour stabilité.

Libellé : **« WR PPR concédés par match, ajustés »**, pour l'ensemble des WR adverses ; jamais des points attendus pour un joueur.

| Couverture | Publication |
|---|---|
| Tous les matchs couverts, calendrier complet | COMPLETE, score et rang |
| Au moins un match couvert, données ou calendrier incomplets | PARTIAL, score indicatif, rang null |
| Matchs attendus mais aucune donnée valide | UNAVAILABLE, score et rang null |
| Aucun match dans une fenêtre validée | COMPLETE, score/rang null, motif NO_REMAINING_GAMES pour futur, NO_COMPLETED_GAMES pour passé |
| Calendrier inexploitable | UNAVAILABLE, score/rang null, motif SCHEDULE_UNAVAILABLE |

Couverture = couverts / matchs de la fenêtre ; fenêtre vide validée : 100 %. Calendrier incomplet : pourcentage calculé sur les seuls matchs connus, avertissement « dénominateur incomplet », jamais présenté comme couverture totale.

Difficulté : reprendre les seuils existants du DvP (`SOS / mu >= 1.12` favorable, `<= 0.88` difficile, sinon neutre), documentés comme heuristiques non calibrées. Si mu est nul ou couverture incomplète : signal null. Ne pas déduire la difficulté d'un rang arbitraire. « Classement complet » exige 32 scores classables ; sinon « Classement partiel — X/32 équipes classées ». Toujours afficher les 32 équipes avant filtrage.

## API et cache

- `GET /api/sos?position=WR&horizon=FANTASY_ROS` : bundle courant sélectionné ; alias `horizon=ROS` accepté pour FANTASY_ROS.
- `GET /api/sos?position=WR&horizon=...&snapshotId=...` : relecture historique ; jamais de fetch courant pour combler une archive.
- `GET /api/sos/evaluation?snapshotId=...` : évaluation des matchs du snapshot, uniquement résultats confirmés ; résultats manquants restent null.
- 400 JSON `{error:{code,message}}` pour position/horizon/combinaison/identifiant malformé ; 404 pour snapshot inconnu ; 503 si aucun bundle source cohérent ne peut être fourni. Une absence DvP seule peut produire 200 avec 32 lignes UNAVAILABLE et avertissement.

Service proposé `scripts/sos-service.js`, moteur `public/assets/wr-ros-sos.js`. Cache partagé Explorer/Coach/IA, clé saison + version + hashes sources + cutoff ; un bundle contient les cinq horizons. TTL courant proposé 15 minutes, plafonné au prochain kickoff : un cache nflverse 12 h ne doit pas maintenir un match commencé dans le futur. Construction atomique, requêtes concurrentes regroupées. Un bundle périmé ne donne aucun signal Coach ; afficher son âge et motif explicite si consultation historique demandée. Invalider après changement de paramètres ou calendrier.

## Explorer et Coach

Page proposée `/sos/`, rendu `public/assets/sos-explorer.js`, navigation via `site.js`. Tableau : rang, équipe, score, difficulté, matchs couverts/total et statut. Ligne dépliable : semaine, adversaire, kickoff, bye, valeur brute/ajustée, échantillon et provenance datée. États chargement, vide, partiel et indisponible explicites ; contrôles accessibles au clavier et tableau utilisable sur mobile.

Filtres : équipe, difficulté, couverture et semaines affichées. Ces filtres ne modifient ni scores ni rangs. Le sélecteur d'horizon change réellement le calcul lu ; NEXT_3 dépend des trois rencontres propres à chaque équipe. Un filtre semaine ne réduit que le détail. Afficher date, perspective et fenêtre en permanence. Comparaison passé/futur à même bundle et suivi des rangs uniquement entre fenêtres/méthodes compatibles.

Coach : rattacher par code NFL le même objet SOS aux WR du roster et des waivers. Diagnostic WR : rang, couverture, matchs restants et trois prochains adversaires (dans l'horizon disponible). Export IA conserve `snapshotId`, fenêtre, score, motif et sources identiques. NEXT_3 pour contexte immédiat, FANTASY_ROS pour conservation/trade, playoffs pour stratégie ; rôle, disponibilité et volume restent prioritaires.

Signaux explicatifs `FAVORABLE_WR_ROS_SCHEDULE`, `NEUTRAL_WR_ROS_SCHEDULE`, `DIFFICULT_WR_ROS_SCHEDULE` uniquement pour un FANTASY_ROS complet et valide. Autres horizons portent leur horizon explicitement. Aucun signal favorable ne suffit à ADD ou START. Sans données : `sos: null` et motif, Coach fonctionnel. Ne pas modifier les listes existantes de raisons utilisées par le moteur de décision ; ajouter un espace explicatif séparé.

## Snapshots et évaluation hebdomadaire

Étendre le job de `scripts/model-tracking.js` : bilan confirmé de W−1, puis capture SOS W avant les waivers et kickoffs. Une relance conserve le premier snapshot publié ; un échec de capture reste visible sans interrompre les autres sorties du Coach. Aucun remplacement via `--force-snapshot` : correction append-only liée à l'original, avec motif et version.

Stockage logique proposé, à mapper au schéma existant avant migration :

- `sos_snapshots` : saison, semaine opérationnelle, asOf, version, paramètres, inputs/sorties, hashes, référence optionnelle au snapshot du modèle. Unicité du snapshot hebdomadaire publié ; transaction atomique, aucun bundle partiellement lisible.
- `sos_snapshot_matchups` : snapshot, game_id, équipe offensive, défense, kickoff prévu, valeur pré-match, couverture. Unicité `(snapshot_id, game_id, offensive_team)` ; un match a deux observations défensives.
- `sos_feedback` : snapshot, game_id, défense, prédiction, total WR observé, erreur absolue, date/source/version du résultat. Corrections de stats tracées sans modifier la prévision.

Réutiliser ordonnanceur, client et conventions du suivi existant ; ne pas créer un deuxième pipeline de calendrier/DvP. Le modèle hebdomadaire possède des voies de remplacement : ne pas supposer son immutabilité suffisante pour SOS. Migration et accès Supabase à concevoir/tester hors production ; écritures serveur uniquement et lectures publiques limitées au SOS agrégé. Ne pas exposer décisions privées ou identités Sleeper.

Éligibilité : snapshot strictement avant kickoff effectif, source collectée avant snapshot, données jusqu'à W−1 pour cible W ; match terminé et total WR complet. Exclure prévisions tardives, manquantes et résultats incomplets, avec compte des exclusions. Les archives démarrent à l'activation, pas au début supposé de saison.

Évaluation hebdomadaire : MAE sur points WR collectifs, Spearman avec rangs moyens en cas d'égalité, matrice favorable/neutre/difficile et taux de classification correcte, nombre de matchs, couverture et exclusions. Catégories observées : mêmes seuils par rapport à mu archivée, pas une moyenne future. Spearman null si variance nulle ou moins de trois paires ; pas de conclusion de fiabilité sur moins de 30 observations (seuil de communication, pas garantie statistique).

Séparer prévisions à un match et score moyen d'horizon. Comparer un SOS d'horizon aux observations uniquement sur le même ensemble de matchs ; ne pas évaluer un ROS complet avec une seule semaine. Pour éviter le double comptage, métriques principales par semaine cible sur le dernier snapshot hebdomadaire éligible ; analyses des autres lead times séparées. Tracer l'évolution des rangs sans l'interpréter comme une erreur prédictive.

Backtest chronologique : ajuster k sur entraînement antérieur, figer, valider sur semaines ultérieures ; comparer k=3, k=4 et baseline mu. Aucun résultat postérieur au cutoff ni équipes historiques approximatives. Sans sources historiques datées, qualifier l'étude de rétrospective exploratoire ; elle ne remplace pas l'évaluation prospective. Aucun bénéfice prédictif revendiqué avant résultats documentés.

## Lots et suivi de livraison

| ID | Lot / fichiers proposés | Critère de sortie | État |
|---|---|---|---|
| SOS-00 | Audit et contrat source ; modules DvP/calendrier existants | Provenance, identités historiques et validation du calendrier spécifiées puis vérifiées en fixtures | Audit de code fait ; adaptations à faire |
| SOS-01 | `public/assets/wr-ros-sos.js`, `test/wr-ros-sos.test.js` | Cinq fenêtres, 32 équipes, déterminisme et couverture | Moteur livré, fixtures validées |
| SOS-02 | `scripts/sos-service.js`, `server.js`, tests HTTP | Bundle partagé, validation, TTL/kickoff, erreurs explicites | À faire |
| SOS-03 | Migration sous `supabase/`, job modèle, tests stockage | Capture atomique immutable, relance et reprise | À faire |
| SOS-04 | `/sos/`, rendu, navigation | Filtres, détails, perspectives et états accessibles | À faire |
| SOS-05 | Feedback SOS et vue évaluation | Prévisions authentiques vs résultats, exclusions et métriques | À faire |
| SOS-06 | Coach, contexte IA et tests non-régression | Même snapshot et décisions inchangées | À faire |
| SOS-07 | Vérification, documentation d'exploitation | Tests/check, navigateur desktop/mobile, contrôle production après déploiement | À faire |

PR conseillées : (1) SOS-00/01, sources et moteur ; (2) SOS-02/03, service et archives ; (3) SOS-04/05, Explorer et évaluation ; (4) SOS-06/07, Coach et validation finale. Chaque PR met à jour ce tableau avec preuves et limites. Le suivi commence dès la livraison des archives ; ne pas attendre le Coach pour collecter.

## Evals et critères d'acceptation

Ship signal : tous les contrôles applicables passent, sources rejouables, aucune mutation du moteur fantasy, limites affichées. Les cases restent ouvertes jusqu'à implémentation et preuve de validation.

- [ ] 32 équipes uniques dans chaque horizon, rang 1 favorable, égalités 1/1/3 et ordre stable.
- [ ] Fixture de semaine mixte : terminés et kickoffs passés exclus du futur, borne W14 respectée, PAST sans semaine partielle.
- [ ] NEXT_3 compte trois matchs malgré bye ; playoffs W15–17 et NFL ROS W18 distincts.
- [ ] Byes hors dénominateur, calendrier incomplet distinct d'un bye ; game_id dupliqué/inconnu rejeté.
- [ ] Régression vers mu pondérée, k versionné, pas de double ajustement.
- [ ] Fixture DvP partiel : score indicatif, rang null ; aucune conversion de manque en zéro.
- [ ] Aucun match restant distinct de zéro donnée, saison avant W1 et après W18 couvertes.
- [ ] Cutoff et identités historiques : transfert de joueur, stats incomplètes et scoring incompatible invalident les données concernées.
- [ ] Filtres laissent scores/rangs inchangés ; changement d'horizon lit la bonne fenêtre.
- [ ] API : 400/404/503, alias ROS, absence DvP, absence de secrets et séparation public/privé.
- [ ] Cache expirant au kickoff ; accès concurrents Explorer/Coach/IA lisent le même bundle.
- [ ] Snapshot immutable : relance, option force, transaction interrompue, correction append-only et replay hors réseau identique.
- [ ] Feedback sans fuite temporelle, stats corrigées tracées, doublons exclus, MAE/Spearman et cas dégénérés testés.
- [ ] Coach/IA : même snapshot/score ; avec ou sans SOS, projections, ordre des candidats, gains, coupes et publishable identiques.
- [ ] `npm test`, `npm run check` et vérification navigateur desktop/mobile passent ; aucune compilation ni lint configurés à ce jour.
- [ ] Après déploiement : API, page et Coach cohérents en production ; première capture réelle et date de début de suivi documentées.

## Journal des décisions

15/10/2026 : demande initiale WR/ROS étendue au passé, futur et vérification hebdomadaire. Cinq fenêtres retenues, FANTASY_ROS par défaut. PAST rétrospectif séparé des prévisions figées. Réutilisation du DvP numérique confirmée par lecture du code ; k=3 conservé pour cohérence, k=4 à évaluer. Module nflverse à enrichir plutôt qu'à dupliquer. Ce document trace la spécification ; aucune livraison fonctionnelle, migration, PR distante ou validation de production n'est revendiquée.


## Livraison du premier incrément — 15/10/2026

`public/assets/wr-ros-sos.js` implémente les cinq fenêtres CURRENT, la table explicite des 32 franchises, la régression k=3, les rangs et la couverture. Le chargeur nflverse partagé conserve désormais `gameId` et `season`. Tests : `test/wr-ros-sos.test.js`, incluant DvP partiel, semaine mixte, identités, provenance, horizons et contrat du chargeur.

Contrat d'appel réel du moteur : `calculateWrSos({season, week, lastCompletedWeek, asOf, schedule, dvp, horizon, shrinkGames})`. Les enveloppes exigent `source` et `fetchedAt`. `schedule` porte `games` et une attestation booléenne `complete`. `dvp` porte `scoring: "FULL_PPR"`, `completedWeeks` et la Map `byDefense` du moteur existant ; chaque entrée doit ajouter `valid: true` après vérification de complétude et d'identité historique. Sans attestation, aucun score n'est produit pour cette défense. Les sorties sont des calculs CURRENT, sans identifiant d'archive ni hash à ce stade ; le service SOS-02 devra construire le bundle versionné commun.

Limites explicites : SOS-00 reste partiel. Aucune attestation de complétude live, aucun adaptateur d'identités historiques de joueurs, aucun snapshot ni branchement Coach ne sont ajoutés dans cet incrément. `schedule.complete` est un contrat amont à vérifier, pas une inférence du moteur. PAST figé et EVALUATION appartiennent au lot archives/feedback. La fonction ne remplace pas le calcul DvP existant et n'est appelée par aucun moteur de décision en production.
