# Approved in-season roadmap

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
