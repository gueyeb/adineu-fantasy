# Messages n8n — contrôle du 6 octobre 2026

Les messages reçus constituent des exemples d’export, pas une preuve que la version locale est déployée. Aucun workflow n8n ni service de production n’a été modifié.

## Lecture du suivi S4

« 13 gagnées, 0 couvertes » : aucune enchère gagnante observée ne possède une prédiction correspondante dans le snapshot utilisé. Ce n’est pas un taux de réussite de zéro et cela ne permet pas de calibrer le FAAB. Il faut auditer la date du snapshot, sa couverture et la correspondance des IDs avant de conclure à un problème de prix.

MAE 4,55 à horizon zéro : erreur moyenne absolue sur l’échantillon indiqué, pas une probabilité de victoire ni une certification de capture pré-match. L’horodatage doit être vérifié pour exclure les observations postérieures au kickoff.

Buy-low/sell-high : comparaison descriptive de production avant/après pour les joueurs suivis. Pas de preuve causale ni garantie de rebond. SELL_HIGH ne signifie pas couper. Les données reçues ne suffisent pas à valider les hypothèses de calibration.

## Corrections locales Coach livrées

- WATCH expose les motifs de blocage en français, depuis les codes calculés conservés dans le JSON : projections incomplètes, disponibilité non vérifiée, promotion non confirmée, etc.
- Le rappel des claims concurrents n’apparaît que s’il existe plusieurs scénarios actionnables.
- Un plafond inconnu s’affiche n/d plutôt que zéro.
- Si un joueur à recevoir dans une proposition est déjà détenu selon le même contexte de roster, cette proposition est écartée et le signal TRADE_RECEIVE_ALREADY_OWNED est visible. La comparaison utilise Sleeper IDs, pas les noms. Une identité absente n’est pas devinée.

Le cas DJ Moore dans la lineup et dans le titre du trade nécessite encore de consulter la proposition directionnelle et le snapshot de production. Un titre seul ne prouve pas qu’il est à recevoir ; il pourrait être à donner. Le garde-fou couvre une contradiction d’identité démontrée, pas une interprétation du titre.

Les recommandations de lineup restent des projections et les alertes Questionable restent des statuts : ni garantie de participation ni approbation automatique d’une acquisition.

## Validation

291 tests passent dans l’état local actuel ; contrôles statiques et versions des 40 assets réussis. Le contrôle whitespace global signale une ligne vide finale préexistante dans decision-reliability-2026-10-04.md, hors changements de cette étape. Les modifications locales préexistantes des autres chantiers sont conservées, non incluses dans ce commit. Aucun push ni déploiement.

## Deuxième correction : couverture et décisions proches

Le suivi affiche maintenant couverture FAAB couverte/observée, « calibration indisponible » sans cas comparable, et les axes de diagnostic (IDs, date, pool, fenêtre). Des bornes de prix nulles, invalides ou inversées ne comptent pas comme couverture et ne contribuent pas au prix implicite par point. Les fourchettes zéro/zéro valides restent comparables.

Les projections sont étiquetées MAE ; le message rappelle que l’horizon zéro ne garantit pas une capture pré-match. Les signaux indiquent leur nature descriptive et l’horizon variable actuel, sans conclusion d’avantage. La ventilation par poste, les captures pré-match certifiées et les cohortes de référence à horizon fixe restent ouvertes.

Coach distingue compléter un slot vide, optimiser, et un choix proche quand le gain projeté est inférieur à 1 point. Ce seuil de rendu est une règle de prudence non calibrée, pas un intervalle statistique. Santé/rôle et disponibilité/verrouillage doivent être vérifiés ; le titulaire ne sert de repli que s’il reste disponible. Aucun statut de santé ou déblocage n’est inventé.

Validation : 293 tests passent, contrôles statiques et assets réussis. Les garde-fous de rendu ne remplacent pas les contrôles d’exécution. Restent à implémenter : certification des snapshots FAAB pré-waiver, évaluation buy-low/sell-high à horizon fixe et référence comparable, présentation ROS bilatérale/coût de coupe des trades, justification TE2 derrière McBride et validation des choix lineup par disponibilité réelle. Aucun déploiement.


## Comparaison externe locale — 7 octobre

Context et Coach exposent désormais `projectionComparison`, et le `message` Coach peut afficher les valeurs natives Draft Sharks/CBS pour les joueurs cités. Cache choisi via `PROJECTION_COMPARISON_FILE`, collecté explicitement hors requêtes HTTP ; pas de modification du suivi/calibration, du workflow ou de la production. Les données non validées sont retenues sans inventer une moyenne ou une recommandation. [Procédure, contrat et limites](projection-comparison-n8n.md).
