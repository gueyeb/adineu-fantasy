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
