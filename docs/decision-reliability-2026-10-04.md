# Fiabilité des décisions — contrat et état de livraison

Référence : backlog utilisateur `ADINEU_Model-Decision_Backlog_2026-10-04.md`, cas pré-match S4 avec statistiques jusqu’à S3. Les exemples joueurs sont des observations historiques, pas des confirmations NFL actuelles. Les changements sont locaux, non déployés. Mise à jour : 05/10/2026.

## Disponibilité et transactions (DEC-01)

- Transactions Sleeper relues sans cache, puis propriété relue une seconde fois. Fenêtre de 72 h, plafond de 30 entrées, compteur de troncature, marqueur de pertinence. Les semaines antérieures sont incluses pour les cas qui traversent une frontière de semaine.
- `ownershipAsOf`, `transactionsFetchedAt`, `availabilityAsOf`, `ownershipRechecked` et `transactionCoverage` décrivent les lectures. `snapshotSynchronized=false` : elles ne sont pas atomiques. Échec de relecture ou transactions incomplètes : aucune action exécutable.
- La propriété actuelle prime. Une coupe ne prouve ni disponibilité gratuite ni déblocage. Une transaction complète postérieure à l’observation invalide sa preuve de disponibilité.
- États : `FREE_AGENT`, `WAIVER_LOCKED`, `ROSTERED`, `GAME_LOCKED`, `UNKNOWN`. `canAddNow`, `canStartTargetWeek`, `waiverProcessesAt` et `kickoffAt` sont distincts.
- Le calendrier nflverse déjà utilisé par le projet fournit les kickoffs ; `gametime` est en heure Eastern, convertie en UTC avec gestion EST/EDT. Source : [dictionnaire nflverse](https://nflreadr.nflverse.com/articles/dictionary_schedules.html). Le calendrier est mis en cache 12 h ; ce n’est pas une garantie contre une modification récente.
- L’[API publique Sleeper](https://docs.sleeper.com/) ne documente pas les déblocages individuels. La preuve opérateur reste nécessaire ; sans preuve valide, `UNKNOWN` et surveillance.

## Charger les preuves serveur

Configurer `DECISION_EVIDENCE_FILE` avec un chemin serveur, hors `public/`, vers un JSON ignoré par Git. Le fichier est relu à chaque rapport. Le chemin ne peut pas être fourni par une requête HTTP. Le même chemin est utilisé par le serveur et la CLI si la variable est chargée dans leur environnement.

Exemple de structure **fictive**, à remplacer par des observations sourcées :

```json
{
  "version": 1,
  "leagueId": "1392715510830878721",
  "season": "2026",
  "targetWeek": 4,
  "availabilityById": {
    "player-id": {
      "availability": "WAIVER_LOCKED",
      "source": "https://example.com/dated-sleeper-observation",
      "observedAt": "2026-10-04T09:00:00Z",
      "expiresAt": "2026-10-04T18:00:00Z",
      "waiverProcessesAt": "2026-10-05T07:00:00Z"
    }
  },
  "rolesById": {
    "qb-id": {
      "source": "https://example.com/official-starter-announcement",
      "observedAt": "2026-10-04T09:00:00Z",
      "expiresAt": "2026-10-04T18:00:00Z",
      "roleConfirmation": "CONFIRMED",
      "announcedRole": "STARTING_QB",
      "roleWeeks": 1
    }
  }
}
```

La portée ligue/saison/semaine est vérifiée. Observation future, expiration dépassée ou absence de source : preuve inutilisable. Une heure de traitement passée ne confirme pas que le waiver a effectivement déverrouillé. Les injections programmatiques `availabilityEvidenceById` / `roleEvidenceById` doivent inclure cette même portée dans chaque entrée.

En cas de fichier absent/malformé ou de portée différente, le rapport conserve les projections et signale `DECISION_EVIDENCE_UNREADABLE` ou `DECISION_EVIDENCE_SCOPE_MISMATCH`, sans confirmer une action. Aucun fichier de preuves réelles n’est fourni par cette livraison. Les exemples ci-dessus expirent et ne doivent jamais servir de preuves de production.

## Scénarios ajout–coupe et horizons (DEC-02/03/07)

Chaque coupe éligible est simulée **avec** l’ajout. Les titulaires du même poste peuvent être remplacés ; les autres titulaires et la réserve sont protégés. Coupe interdite si kickoff inconnu ou commencé. Les titulaires verrouillés restent dans leurs slots pour la semaine cible. Une place active libre évite une coupe inutile. Une transaction ne doit pas créer un nouveau slot vide.

Le moteur choisit le meilleur score d’utilité parmi les transactions complètement couvertes : gain net total moins les pénalités de préférence explicitement configurées (zéro sans préférence). Il expose trois alternatives de coupe avec leurs deltas hebdomadaires. Les options individuelles restent des **scénarios alternatifs** ; deux claims utilisant la même coupe ne peuvent pas être exécutés ensemble. Un plan conditionnel distinct recalcule maintenant les étapes, affecte des coupes distinctes et réserve les enchères. Voir la section plan ci-dessous.

- `targetWeekDelta` : variation de la meilleure lineup cette semaine après la transaction.
- `weeklyLineupDeltas` : semaine, slot où le candidat entre, totaux avant/après, delta, couverture.
- `horizonWeeks` : durée valorisée du rôle, bornée à la saison régulière restante.
- `grossGainTotal` : somme des deltas sur cet horizon.
- `dropCostTotal` : prime d’option estimée du joueur coupé, sur **le même horizon**.
- `postRoleCutCostTotal` / `postRoleCutDeltas` : production de lineup perdue du fait de la coupe permanente, après la fin du rôle ; aucun gain positif de location n’est prolongé.
- `netGainTotal = grossGainTotal − dropCostTotal − postRoleCutCostTotal`.
- `grossGainAverage` / `netGainAverage` : moyennes sur le rôle.
- `netGainPerWeek` : champ historique de compatibilité, moyenne sur `netGainRosWeeks` (ROS restant). Ne pas le lire comme delta S4.

La perte de production après coupe est déjà dans la lineup recalculée : elle n’est pas soustraite une seconde fois. Le surplus individuel au-dessus du remplacement reste un diagnostic dans les alternatives, pas une nouvelle pénalité. La contingence reste hors du gain de lineup (`contingencyValue=null`, non calibrée).

Une location confirmée d’une semaine à 17,2 contre 17,1 produit 0,1 brut total, avant coût d’option et perte éventuelle après rôle. Le scénario QB2 conserve le titulaire permanent si sa coupe détruirait la lineup après la location. Les gains reposent sur les projections de chaque semaine, sans recycler le maximum du rythme du rôle comme projection hebdomadaire. Bye connue = zéro justifié ; blessure officiellement bloquante cette semaine = zéro justifié. Toute autre projection manquante donne un delta/total `null`, un motif de couverture et aucune enchère proposée. Le contrôle de couverture est conservateur : il exige des données pour l’ensemble du pool comparé.

## Promotions et actions (DEC-04/06/08)

Blessure d’un joueur mieux classé, search rank, depth chart ou snaps ne constituent pas une confirmation de succession. Les événements détectés sont conditionnels jusqu’à preuve sourcée et non expirée. Pour un QB, `STARTING_QB` est requis ; deux confirmations contradictoires de titulaires dans la même équipe sont bloquées.

IR/ACL/Achilles ne confirme plus une saison terminée ni trois semaines de rôle. Sans confirmation, durée `UNCERTAIN`, scénario d’une semaine ; aucun demi-poids présenté comme probabilité. Le marché estimé utilise désormais `PROJECTION_WINDOW_V1` : ROS (ou repli par rang identifié), projection cible sur la fenêtre temporaire, sans maximum des scores récents, multiplicateur de partage supposé ou bonus de contingence. Les flags de promotion restent des pistes non confirmées ; ils ne garantissent pas un rôle ou un transfert des cibles.

`ADD_NOW` nécessite disponibilité immédiate vérifiée, éligibilité de semaine, transaction légale, couverture et rôle confirmé si promotion. `CLAIM_IF_CHEAP` correspond à un waiver futur confirmé avant kickoff. Petit gain gratuit insuffisant pour une action prioritaire : surveillance, sans faux claim futur. Les blocages sont exportés dans `actionBlockers`.

Enchère proposée, plafond personnel et fourchette de marché sont distincts. Plafond = minimum du FAAB restant, borne marché et utilité nette (`selectionScore`) × 3 $, arrondi vers le bas. Sans préférence, cette utilité correspond au bénéfice net total. L’enchère proposée vaut zéro en surveillance. Pourcentages du budget initial et restant sont séparés. `auctionWinProbability=null` ; Capture est une part de surplus, pas une probabilité de gagner. Ce plafond reste une estimation non calibrée.

`SELL_HIGH`/`BUY_LOW` sont des diagnostics de production versus xFP estimé ; ils ne déclenchent pas une coupe. Les textes le précisent. Les graphiques WOPR contradictoires ne sont pas ingérés : univers, période, filtres, couverture, version et source numérique doivent être résolus d’abord. WOPR n’est pas xFP et ne garantit pas un rebond. Routes absentes = n/d.

## Matchup et présentation (DEC-05)

Le dénominateur vient des neuf slots requis : huit joueurs projetés donnent **8/9**. Les slots vides, projections absentes et scores acquis sont distincts. Le total de projections d’avant-match reste étiqueté ainsi. `mixedTotal` additionne scores des matchs terminés et projections des matchs non commencés uniquement avec couverture complète. Pendant un match en cours, aucune projection restante fiable n’est disponible : total mixte `null`, sans réutiliser toute la projection pré-match en plus du score acquis. Aucun pourcentage de victoire n’est ajouté.

Waiver Wire affiche disponibilité/action, kickoff/waiver, delta cible, horizon, brut/net total, détail hebdomadaire et proposé/plafond. Le Coach et l’export IA conservent ces champs ; les valeurs absentes ne deviennent plus zéro. Le statut sans alerte plateforme ne constitue pas un certificat de santé.

## Validation et suites

Tests déterministes : Bills/Rams après kickoff ; propriétaire actuel ; preuve expirée/future/contredite ; chargement du JSON et récupération après fichier invalide ; EST/EDT ; DEF remplace NO ; location 0,1 sur une semaine ; propriété relue ; projection absente ; place libre ; titulaire verrouillé ; 8/9 ; score final nul et match live sans double comptage. Vérifier `npm test`, `npm run check`, `npm run assets:check` et l’UI dans un navigateur avec fixtures, sans annonces du futur.

Restent ouverts : calibration du marché/FAAB et de l’option du banc ; audit des heuristiques de détection des événements et des replis de projection ; collecte continue d’un historique réel, constitution d’un jeu d’évaluation historique réel et backtests ; provenance complète des faits NFL et validation des matchs partiels ; ingestion WOPR numérique. La collecte automatique de preuves privées Sleeper n’est pas incluse.

Vérification de livraison : 230 tests Node passent, contrôles statiques et versions d’assets validés ; capture
Playwright desktop/mobile dans `output/playwright/decision-waiver-{desktop,mobile}.png` (fixtures
explicites Bills/Saints, jamais données NFL actuelles). Le navigateur vérifie disponibilité,
kickoff/déblocage, delta +0,1, une semaine, enchère zéro et détail par semaine.

## Préférences temporaires de conservation — DEC-07

Le même fichier `DECISION_EVIDENCE_FILE` accepte `rosterPreferences` à la racine :

```json
"rosterPreferences": [{
  "playerId": "stable-sleeper-id",
  "rosterId": 1,
  "kind": "KEEP_UNTIL",
  "createdAt": "2026-10-05T09:00:00Z",
  "expiresAt": "2026-10-06T09:00:00Z",
  "penaltyPoints": 5,
  "reason": "Observer la continuité après S4"
}]
```

Exemple fictif : aucune préférence Raymond réelle n’est créée automatiquement à partir du backlog.
L’opérateur doit saisir une préférence explicitement demandée par le manager. La préférence
s’applique uniquement à son roster et à un joueur encore détenu. Source exportée :
`USER_PREFERENCE`. `revokedAt` non vide révoque la préférence ; supprimer l’entrée la révoque
également. Expiration, date future, roster différent ou structure invalide : entrée ignorée.
La portée ligue/saison/semaine du fichier reste vérifiée. Une injection programmatique peut
utiliser l’argument `rosterPreferences` de `getFreeAgents`.

`penaltyPoints` est une pénalité explicite d’utilité, bornée entre 0 et 100, pas une projection
fantasy ni un coefficient calibré. Aucun poids par défaut n’est inventé. Le moteur conserve
`netGainTotal` intact et classe les coupes selon `selectionScore = netGainTotal −
preferencePenaltyTotal`. Une préférence reste soft : une coupe peut être sélectionnée si son
utilité dépasse les alternatives. L’override, son motif et sa pénalité sont exportés et affichés.
Un score d’utilité nul/négatif ne justifie pas une action ou une enchère.

## Plan d’acquisition conditionnel — DEC-02/06

`acquisitionPlan` est distinct des listes de candidats classés par action. Sur les candidats
retenus dans le rapport (limites par poste appliquées), le moteur glouton construit jusqu’à trois
étapes :

1. Vérifier disponibilité, rôle, couverture, légalité et utilité positive.
2. Choisir les actions immédiates d’abord, puis les waivers par date de traitement ; départager
   par gain marginal net d’utilité, puis identifiant stable.
3. Recalculer le roster après l’ajout et la coupe ; une acquisition déjà prévue est protégée.
   Consommer une place libre une seule fois, puis demander une nouvelle coupe.
4. Réserver l’intégralité de l’enchère proposée ; recalculer la suivante sur le budget restant.
5. Exporter les conflits des options initiales, les coupes distinctes, les budgets avant/après,
   les deltas et les hypothèses de succès précédents.

Le plan est une simulation de revue, pas un ordre de traitement garanti par Sleeper. Les étapes
supposent les succès précédents (`dependsOnPlayerIds`, `assumesPriorWins`) ; deux claims traités
au même instant peuvent avoir un résultat/ordre différent. Après chaque résultat réel, ou si une
transaction externe intervient, régénérer le rapport : ne pas suivre une étape périmée. Il n’y a
ni soumission automatique, ni estimation de probabilité de gagner, ni garantie d’optimalité.
`executionMode=REVALIDATE_AFTER_EACH_RESULT`, `conditional=true`, `optimalityGuaranteed=false`.
Les gains ne sont pas additionnés entre horizons différents comme une projection globale.

Waiver Wire affiche le plan, les conflits et les préférences ; le Coach utilise les étapes du
plan lorsqu’il existe, et les exports JSON/texte conservent les hypothèses. Les préférences
Trade Finder existantes sont distinctes : KEEP/SHOP/UNTOUCHABLE ne sont pas transformés en
préférences datées de coupe sans demande explicite.

Tests ajoutés : expiration/révocation/portée, conservation soft et override, budget réservé,
recalcul du deuxième gain, coupes distinctes, place libre consommée une seule fois, acquisition
précédente protégée, disponibilité inconnue et intégration complète dans `getFreeAgents`.

Validation du 05/10 : 230 tests réussis, `npm run check`, `npm run assets:check` et
`git diff --check` réussis. Affichage des préférences et du plan contrôlé dans un navigateur
sur desktop et mobile avec une fixture fictive (deux acquisitions, 27 $ réservés, coupes
distinctes et préférence dépassée). Aucun déploiement ni claim réel effectué.

## Audit du rythme marché — 05/10 (DEC-08)

Le maximum ROS/projection/points récents pouvait prolonger un match exceptionnel comme un
rythme de rôle. `effectivePpg` ne valorise plus les scores réalisés ni la part supposée des
successeurs. BREAKOUT et SEASON_LONG conservent la base ROS ; une location valorise la
projection cible dans sa fenêtre seulement, puis revient à ROS. Une durée sourcée peut
borner cette fenêtre. Les replis par rang restent explicités par `rosSource`.

`marketEstimate` et `marketMethod` sont exportés dans le rapport et le contexte IA : méthode
versionnée, scores récents et partage inféré non utilisés, contingence nulle, calibration non
acquise. Cela corrige le biais du rythme ; le score marché comporte encore un bonus diagnostic
BUY_LOW/SELL_HIGH et la conversion en dollars reste heuristique. Les données futures de ROS
et les replis de projection nécessitent encore un audit de couverture/provenance complet.

Validation : 231 tests passent, dont un spike de 40 points qui ne modifie pas le rythme ROS,
une location d’une semaine et une fenêtre confirmée de deux semaines. Contrôles statiques,
versions d’assets et diff réussis. Aucun changement de rendu ni déploiement pour cet audit.

## Provenance et diagnostics — 05/10 (DEC-08/10)

Chaque candidat et chaque joueur du roster possède une couverture par semaine : projection
AVAILABLE, PLAYER_MISSING, LOAD_FAILED ou KNOWN_BYE. Zéro numérique reste une projection
présente. Les URLs Sleeper, unités PPR et dates réelles des chargements en cache sont conservées.
La date du rapport ne remplace pas ces dates. `evaluatedCandidateCount` et
`returnedCandidateCount` distinguent le pool évalué du sous-ensemble retourné. La provenance
de l’index indique son chargement ou le repli catalogue ; Healthy reste un statut plateforme.

Usage : fenêtre des trois dernières semaines réputées terminées, taille d’échantillon,
semaines manquantes et absence de routes explicites. Un enregistrement de stats ne confirme
pas à lui seul la fin du match : `completionVerified=false`. Les candidats exportent aussi
`usageDiagnostic` : actual/xFP/écart sur une même fenêtre pondérée, poids 0,5/0,3/0,2,
coefficients de régression et méthode. Le trend mesure une variation de composite ×100,
pas des points de percentile Usage Score. La régression de volume ne mesure pas la qualité
exacte de chaque opportunité. Ces champs sont conservés dans le contexte IA JSON et texte.

Limites : couverture n’est pas calibration ; les chargements restent non atomiques. Les
matches partiels et la stabilité de rôle ne sont pas attestés automatiquement. Les replis
ROS et les données de faits NFL nécessitent encore un audit complet.

## Archive locale et audit hors réseau — 05/10 (P2)

À partir d’un rapport JSON déjà récupéré localement :

```sh
npm run decision:snapshot -- capture /chemin/rapport.json output/decision-snapshots/observation-unique.json
npm run decision:snapshot -- replay output/decision-snapshots/observation-unique.json 2026-10-05T12:00:00Z
```

Utiliser un nom unique par observation. Le fichier est privé (mode 0600), le dossier dédié
ignoré par Git et hors public/. Aucun fichier existant n’est remplacé. Version 1, portée
ligue/saison/semaine, heure d’archivage et hash SHA-256 du rapport sont conservés. Le hash
contrôle une altération accidentelle, pas l’authenticité d’une source. Les champs racine
étrangers au contrat sont exclus ; ne pas fournir de secrets dans les champs métier.

Le replay exige une date limite explicite et refuse les observations source, dates de
transaction ou génération postérieures à cette limite. Il ne consulte aucun réseau et
renvoie `executable=false` : ancienne recommandation à auditer, jamais nouvelle consigne.
L’heure d’archivage peut être ultérieure à l’observation ; elle ne certifie pas que le rapport
existait à cette date. Les délais futurs de kickoff/waiver sont des événements prévus, pas
des observations futures.

L’audit inclus compte les actions avec disponibilité/rôle/légalité/couverture incompatibles,
les coupes dupliquées et les plans dépassant le budget. Aucun taux n’est inventé sans action.
Il ne mesure ni performance fantasy, ni chance de gagner une enchère, ni regret réalisé.

L’archive **version 1** conserve les sorties et leur provenance, **pas tous les inputs bruts**. La version 2 ci-dessous ajoute les inputs de calcul.
Elle permet la relecture et l’audit opérationnel, pas encore le recalcul historique d’une
nouvelle version du modèle. Aucun historique réel n’a été fabriqué ; collecte de rapports réels,
inputs bruts, résultats indépendants et calibration restent à faire.

Validation locale : 237 tests, dont intégration de provenance, persistance immutable,
altération du hash, observations/transactions futures et actions inexécutables. Parcours CLI
capture→replay vérifié sur fixture fictive. Aucun déploiement ni écriture en production.

## Snapshot de calcul version 2 — 05/10

La collecte CLI locale peut maintenant archiver les inputs avec les sorties :

```sh
npm run decision:snapshot -- collect t0z output/decision-snapshots/observation-unique-v2.json
npm run decision:snapshot -- recompute output/decision-snapshots/observation-unique-v2.json ISO_CUTOFF
```

`collect` lit les sources via le même chemin que le rapport et sauvegarde localement ; aucun
claim, déploiement ou écriture Supabase. Cette commande n’a pas été exécutée sur les sources
réelles pendant la validation. L’API publique ne reçoit pas les inputs bruts : capture possible
uniquement via la CLI ou le callback programmatique `onDecisionInputs` de `getFreeAgents`.

La version 2 conserve les projections, statistiques, index joueurs, calendrier, rosters,
utilisateurs, catalogue, état NFL, transactions et preuves opérateur utilisés. Elle conserve
également les features de marché, disponibilités résolues et inputs du fit : rythmes par
joueur/semaine, protections, slots gelés, préférences et budget. Les dates source/cache et la
date de capture sont contrôlées par le cutoff. Le dump peut être volumineux et contient des
identifiants privés : le conserver dans le dossier ignoré, hors public/.

`recompute` utilise le même évaluateur pur que le rapport live pour recalculer marché,
scénarios ajout–coupe, horizons/coûts, enchères/actions et plan conditionnel. Aucune source
live ni fichier de preuves actuel n’est relu. Deux hashes contrôlent rapport et inputs ; une
empreinte des fichiers du modèle et des réglages empêche de présenter silencieusement le
résultat d’une autre version comme une reproduction exacte. `sameModel` et `sameOutput`
exposent les comparaisons. Le hash n’est pas une signature d’authenticité.

En programmation, `allowModelChange=true` autorise une comparaison explicitement marquée,
pas une reproduction garantie. La CLI stricte refuse un modèle différent. Les archives V1
restent lisibles avec `replay`, mais sont refusées par `recompute` faute d’inputs.

**Limite de la première livraison V2, levée pour les nouveaux inputs version 2 ci-dessous** : détection d’événements, extraction usage/xFP et features ROS restent
figées dans `marketRows`. Les données brutes sont conservées, mais leur nouvelle extraction
n’est pas encore raccordée au replay (`featureExtractionRecomputed=false`). Cela permet
les audits de marché/fit/décisions, pas encore un backtest intégral d’une nouvelle formule
usage ou d’une nouvelle détection de promotion. L’historique réel et la calibration restent
ouverts ; aucune observation rétroactive n’est fabriquée.

Validation : 239 tests passent. Recalcul identique des candidats et du plan, couverture
incomplète conservée, refus des inputs altérés/futurs et du modèle différent, sauvegarde V2
puis recalcul CLI dans un processus séparé. Contrôles statiques et versions d’assets réussis.

## Replay des features depuis les sources — 05/10

Les nouvelles captures conservent des **inputs version 2** (`featureExtractionVersion=1`).
Le replay exécute désormais la même extraction pure que le rapport live : statistiques →
usage/xFP/signaux → ROS → événements et confirmations de rôle → rythme marché. Les disponibilités
sont résolues depuis propriété, transactions, calendrier et preuves archivés, à la date de
la décision, jamais à la date actuelle.

Le roster est reconstruit depuis les sources archivées : joueurs, projections, réserves,
verrouillages, slots gelés, budget et préférences normalisées. Les niveaux de remplacement
sont recalculés sur le marché réextrait. Modifier les anciennes features ou contraintes
calculées ne modifie plus artificiellement le résultat : elles ne servent pas de source de
vérité au nouveau replay.

`featureExtractionRecomputed=true` distingue ce parcours. Les anciens inputs version 1 restent
compatibles en recalcul dérivé (`false`) ; les archives sans inputs restent en relecture simple.
La comparaison à une autre version du modèle demeure explicite. Les futures dates de sources,
transactions et capture restent refusées avant tout calcul.

Limites : aucune ancienne preuve absente n’est reconstruite ; les données de source peuvent
être incomplètes ou les matches partiels non vérifiés. Les préférences capturées sont celles
valides lors de la collecte, pas l’historique de toutes leurs modifications. Les résultats
réalisés, la validité réelle des actions à leur exécution et la calibration demandent encore
un historique indépendant. Ce raccordement ne prouve pas une amélioration prédictive.

Validation : **241 tests passent**. Reproduction exacte puis variations contrôlées des stats,
projections, confirmations de rôle, propriétaire et budget ; anciennes features altérées
ignorées ; parcours archive→recalcul CLI conservé. Aucun déploiement ou claim réel.

## Évaluation rétrospective indépendante — 05/10 (P2)

La commande locale évalue un snapshot intact et un fichier de résultats **séparé** :

```sh
npm run decision:evaluate -- SNAPSHOT.json OUTCOMES.json DECISION_CUTOFF EVALUATED_AT
```

Contrat des résultats V1 (exemple entièrement fictif) :

```json
{
  "version": 1,
  "leagueId": "fixture",
  "season": "2026",
  "snapshotHash": "hash-exact-du-rapport",
  "observations": [{
    "kind": "ACTUAL_POINTS",
    "playerId": "fixture-player",
    "source": "https://example.com/verified-final-score",
    "observedAt": "2026-10-11T21:05:00Z",
    "week": 5,
    "unit": "PPR_POINTS",
    "points": 0,
    "gameCompleted": true,
    "kickoffAt": "2026-10-11T17:00:00Z",
    "finishedAt": "2026-10-11T21:00:00Z"
  }]
}
```

Trois types sont acceptés :

- `ACTUAL_POINTS` : champs ci-dessus, score PPR final explicitement confirmé. Une projection
  datée avant kickoff doit être archivée ; zéro réel compte, absence de valeur ne compte pas.
- `WINNING_CLAIM` : playerId, source, observedAt, transactionId, processedAt, week, bid entier
  positif ou zéro, status=complete. Semaine égale à celle du snapshot, traitement postérieur
  au cutoff. Comparaison au marché du candidat retourné, jamais au plafond personnel.
- `ACTION_CHECK` : playerId, source, observedAt, checkedAt, executable booléen, reason facultatif.
  Mesure une vérification opérationnelle explicitement sourcée d’une action recommandée,
  pas une disponibilité déduite du score ou d’une acquisition réussie.

Le fichier est lié au hash exact du rapport, à sa ligue et sa saison. Observations futures
par rapport à evaluatedAt, événements antérieurs au cutoff, matchs non terminés, unités ou
valeurs manquantes sont exclus avec motifs. Une copie du même résultat ne gonfle pas le n ;
des valeurs contradictoires pour une même observation sont écartées jusqu’à résolution.
Les sources et dates des observations retenues restent dans le résultat.

Mesures : MAE et biais (`prévu − réel`) des projections brutes Sleeper, par horizon ; validité
observée des contrôles d’action ; fourchette marché versus enchère gagnée, par poste/durée.
Les univers sont déclarés : joueurs avec projection datée et score final appariés ; candidats
retournés avec enchère gagnée appariée. Le nombre de contrôles n’est pas un nombre de joueurs.
Sans observation, métriques nulles. Les marchés avec moins de 20 claims appariés par groupe
sont signalés INSUFFICIENT_SAMPLE ; au-delà, statut descriptif, pas preuve de calibration.

Aucune probabilité de gagner n’est déduite des seuls gagnants (`WINNING_BIDS_ONLY`). Aucun
paramètre n’est changé. Le regret réalisé des coupes et le taux de fausses alertes de rôle
restent n/d : ils nécessitent des observations d’exécution/rôle et un contrefactuel défini.
L’évaluation n’alimente jamais les inputs de calcul. Les fichiers de résultats restent locaux,
hors public/, dans `output/decision-outcomes/` ignoré par Git si ce dossier est utilisé.

Validation : 247 tests passent, dont parcours fichiers→CLI, zéro réel, séparation des mesures,
scope/hash incorrects, futur, matchs partiels, doublons et conflits. Tests uniquement sur
fixtures fictives ; aucun résultat réel ni calibrage n’a été fabriqué.

## Première observation réelle de décision

Capture locale du **05/10/2026 à 08:00:19 UTC**, équipe t0z, semaine cible 4. Archive privée :
`output/decision-snapshots/2026-10-05-initial-t0z.json`. Projections chargées 11/11, stats 3/3,
60 candidats retournés. Recalcul intégral hors réseau : sameModel=true, sameOutput=true,
featureExtractionRecomputed=true. Aucune action ADD_NOW/CLAIM_IF_CHEAP : preuves opérateur
non configurées ; les lectures propriété/transactions restent non atomiques.

Cette capture est une observation du lundi, **pas un snapshot pré-match du dimanche ni du
mardi pré-waivers**. Les projections dont le kickoff précède le cutoff seront refusées pour
l’évaluation pré-match. La collecte future doit conserver de nouvelles observations uniques
avant leurs événements cibles. Aucun résultat ultérieur n’a été enregistré dans cette archive.
Aucun déploiement, claim ou écriture Supabase effectué.

## Retour complémentaire — moteur playoffs, invariant et journal (05/10)

### Réutilisation playoffs

Le serveur Context/Coach réutilise `simulatePlayoffProbabilities`, le moteur existant dans
`public/assets/playoff-probabilities.js`. La préparation des données est désormais partagée
avec Classements/Power Rankings via `public/assets/playoff-context.js` ; aucun second moteur
ni changement de Playoff Race arithmétique. Le pont serveur lit uniquement les sources publiques.

`strategyState.playoffContext` et `teamState.playoffContext` exposent ready/reason, probabilité
0–1, couverture directe %, date du modèle, simulations, seed, places, paramètres d’incertitude
et hypothèses. Gate de deux semaines terminées, saison régulière uniquement. Lineup ou calendrier
incomplet bloque le calcul ; une panne de source laisse la probabilité nulle sans bloquer le reste.
L’urgence reste une règle de standings explicitement distincte, pas un seuil d’odds non calibré.

Hypothèses : lineups actuelles figées, projections directes puis moyennes saison puis remplacement,
bruit hebdomadaire et erreur persistante de force. Les projections historiques rechargées ne sont
pas certifiées comme des archives pré-match : limite héritée du moteur, explicitée dans le contexte.
Date/sources du bloc playoffs peuvent différer du snapshot waiver ; aucune synchronisation atomique
n’est promise. Aucun pourcentage présenté comme officiel Sleeper.

### Invariant entre outils

`modelMetrics` est calculé une fois par l’évaluateur waiver et transmis sans recalcul à AI Context
puis Coach : marché, immédiat/stratégique, horizon, deltas, coûts, coupe, enchère, disponibilité et
rôle. `decisionScope` précise ligue/saison/roster/semaine/asOf. Test dédié avec gain non nul :
**même joueur + même roster + même snapshot + même horizon ⇒ mêmes métriques canoniques**.
Les champs de présentation peuvent être arrondis ; le bloc canonique reste identique. Les outils
peuvent sélectionner/ordonner des sous-ensembles différents : Coach synthétise les actions, AI
Context conserve les groupes. Des requêtes indépendantes peuvent avoir des scopes différents ;
ce test ne prétend pas les rendre atomiques. Les anciens rapports sans bloc canonique restent lisibles.

### Journal local

```sh
npm run decision:journal -- init SNAPSHOT.json output/decision-journals/UNIQUE ISO_CUTOFF
npm run decision:journal -- record output/decision-journals/UNIQUE EVENT.json
npm run decision:journal -- show output/decision-journals/UNIQUE
```

Identifiants stables : hash du snapshot + semaine + playerId. Recommandations immutables,
version/fingerprint du modèle, action, classe, coupe et enchère proposées, métriques et indicateur
pré-match. WATCH et IGNORE sont conservés autant que les acquisitions. La recommandation émise
n’est jamais remplacée par le choix utilisateur. Ce dernier et sa raison restent null tant qu’un
événement CHOICE explicite ne les fournit (ADD/CLAIM/SKIP/KEEP/WATCH/IGNORE).

Exemple fictif de fichier événement :

```json
{
  "kind": "CHOICE",
  "decisionId": "identifiant-exact-du-journal",
  "decision": "SKIP",
  "reason": "Coût d’opportunité"
}
```

Un événement OUTCOME porte outcome.windowWeeks=2 ou 4, throughWeek, windowCompleted=true,
source, observedAt et summary. Il exige une fenêtre explicitement terminée et une observation
postérieure à la recommandation, non future à l’enregistrement. Ces bilans sont des observations
opérateur identifiées comme telles, pas un regret automatiquement calculé. Chaque événement
est un fichier privé unique ; aucune réécriture de la recommandation ni perte de l’historique
lorsqu’un choix/bilan ultérieur remplace sa vue courante. Dossier ignoré par Git, hors public/.

`decision:evaluate` fournit aussi des fenêtres descriptives 2/4 semaines pour toutes les
recommandations, y compris WATCH/IGNORE, même sans acquisition. Couverture et score total
observé sont explicites ; fenêtre partielle ne devient pas complète et donnée absente ne devient
pas zéro. Les byes sans observation explicite restent manquantes. Points obtenus ne prouvent
pas que la recommandation était bonne ; regret transactionnel et calibration restent séparés.

Journal réel initialisé pour le snapshot du 05/10 : **60 recommandations**, aucun choix ni résultat
inventé. Observation du lundi conservée comme telle, jamais renommée pré-match dimanche. Le journal
conserve la version initiale du snapshot même si le code a évolué depuis ; le recalcul strict de cette
ancienne archive demandera sa version de modèle, ou une comparaison explicitement autorisée.

Validation : **255 tests passent** ; invariant, journal/persistance, fenêtres WATCH/IGNORE, moteur
playoffs existant, couverture dégradée et API Context/Coach. Imports et rendu Power Rankings contrôlés
en navigateur avec sources fictives/dégradées ; contrôles statiques et assets réussis. Aucun déploiement.

## Validation des univers WOPR — 05/10 (DEC-09)

Deux commandes locales avant toute intégration :

```sh
npm run wopr:validate -- NUMERIC.json ISO_ASOF
npm run wopr:compare -- LEFT.json RIGHT.json ISO_ASOF
```

Le JSON normalisé décrit une source numérique JSON/CSV/Parquet, dataset/version/lineage,
dates de lecture et dataThrough, saison régulière et semaines complètes, formule/agrégation,
unités, namespace d’identifiants, positions et seuil de cibles, liste attendue de joueurs,
lignes numériques et moyennes annoncées. Le titre du graphique ne constitue pas le contrat.
Exemple **fictif** exécutable : [wopr-evidence.fixture.json](examples/wopr-evidence.fixture.json).
`isSynthetic=true` marque une validation de démonstration, jamais une preuve de production.

Définition acceptée : `1.5 × targetShare + 0.7 × airYardsShare`, selon le
[dictionnaire primaire nflfastR](https://nflfastr.com/reference/nfl_stats_variables.html).
Agrégation explicite : ratios des totaux sur la période ; une moyenne des WOPR hebdomadaires
n’est pas silencieusement assimilée à ce calcul. Cibles, air yards et dénominateurs équipe
absolus vérifient parts et formule (tolérance 10⁻⁶). PPR en total de période, jamais pts/match
interchangeables. Les air yards peuvent être négatifs ; parts/WOPR ne sont pas bornés à 0–1.
Dénominateur air yards non positif : non accepté par cette version, aucune imputation.

La couverture attendue est comparée aux IDs présents, et les moyennes numériques recalculées
aux moyennes annoncées (tolérances d’affichage 0,051 PPR et 0,0051 WOPR). Un JSN présent dans
une seule version, des unités différentes ou des moyennes incompatibles déclenchent HOLD.
Les mêmes données sous deux graphiques d’un même lineage ne comptent pas deux validations
indépendantes. Une nouvelle version/un nouvel univers demande réconciliation explicite.
L’ordre des lignes et clés JSON ne sert pas de preuve d’un nouvel univers.

Routes = null si non fournies ; une valeur exige une source propre, jamais un remplacement
par snap share. Namespace GSIS reste GSIS, sans rapprochement inventé avec Sleeper. Une absence
hors filtre ne prouve pas zéro rôle. Univers incomplet/non attesté, semaines live, source future,
image seule et données de formule incompatibles sont bloqués. La CLI retourne code 2 pour
une validation/compatibilité refusée et conserve les motifs. Elle ne modifie ni données sources
ni paramètres du modèle. WOPR reste opportunité relative, pas xFP ou probabilité de rebond.

**Ce qui est livré** : garde de validation/comparaison numérique, pas ingestion automatique dans
le modèle (`modelIntegrationEnabled=false`). **Ce qui manque encore** : fichiers numériques réels
correspondant aux deux graphiques et définition de leur univers par le fournisseur. Aucune valeur
n’est extraite à l’œil ni aucune version choisie arbitrairement. La complétude/source déclarée
est contrôlée structurellement, pas certifiée par un accès externe au fournisseur.

Validation : **262 tests passent**, dont fixture numérique, JSN absent/moyennes différentes,
unités en %, routes sans source, semaines live/futures, sources image, volumes négatifs/zéro,
dédoublonnage logique et CLI. Contrôles statiques et versions d’assets réussis. Aucun déploiement.

### Audit du coût des agents libres — 5 octobre 2026

Défaut reproduit : un agent libre `ADD_NOW` portait une enchère proposée de 40, confondant plafond personnel et coût opérationnel. Correction dans l’évaluateur commun : enchère proposée = 0 pour `ADD_NOW`, plafond personnel conservé ; `CLAIM_IF_CHEAP` conserve son enchère. Le plan ne réserve aucun FAAB pour un ajout libre et refuse une action libre incohérente portant une enchère positive. Coach, Waiver et AI Context conservent les mêmes métriques canoniques. Tests : reproduction avant correction, invariant inter-outils et absence de consommation du budget dans un plan de deux ajouts libres. Aucun déploiement.

Validation finale avant commit : **263 tests passent**, contrôles statiques et versions des 39 assets à jour, `git diff --check` sans erreur. Les snapshots, journaux privés et fichiers d’environnement restent ignorés par Git. Aucun déploiement.

### Horizons des acquisitions successives — 5 octobre 2026

Le plan conditionnel conserve maintenant la fenêtre de rôle évaluée pour chaque acquisition supposée réussie. Si un calcul ultérieur utilise ce joueur après cette fenêtre, son gain reste inconnu et le scénario est bloqué (`UNCONFIRMED_PRIOR_ACQUISITION_ROLE_WEEK_N`). Cela couvre aussi le coût permanent des coupes après le rôle du deuxième ajout. Aucune projection zéro ni prolongation du rôle n’est inventée ; cette règle conservatrice peut raccourcir un plan même si le joueur resterait utile après son rôle temporaire. Une nouvelle évaluation sur un snapshot actualisé reste nécessaire. Les plans couvrant des rôles sur toute la période restent disponibles.

Validation : reproduction du défaut avant correction, propagation de la fenêtre entre étapes, régressions budget/coupes distinctes/place libre ; **265 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### Durée confirmée commune au marché et au roster — 5 octobre 2026

Une durée de rôle provenant d’une preuve actuelle et confirmée prend désormais priorité sur les étiquettes heuristiques `BREAKOUT`, `SEASON_LONG` et sur l’absence d’événement détecté. L’estimation marché utilise cette fenêtre explicite, plafonnée aux semaines de saison régulière restantes ; le scénario ajout–coupe reçoit exactement la même durée normalisée. `marketEstimate.roleWindowSource` distingue la preuve confirmée du repli heuristique/ROS. Sans preuve valide, les règles ROS et locations existantes restent applicables. Cette durée ne constitue pas une garantie de production ; le mélange de projections reste une estimation non calibrée.

Validation : défaut reproduit avant correction, quatre étiquettes testées et plafonnement en S14, rejeu hors ligne et conflits QB préservés ; **266 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### FAAB inconnu — 5 octobre 2026

Un solde FAAB absent ou invalide reste `null` dans les plans conditionnels (`budgetKnown=false`, `UNKNOWN_FAAB_BALANCE`). Pour un scénario légal et couvert, le plafond personnel reste inconnu ; une enchère passe en `WATCH` avec ce motif. Un scénario inexécutable garde son plafond de zéro. Les ajouts libres vérifiés à coût zéro restent possibles et ne transforment pas le solde inconnu en zéro. Les champs budgetBefore/budgetAfter restent null ; reservedFaab=0 décrit uniquement les fonds réservés par ce plan. La convention Sleeper existante « waiver_budget_used absent = zéro dépensé » reste distincte de ce contrôle sur un solde explicitement inconnu.

Validation : reproduction du plafond inventé, ajout gratuit avec solde inconnu, blocage de claim et régressions scénarios inexécutables ; **268 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### Ordre et ambiguïtés du journal — 5 octobre 2026

Le journal trie désormais les événements par instant réel (timestamps normalisés), et non par chaîne de caractères. Deux événements visant le même choix, ou le même résultat 2/4 semaines, au même instant font échouer la matérialisation explicitement ; aucun UUID aléatoire ne choisit un vainqueur. Des événements simultanés visant des décisions ou fenêtres différentes restent indépendants. Les UUID v4 et versions persistées sont validés, les identités dupliquées et horodatages absents/invalides sont rejetés. Les fichiers originaux restent inchangés. Ce contrôle à la lecture détecte les conflits, y compris ceux issus d’écritures concurrentes ; il ne constitue pas un verrou transactionnel d’écriture. Pour résoudre une ambiguïté, conserver les preuves originales et réconcilier explicitement les événements avant de produire une nouvelle vue.

Validation : deux défauts reproduits avant correction (fuseaux différents et simultanéité), événements dupliqués et incomplets, immutabilité des recommandations ; **270 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### 05/10 — Retour complémentaire : propagation du contexte live

Nouveau backlog priorisé : [transactions nominatives, couverture du pool, ripple, optionalité des coupes et GAME_LOCKED](decision-engine-live-state-backlog-2026-10-05.md). État existant distingué des travaux ouverts, exemples Week 4 à reconstruire depuis des snapshots sourcés. Les cases ouvertes ne sont pas des fonctionnalités livrées.
