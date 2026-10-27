# Approved in-season roadmap

## Priorité actuelle — ADINEU Quality & Consistency (26/10/2026)

Suivi Linear : [ADINEU — Quality & Consistency · P-DAK-18](https://linear.app/dakhine/project/adineu-quality-and-consistency-f2cd499a6e00), équipe Dakhine, en cours, jalons QC-01 / QC-02 / QC-03. Les correctifs locaux et les déploiements y restent distingués.

**Consolider l'existant avant de construire davantage.** Cette phase remplace
l'ordre des travaux annoncé précédemment : les correctifs de cohérence et de
temps effectif passent avant le scanner post-match et les nouvelles fonctionnalités.
[Audit intégré, preuves, lots et critères de réussite](quality-consistency-2026-10-26.md).

- [ ] **P0 QC-01 — Cohérence et exactitude opérationnelle** : premier incrément local
  vérifié (all-play lié aux rosters de saison, noms canoniques/comptes dans les dossiers,
  horaire de waivers partagé et daté, DST testé). Restent déploiement, cohérence des
  autres pages/métriques, semaines affectables/IR/locks, horaires n8n et probabilités
  pré-match près des scores live. [Preuves et limites](quality-consistency-2026-10-26.md#qc-01--premier-incrément-local--all-play-et-horaires).
- [ ] **P1 QC-02 — Qualité des recommandations de trade** : équité marché, gains et
  crédibilité séparés ; « fiabilité du calcul » explicite ; trois à cinq meilleures
  offres au maximum, motifs adverses, coupes et scénarios. Comparaison avant/après
  sur Boukki et plusieurs rosters, sans changer arbitrairement les valeurs.
- [ ] **P1/P2 QC-03 — Décisions et feedback** : exécuter maintenant / préparer / surveiller,
  contrat de présentation commun Coach/Start-Sit/Waiver/IA, transactions nominatives,
  notifications utiles, journal à 2/4 semaines, mobile authentifié et exploitation.

Les observations publiques de l'audit sont datées et doivent être reproduites ;
les commits locaux `16732b6`, `2abe8d0`, `7fe3ff6` ne sont pas des preuves de correction
en production. Réconcilier les cases historiques et les preuves de livraison,
notamment le snapshot RB du 20/10 et les fuseaux n8n, avant de cocher.

Différés : SOS QB/TE, nouveau moteur de projection, nouveaux indicateurs de trade,
refonte frontend et multi-ligues. Préserver les calculs partagés, la War Room et
les snapshots existants. Pas de probabilité synthétique d'acceptation ; pas de
modification de coefficients motivée par une seule semaine décevante.

## Nouveau chantier — 26/10/2026 : pertinence des trades et décisions S8

Ordre d'exécution désormais subordonné à la phase Quality & Consistency ci-dessus.

Retour utilisateur enregistré ; TF-01 V1 et LI-01 V2 implémentés et vérifiés localement, non déployés.
[Lots, état existant et critères de réussite](prd-trade-decision-intelligence.md).

- [ ] P0 TF-01 — V1 locale : dominance, confiance de couverture, protection premium et gains significatifs ; trois vues. Restent provenance médicale/équipes datée, diagnostics globaux et validation mobile dédiée.
- [ ] P0 LI-01 — V2 locale : contexte enrichi des 12 rosters, packages du Finder et priorité poste/semaine enregistrée par roster dans le navigateur. API/exports paramétrables ; restent synchronisation privée des priorités, provenance détaillée et validation mobile dédiée.
- [ ] P0 WK-01 — gain de semaine cible explicite ajouté aux trades (projections publiées uniquement). Restent distinction complète semaine terminée/live/cible et scanner post-match au-delà du top par poste.
- [ ] P1 MV-01 — valeurs planchers, packages et coût de coupe/conservation/trade ; calibration historique séparant Yahoo et Sleeper.
- [ ] P1 WR-01 — enrichir la War Room et sortir trois décisions privées : ajouter, couper, proposer un trade.

Premier lot : TF-01, puis contexte de ligue et semaine cible. Les seuils 1,5/2 pts et
les poids du score proposés sont à tester, pas des paramètres déjà adoptés.
La préférence Boukki RB S8 est datée ; les exemples NFL joints restent à vérifier.
Conserver l'interdiction des probabilités synthétiques d'acceptation et des usages inventés.

## Triage du 18/10/2026 (semaine 6)

Source de vérité courte ; le détail historique suit plus bas. Un élément « livré » est en production sur `main`.

### Livré

| Chantier | Où | Reste ouvert |
| --- | --- | --- |
| SOS Explorer WR **et RB** | `/sos/?position=WR\|RB`, Coach, job du mardi | Premier snapshot RB au job du 20/10 ; contrôle visuel Coach authentifié |
| Tiers de valeur (affichage seul) | Trade Hub Waivers, Start/Sit, Classements | — |
| Contrôle avant verrouillage | `POST /api/coach/prelock`, n8n dimanche | Fuseau n8n (voir Ops) |
| Classements hebdo par poste + FLEX | Game Center `#rankings`, `GET /api/rankings` | Filtre « Mon équipe » vérifié en prod le 19/10 (roster t0z, 7 onglets, 390 px). Joueurs rostés au-delà des plafonds conservés (`beyondLimit`, rang réel) et visibles seulement dans « Mon équipe » (20/10) |
| Lisibilité mobile (390 px) | Toutes les routes publiques : 0 débordement, cibles ≥ 40 px | Coach authentifié non audité |
| Awards hebdo V1 + V1.1 + vue visiteurs | Récap Hebdo, accueil (`8f0be9a`, `b4e251c`) : MVP titulaires/banc par poste, efficacité de lineup après match | IR historique non fournie par Sleeper (documenté) |
| Probabilités de playoffs calibrées, Trade Finder (préférences, contre-offres), waiver v2, War Room, journal de décisions, modèle d’enchères FAAB | voir CLAUDE.md « Current State » | Calibration (ci-dessous) |

Les quatre branches `codex/*` du 07/10 sont fusionnées dans `main`.

### Priorités

Suivi daté (à cocher ici) :

- [x] 20/10 — job du mardi (08:00 UTC = 10:00 Paris) : snapshots S7 WR+RB et hebdo, recalibration FAAB, feedback S6. Évaluation SOS WR S6 : 28 matchs, MAE 8,5 pts PPR concédés contre 7,8 pour la base « moyenne ligue » (32,2) → skill −9,5 % (échantillon trop petit). `baselineMae` + `skill` ajoutés à l’évaluation (20/10) ; critère SOS QB = skill > 0 sur WR **et** RB avec n ≥ 100. Enchères S6 non notées par le modèle rival (`NO_ARCHIVED_MODEL` : snapshot S6 antérieur au modèle du 14/10) ; attendu dès S7.
- [x] 20/10 — awards S6 : 12 équipes couvertes, efficacité 84–100 %, 390 px sans débordement.
- [x] Utilisateur — fuseau Europe/Paris : mardi confirmé (exécution 08:00 UTC). Jeudi à confirmer le 22/10 (attendu 07:00 UTC).
- [ ] Après S8 (~03/11) — scorecard Adineu vs Sleeper, probabilité FAAB vs taux constant, verdicts du journal, échantillons des profils de rôle (20 fenêtres requises).
- [ ] Benchmark privé vs experts (option a, 20/10, [PRD](prd-expert-benchmark.md)) : livré (`6ad0ace`, n8n `pUUl9Ftq3OU4at8o`) ; FantasyPros seul (Draft Sharks/CBS si `FIRECRAWL_API_KEY`) ; première capture dimanche 25/10, premier score mardi 27/10, décision après 4 semaines.
- [ ] S8–S10 — décision SOS QB sur le feedback WR/RB.
- [ ] Utilisateur connecté — contrôle visuel Coach mobile/production.
- [ ] Après S17 — bilan de draft ; kit draft 2027.

1. **Ops — fuseau n8n.** L’instance est en UTC. Dimanche réglé (workflow en `America/New_York`, 18/10). Reste : mardi/jeudi tournent 2 h plus tard que prévu (1 h après le 25/10) — régler leur fuseau sur Europe/Paris dans l’UI n8n (Settings du workflow).
2. **Vérifier le job du mardi 20/10** : snapshots SOS WR + RB, recalibration FAAB, évaluation SOS S6 (0/386 observations le 16/10, faute de résultats).
3. **Mesurer avant d’ajouter.** Après S8 : scorecard Adineu vs Sleeper, probabilité de gain FAAB vs taux constant, verdicts du journal de décisions. N’ajuster un seuil que sur échantillon suffisant.
   - **SOS QB/TE (décidé le 19/10)** : pas avant preuve. Lire le feedback SOS WR/RB vers S8–S10 ; s’il bat une base simple, ajouter QB avec la même méthode (planifier le streaming ; 1QB, donc valeur ROS faible, matchup hebdo déjà couvert par la DvP Start/Sit).
4. **Contrôles visuels authentifiés** (Coach mobile et production) — nécessitent une session connectée.
5. **Hors saison** : bilan de draft (après S17), kit draft 2027 (valeur marché vs ADP, rareté par poste).

### Écarté

- Copier/afficher des classements payants externes (The Blueprint, etc.) : seuls les formats ont été repris (tiers, contrôle pré-verrouillage, classements hebdo). **Les confronter en privé à notre modèle n’est pas écarté** : voir benchmark experts ci-dessus.
- SOS TE : DvP TE dominée par quelques joueurs affrontés (bruit), TE titulaire fixe en ligue 12 — sauf feedback WR/RB exceptionnel.
- Probabilité d’acceptation synthétique d’un trade, statistiques d’usage inventées.

## Historique

## Fantasy SOS Explorer — WR temporel (15/10/2026)

**État : livré et poussé ; Explorer/API/archives contrôlés en production, première capture S6 conservée. Coach authentifié validé localement ; contrôle visuel authentifié de production restant.** Distinguer passé rétrospectif, futurs NEXT_3 / Fantasy ROS W14 / playoffs W15–17 / NFL ROS W18, et prévisions hebdomadaires figées évaluées après les matchs. Réutiliser DvP et nflverse, sans modifier projections ni décisions du Coach. Provenance DvP datée et identités historiques vérifiées ; suivi prospectif activable par le job existant.

[PRD, contrats, lots SOS-00 à SOS-07 et critères de livraison](prd-fantasy-sos-explorer.md).


## Nice-to-haves: weekly awards et notes de draft après saison

Ajout demandé le 07/10 : awards hebdomadaires et bilan de draft après saison, inspirés des captures Sleeper et des exports FantasyPros. Ajouter également une vue publique simple pour les visiteurs hors ligue, sans ouvrir le Coach privé ni transformer ADINEU en produit multi-ligues.

**État : V1 implémentée sur branche, non déployée.** Awards objectifs et all-play dans le récap ; accueil « Cette semaine dans ADINEU » avec résultats, bilan de saison et explications courtes. Tests et lecture live S4 validés ; validation visuelle desktop/mobile bloquée par accès localhost. Ensuite MVP/joueurs de banc et efficacité de lineup si la couverture permet le calcul. Notes de draft après fin de saison uniquement ; sur/sous-performance contre projection seulement avec snapshots réellement pré-match.

[Périmètre, formules, séparation public/privé et critères d'acceptation](prd-public-weekly-awards.md).

## Playoff probabilities — Power page

Activate only after two completed regular-season weeks with coverage for all 12 teams, reusing the Power Rankings activation gate. Keep the arithmetic Playoff Race separate and unchanged. Add a clearly labeled Adineu simulation estimate for each team's chance to finish in the eight playoff spots.

Simulate the official remaining Sleeper schedule through Week 14, using weekly team lineup projections where available, uncertainty calibrated from completed scores, and explicit fallback/coverage labels when future-week projections are absent. Do not reuse one week's projection as if it were a published future-week forecast. Apply confirmed standings tiebreak rules and exclude live results/playoffs. Use reproducible seeded simulations and report model date/coverage; probabilities are not official Sleeper data.

Evals: gate at week 1; incomplete coverage; exclude live week/playoffs; 12 teams/eight spots; probabilities sum approximately to eight spots; deterministic seeded results; confirmed qualification/elimination; missing projections and missing schedule suppress misleading precision.

## Trade Finder follow-up

Validate the bilateral-score and first-card before/after prototype before wider redesign. Next: client-side Keep/Shop/Untouchable preferences; then 2–3 neighboring counter-offer packages using the same bilateral score. Later: waiver opportunity cost, with verified FAAB settings and explicit incremental lineup gain. No synthetic acceptance percentage or invented usage statistics.

## Decision reliability — backlog du 04/10/2026

Livré localement : transactions fraîches et propriété relue, preuves serveur datées/expirantes,
kickoffs, scénarios complets ajout–coupe, horizon du rôle séparé du ROS, couverture 9 slots et
UI/exports explicites. Ajout du 05/10 : préférences temporaires soft et plan conditionnel multi-claims avec coupes distinctes et budget réservé. [Contrat et configuration](decision-reliability-2026-10-04.md).

À poursuivre : calibration marché/FAAB/options,
provenance détaillée, snapshots historiques et WOPR numérique avec univers confirmé. Ne pas
assimiler cette livraison à une collecte automatique des déblocages privés Sleeper.

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

### 05/10 — Retour complémentaire : propagation du contexte live

Nouveau backlog priorisé : [transactions nominatives, couverture du pool, ripple, optionalité des coupes et GAME_LOCKED](decision-engine-live-state-backlog-2026-10-05.md). État existant distingué des travaux ouverts, exemples Week 4 à reconstruire depuis des snapshots sourcés. Les cases ouvertes ne sont pas des fonctionnalités livrées.


### 07/10 — portefeuille de claims alternatifs

Livré localement : groupes de repli sur la même coupe/place et la même date, branches de succès/échec, budget et roster recalculés ; les acquisitions justifiant des coupes distinctes restent cumulables. Maximum des scénarios détaillés seulement avec couverture complète, limites explicites ; aucune annulation Sleeper supposée. Rendu Coach/n8n et export IA compact du plan. [Contrat et evals](conditional-claim-portfolio-2026-10-07.md). Prochains sujets du feedback DvP : utilité TE2, mouvements WR/FLEX couplés, diagnostics de projections manquantes ; prix spéculatif toujours à définir/calibrer.

### 07/10 — diagnostic TE supplémentaire

Livré localement : référence au slot TE, bye dans la durée du rôle, utilisation FLEX, coût de coupe et gain net ; absence de données et secours sur blessure restent explicites. Prochains chantiers : rotations WR/FLEX globales, diagnostic des projections manquantes, provenance compacte. Prix spéculatif à définir/calibrer. [Contrat et evals](te-roster-utility-2026-10-07.md).

### 07/10 — Rotations WR/FLEX explicites

Livré : les mouvements liés deviennent une décision avec gain total et affectations de slots dans Coach/n8n et AI Context. Optimisation inchangée, détail JSON préservé. [Contrat](lineup-rotations-2026-10-07.md). Prochain chantier : diagnostic des projections manquantes.

### 07/10 — Coach hebdomadaire : équipe et mouvements

Incrément local : vue comparative actuel/proposé, mouvements groupés par coupe, alertes et alternatives ; sélection des streamers par semaine cible partagée live/recompute. Diagnostics des projections du roster et signal de potentiel de coupe non chiffré. Valorisation/calibration de l'optionalité et provenance compacte restent ouvertes. Vérification de l'asset Coach de production seulement, sans assimilation à un audit de tout le serveur. [Backlog consolidé et limites](coach-weekly-board-2026-10-07.md).

### 07/10 — Livraison Coach vérifiée et export compact

PR #1 fusionnée ; les neuf empreintes de production correspondent au commit fusionné. Validation visuelle du roster privé encore ouverte (connexion requise). Incrément suivant : résumé de provenance borné, diagnostics candidats dans Coach/n8n, avertissement explicite sur le potentiel de coupe non valorisé. Chiffres et sélection inchangés ; calibration ouverte. [Contrat et preuve de livraison](decision-compact-provenance-2026-10-07.md).


### 26/10 — Mini StatTracker demandé pour le Game Center

Livré localement : classement provisoire selon les scores actuels, scénario distinct d’estimation de fin de semaine, détail titulaires/banc et scores NFL. Rafraîchissement toutes les 30 secondes. Estimation Adineu déterministe, non calibrée ; données insuffisantes signalées sans remplacement silencieux. [Contrat et vérifications](prd-live-standings.md). Vérification mobile 390 px et observation pendant un match NFL encore ouvertes. Aucun déploiement.

Le projet Linear Quality & Consistency existe ; la création du ticket de ce lot est bloquée par la limite gratuite d’issues du workspace. Le suivi reste conservé ici.


### 26/10 — QC-01 : simulations de trades et hypothèses IR

Lineups ROS explicitement simulées, hypothèses de retour datées et sourcées comme
hypothèses (projection future positive ou durée forfaitaire), y compris les joueurs
conservés. Zéro ou projection négative ne déclenche plus un retour. Disponibilité,
activation IR et délai du trade restent non confirmés. 616 tests réussis ; première
semaine réellement affectable encore ouverte. [Détail et limites](quality-consistency-2026-10-26.md).

### 26/10 — QC-01 : fenêtres conditionnelles des trades

Règles de revue/deadline lues dans Sleeper, kickoffs nflverse partagés avec le Finder,
les partenaires et les exports. Gain cible masqué lorsque l’optimisation avant match
suppose de recomposer une lineup dont la fenêtre est déjà dépassée. Prochaines semaines
candidates affichées sous hypothèse d’accord maintenant ; traitement exact et disponibilité
restent non confirmés. 620 tests réussis, cas Boukki S7 vérifié localement.
[Contrat et travaux restant ouverts](quality-consistency-2026-10-26.md).

### 27/10 — QC-01 : profondeur catalogue et identités du calendrier

Indicateur Équipe nommé selon sa base rang/ADP ; distinction explicite des valeurs
ROS live et des projections de semaine. Égalités conservées, plus de surplus/besoin
unique choisi arbitrairement. Calendrier : manager confirmé et compte Sleeper étiquetés
séparément, sans nouveaux rapprochements. 623 tests réussis.
[Détail et limites](quality-consistency-2026-10-26.md).

### 27/10 — QC-01 : garde de complétion après rollover

S7 entièrement à zéro reproduite dans la source publique. All-play et Power Rankings
suspendent la publication au lieu d’inventer des égalités ; semaines incomplètes,
absentes et dupliquées bloquées avec contrôle partagé. Zéros individuels et vraies
égalités préservés. 627 tests réussis ; aucune synchronisation de production lancée.
[Détail et limites de fraîcheur](quality-consistency-2026-10-26.md).


### 27/10 — QC-01 : audit public de synchronisation

Commande GET uniquement `npm run audit:sleeper-sync`. Capture 06:59 Paris : S1–S6
concordent, douze écarts S7, dernière écriture le 20/10. Le créneau mardi 08:00 UTC
reste à venir lors de cette capture ; aucune panne affirmée ni relance de production.
[Preuves et limites](quality-consistency-2026-10-26.md).

### 27/10 — Rattrapage S7 vérifié et début QC-02

Audit public 16:40 Paris : S1–S7 concordent avec Sleeper ; aucune relance de ce chat,
logs n8n toujours non inspectés. Recommandations : structure heuristique et fiabilité
du calcul distinguées de l’acceptation ; changements de titulaires adverses nommés.
Valeurs et seuils inchangés, 629 tests réussis. Revue multi-rosters et motifs complets
restent ouverts. [Preuves et limites](quality-consistency-2026-10-26.md).

### 27/10 — QC-02 : conséquences de roster et cinq offres principales

Coupes candidates des deux côtés, profondeur cédée nommée ; coupes requises en
À négocier, protection Keep/Untouchable respectée dans la qualification. Cinq offres
principales maximum, sans remplissage. Capture S8 des douze rosters : aucune offre
principale ; exemples Boukki/Estocade examinés avec leurs limites. 630 tests réussis.
[Détail de la revue](quality-consistency-2026-10-26.md).

### 27/10 — QC-02 : réserves réelles et candidats de coupe

Réserves/titulaires Sleeper transmis aux calculs de trades. Capacité basée sur les
réserves conservées valides, sans placement IR automatique d’un joueur reçu ; titulaires
déclarés exclus des candidats à la coupe. Source absente ou contradictoire explicitement
non vérifiée. 631 tests réussis ; locks de coupe et exécution restent ouverts.
[Preuves et limites](quality-consistency-2026-10-26.md).

### 27/10 — QC-02 : coupes et limites opérationnelles

Filtre prudent sur kickoff et mouvements désactivés ; candidats exclus traçables.
Avant-match ne vaut jamais autorisation de drop, AutoSubs et exécution restent à
vérifier. Capacité dépassée distinguée du blocage de trade : réduction nécessaire
pour modifier la lineup. 635 tests réussis. [Sources et limites](quality-consistency-2026-10-26.md).

### 28/10 — QC-03 : trois parcours Waiver Wire

Actions vérifiées, préparation avec confirmation et surveillance séparées à partir
du moteur existant. Rapport périmé/absent jamais promu en action maintenant ; aucun
bid ou gain recalculé. Tableau détaillé conservé, codes de disponibilité traduits.
Boukki S8 vérifié localement ; aucune acquisition exécutée.
[Contrat et limites](quality-consistency-2026-10-26.md).

### 28/10 — QC-03 : transactions nominatives du Waiver Wire

Joueurs et équipes lisibles, statuts demandé/terminé distincts, identifiants en détail.
Propriété actuelle séparée de l’événement historique ; aucune disponibilité libre
déduite d’une coupe. 642 tests réussis, aucune requête supplémentaire ni mouvement
exécuté. [Preuves et limites](quality-consistency-2026-10-26.md).
