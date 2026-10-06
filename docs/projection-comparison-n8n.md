# Comparaison Alexandria et consommation n8n

Livraison locale du 7 octobre 2026. Deux fournisseurs : Draft Sharks et CBS, WR/RB/TE, projections hebdomadaires PPR natives. Aucun déploiement ni changement de workflow n8n dans cette livraison.

## Collecte explicite

La CLI Firecrawl doit être installée et authentifiée sur le poste qui collecte. Aucun secret Firecrawl n’est exposé au serveur ou au navigateur. La commande envoie seulement poste/semaine/scoring, jamais le roster ou les préférences du manager.

```sh
npm run projections:collect -- 2026 5 WR output/projection-comparisons/w05-wr.json
```

Saison, semaine, poste et destination sont obligatoires. Une capture contient une position et les deux fournisseurs ; pas de collecte des six fournisseurs ni de pagination automatique. Budget annoncé par les contrats inspectés : deux appels de cinq crédits. Les échecs internes Alexandria sont conservés comme `COLLECTION_FAILED`, même si l’enveloppe HTTP est réussie. Une capture partielle est utilisable source par source ; une capture entièrement échouée produit un code de sortie non nul.

Le fichier est privé (0600), ignoré par Git, immuable : destination existante refusée avant les appels externes. Choisir un nouveau nom pour chaque collecte. La capture conserve les réponses originales, les paramètres, les dates de récupération, IDs de scrape et crédits déclarés. Elle ne certifie pas à elle seule la comparabilité ni une observation avant match.

## Lecture côté serveur

Configurer explicitement `PROJECTION_COMPARISON_FILE` vers la capture locale choisie. Aucun paramètre HTTP ne permet de choisir ce chemin. Sans configuration, `NOT_CONFIGURED`, pas de section supplémentaire dans le message. Les requêtes HTTP lisent le fichier : aucun appel Firecrawl, aucune collecte récurrente et aucun abonnement ajouté.

Le validateur contrôle :

- même saison, semaine explicite, poste, PPR et type hebdomadaire ; superflex désactivé chez Draft Sharks ;
- domaine fournisseur attendu, source identifiée sans doublon ;
- capture, récupération, observation source et publication lorsqu’elle est fournie : dates valides, antérieures au calcul et âgées au maximum de 24 heures ; absence de date de publication conservée comme inconnue ;
- identité unique : nom exact normalisé, équipe et poste dans l’index Sleeper. Seules les équivalences JAC/JAX, LVR/LV et WSH/WAS sont appliquées. IDs fournisseurs conservés dans leur namespace, jamais utilisés comme IDs Sleeper ;
- existence et kickoff futur du match cible ; adversaire confronté au calendrier lorsqu’il est fourni. CBS sans adversaire indique seulement `TEAM_GAME_MATCHED_OPPONENT_UNSPECIFIED` ;
- valeurs numériques, exclusion des identités ambiguës, doublons et lignes mal formées.

Les lignes rejetées et la couverture sont visibles par fournisseur. Un tableau tronqué reste `PARTIAL` ; `RETURNED_TABLE_ONLY` signifie seulement que toutes les lignes annoncées du tableau ont été reçues, pas que toute la ligue est couverte. Les deux fournisseurs ne couvrent pas nécessairement les mêmes joueurs.

## Contrat Context / Coach / n8n

`projectionComparison` est partagé dans le JSON Waiver, `/api/context?mode=decision` et `/api/coach`. États : `NOT_CONFIGURED`, `HELD`, `CONTEXT_ONLY`. Champs : `season`, `week`, `capturedAt`, `sources`, `rows`, `issues`, `changesDecisionModel:false`, `scoringCompatibility:PPR_LABEL_ONLY_UNVERIFIED_RULES`.

Chaque ligne relie `playerId` Sleeper à `values` par fournisseur : points natifs, champ d’origine, ID fournisseur, méthode d’identité, contrôle calendrier, URL et dates. `spread` est l’écart max–min des sources disponibles sur cette ligne, `null` avec une seule source. Aucun score de confiance, moyenne de remplacement, probabilité ou gain Adineu n’est calculé. Les barèmes détaillés ne sont pas certifiés par le seul label PPR. Seul `projected_points` Draft Sharks est retenu : son consensus externe et sa projection 3D ne sont pas deux avis supplémentaires.

Le champ `message` Coach contient jusqu’à trois joueurs mentionnés dans les scénarios lineup/waiver, avec couverture et réserves explicites. n8n peut continuer à transmettre ce champ ou utiliser `projectionComparison` dans une branche dédiée. Une comparaison retenue affiche une indisponibilité ; elle ne transforme pas un rapport Adineu cohérent en rapport non publiable. Le refus existant `409 REPORT_NOT_PUBLISHABLE` reste applicable aux incohérences du moteur ; ne pas contourner son routage.

Aucune activation sur le serveur existant n’a été effectuée. Aucun message Telegram envoyé. La configuration et la collecte planifiée attendent la reprise autorisée des opérations de déploiement ; le job hebdomadaire d’évaluation du modèle reste inchangé.

## Archives et validation

Les snapshots conservent le rapport et les réponses brutes ; le rejeu recalcule la comparaison sans réseau. Les dates externes entrent dans le refus d’observations postérieures au cutoff. Les archives antérieures sans comparaison conservent leur contrat de comparaison. Tests : périodes/scoring incohérents, fraîcheur, kickoff, adversaire, identité ambiguë, source/lignes dupliquées, panne interne, fichier absent, capture privée immuable, parité Waiver/Context/Coach et stabilité des décisions avec/sans comparaison.

Pilote réel : deux appels WR S5, dix crédits déclarés. Draft Sharks : 100/122 lignes, 91 rapprochées ; CBS : 100/100 lignes du tableau, 95 rapprochées. 109 joueurs uniques validés, dont 77 avec deux valeurs. Neuf lignes Draft Sharks et cinq CBS exclues pour identité non vérifiée ; aucun rapprochement approximatif ajouté. Dates sources conservées du 6 octobre au soir ; ce pilote expirera après 24 heures, aucune fraîcheur durable promise. Capture privée : `output/projection-comparisons/pilot-w05-wr.json`.

Prochaines étapes : confirmer les barèmes détaillés, élargir explicitement à RB/TE, puis mesurer l’apport sur cohortes communes de snapshots réellement pré-match. Les groupes de claims alternatifs, les promotions confirmées et le coût permanent de coupe restent indépendants de cette comparaison.
