# Firecrawl Alexandria Fantasy — inspection du 7 octobre 2026

Source : https://www.firecrawl.dev/alexandria/fantasy. Inspection avec le skill Firecrawl, scrape de la page et découverte des contrats via la CLI installée. Aucun outil fournisseur de projections exécuté, aucune intégration modèle ni accès au roster utilisateur.

## Offre observée

La page présente six fournisseurs : Draft Sharks, CBS Sports, FFToday, Fantasy Football Calculator, StartWho et FantasyData, avec comparaison des projections/rangs et dispersion des rangs. Elle annonce un cache partagé de 15 minutes. Ce cache n’atteste pas la fraîcheur de la publication fournisseur.

Dans le rendu extrait, le titre/prompt indique S4, des cartes indiquent S5 ; Allen apparaît face à NE dans un conseil et à LAR dans son en-tête. Cela peut venir du rendu/cache/exemple : cause non établie. Le consensus de cette page ne peut pas être utilisé comme snapshot hebdomadaire validé sans contrôler les réponses individuelles et le calendrier.

## Contrats effectivement inspectés

`draftsharks-com/fantasy-sports-rankings/weekly_rankings` : position obligatoire, scoring STD/HALF/PPR/TEP, semaine explicite possible, superflex ; IDs propres au fournisseur, équipe/adversaire, rang, points médians, plancher/plafond, consensus externe et projection 3D. L’exemple du contrat contient saison/semaine/source_url, observed_at_ms et last_updated_at. Une valeur d’exemple ne prouve pas le contenu ou la fraîcheur d’une future réponse.

`cbssports-com/fantasy-sports-rankings/projections` : position obligatoire, PPR/STD, type weekly/ros, semaine cible ; couverture hebdomadaire annoncée limitée à la semaine courante et suivante. Points et lignes statistiques projetées, IDs CBS, IDs de DEF absents. Pas de table half-PPR annoncée par ce contrat, même si l’interface agrégée offre HALF. Les deux contrats annoncent 5 crédits par exécution ; découverte inspectée à zéro crédit. Coût total d’une collecte à mesurer avant planification.

Les contrats sont paginés : vérifier couverture/continuation avant de présenter une moyenne comme complète. Le slug de page fantasy n’est pas un ID catalogue accepté par la CLI ; les IDs fournisseurs ci-dessus ont été obtenus depuis la page.

## Utilité pour Adineu

- Première cible : comparaison explicative des projections hebdomadaires WR/RB/TE, en particulier les choix proches. Conserver Sleeper comme source de propriété, roster, calendrier et état des transactions.
- Afficher les valeurs de chaque fournisseur et leur désaccord ; dispersion de rangs ou de projections n’est pas une incertitude probabiliste calibrée.
- Conserver projections hebdomadaires, ROS, actuals et rangs dans des dimensions distinctes. Comparer seulement même saison/semaine/scoring/poste et identités vérifiées.
- Tester ultérieurement l’apport sur snapshots pré-kickoff et cohortes communes avant de remplacer la projection actuelle.

## Contrat d’intégration proposé, non implémenté

Capture immuable : provider/capability, paramètres explicites, requestedWeek/returnedWeek, saison, scoring détaillé, source URL, fetchedAt/providerUpdatedAt, unité, namespace et mapping Sleeper, couverture/limites, champ exact utilisé. Refuser un calendrier ou une période contradictoires. PPR seul ne certifie pas tous les barèmes QB/K/DEF de la ligue ; recalculer depuis les statistiques lorsque possible et couvert.

Éviter de compter un consensus externe Draft Sharks comme une septième source indépendante aux côtés de fournisseurs qu’il peut déjà incorporer ; de même pour sa projection 3D composite. Les planchers/plafonds ne sont pas des percentiles connus sans définition fournisseur. Un accord d’experts ne confirme pas une promotion ou la disponibilité Sleeper.

Ces contrats de projections ne remplacent pas les preuves datées de blessures, depth-chart et déblocage individuel. Les groupes de claims alternatifs et le plafond spéculatif restent des chantiers du moteur distincts.

Preuves locales de cette inspection : /tmp/.firecrawl/firecrawl-fantasy.md, draftsharks-weekly-contract.json, cbs-projections-contract.json. Fichiers temporaires de découverte, sans credentials ; ne pas les utiliser comme source live ni comme archives pré-match certifiées. Aucun code modifié, aucun déploiement.
