# Player intelligence — pilote n8n

Deux workflows importables, sans abonnement ajouté et sans notification envoyée :

- `workflows/n8n/player-status-collector.json` : contrôle horaire, téléchargement Sleeper plafonné côté serveur à un par 24 heures, puis recalcul du Coach seulement si les faits changent.
- `workflows/n8n/player-observations-webhook.json` : réception authentifiée d'observations normalisées, validation ADINEU, accusé de réception, puis recalcul si un fait confirmé change.

Ce pilote ne promet pas un flux d'actualités en temps réel : la collecte automatique initiale est quotidienne. L'entrée webhook est prête pour une saisie sourcée ou un collecteur externe. Aucun fournisseur payant, modèle d'extraction IA, flux RSS non vérifié ou scraping d'actualité n'est activé. Un article brut ne suffit pas à appeler une information CONFIRMED.

## Installation

1. Déployer le code serveur. Configurer `PLAYER_INTELLIGENCE_DIR` sur un volume persistant **hors de public/** (ex. `/data/player-intelligence`) et `PLAYER_INTELLIGENCE_TOKEN` avec un secret distinct des tokens Coach/model-job. Ne jamais mettre ces valeurs dans un workflow exporté ou un navigateur public.
2. Importer les deux JSON dans `https://n8n.bakene.tech/`. Ils sont inactifs par défaut ; leurs nœuds HTTP/webhook sont également désactivés et sans authentification sélectionnée pour éviter un rattachement automatique à un credential sans rapport. Configurer Header Auth, sélectionner les bons credentials, puis réactiver chaque nœud seulement après le déploiement. Sélectionner les credentials Header Auth : `ADINEU player intelligence` (`Authorization: Bearer <PLAYER_INTELLIGENCE_TOKEN>`) et `ADINEU Coach` (token Coach existant). Pour le webhook, sélectionner un credential distinct `ADINEU source webhook` : il authentifie les producteurs autorisés à publier des observations, et ne doit pas être distribué aux sources publiques.
3. Lancer manuellement le collecteur. Vérifier `COLLECTED`, la portée, les joueurs surveillés et la baseline. Un second appel doit retourner `DAILY_SOURCE_COOLDOWN`, sans retélécharger le catalogue. Le premier relevé alimente le modèle mais ne constitue pas une actualité sportive nouvellement publiée.
4. Renseigner `watchIds` avec des IDs Sleeper vérifiés. Le collecteur inclut le roster `t0z` et les joueurs de mêmes équipe NFL/poste pour suivre les remplaçants. Aucun changement de roster n'est exécuté. Un manager inconnu échoue explicitement.
5. Tester une observation réelle et datée dans le webhook. Vérifier l'ingestion, puis le nouveau delta Coach. En cas de `409 REPORT_NOT_PUBLISHABLE`, conserver l'erreur et ne pas transmettre de recommandation.
6. Publier les workflows après validation de la configuration. Le fuseau est `Europe/Paris`. Le nœud final permet l'inspection ; il n'envoie rien. Brancher ensuite le canal privé existant uniquement si son destinataire et son usage sont autorisés, et uniquement sur une modification de décision dans le delta Coach.

## Contrat HTTP

Tous les endpoints exigent `Authorization: Bearer <PLAYER_INTELLIGENCE_TOKEN>` ; le token Coach ne donne pas accès à l'écriture.

- `GET /api/player-intelligence` : portée courante et observations actives.
- `POST /api/player-intelligence/collect?team=t0z` : body `{"watchIds":[]}`. Portée NFL courante déterminée par Sleeper. Appel distant sous verrou, plafond persistant de 24 h, même après redémarrage.
- `POST /api/player-intelligence/ingest` : `{"observations":[...]}`, 1 à 100 observations, 128 Kio maximum. Le lot est validé intégralement avant écriture ; saison/ligue/semaine doivent correspondre au contexte courant. Aucun chemin de fichier ni URL de collecte n'est accepté du client.

Chaque observation comporte :

```json
{
  "leagueId": "1392715510830878721",
  "season": 2026,
  "targetWeek": 11,
  "playerId": "ID_SLEEPER_VERIFIE",
  "kind": "STATUS",
  "value": {"injuryStatus": "Out", "practiceParticipation": "DNP"},
  "certainty": "CONFIRMED",
  "source": "https://www.nfl.com/news/URL_REELLE_DU_RAPPORT",
  "publishedAt": "DATE_ISO_REELLE_DE_PUBLICATION",
  "expiresAt": "DATE_ISO_D_EXPIRATION"
}
```

Ce gabarit est volontairement non exécutable : remplacer l'identité, la source et les dates par des faits vérifiés. Les IDs fournisseurs, noms approximatifs ou rapprochements par homonymie sont refusés.

Types :

| kind | value | Utilisation |
| --- | --- | --- |
| STATUS | injuryStatus, rosterStatus, practiceParticipation, injuryBodyPart (champs optionnels ; au moins un) | Statuts distincts ; DNP ne signifie jamais Out. `injuryStatus:null` signifie absence d'alerte, pas guérison confirmée. |
| INJURY | outThroughWeek inclusif et/ou seasonEndingConfirmed:true | Fenêtre d'absence confirmée ; override d'une projection périmée et réévaluation des coéquipiers. |
| RETURN | clearedForWeek (semaine courante uniquement) | Retour explicitement confirmé, annule une ancienne preuve d’absence. Une date de retour espérée reste REPORTED. |
| ROLE | announcedRole (STARTER, STARTING_QB, BACKUP, COMMITTEE), roleWeeks optionnel | Seuls STARTER et STARTING_QB alimentent la confirmation de titularisation. BACKUP/COMMITTEE remplacent une ancienne confirmation de rôle par UNCONFIRMED. |
| NEWS | headline, 500 caractères maximum | Toujours REPORTED, consultable ; aucun changement de statut ni confirmation de rôle. |

`certainty:REPORTED` ne remplace jamais un fait utilisé dans le moteur. Les sources admises par défaut sont les domaines officiels NFL/équipes ; `PLAYER_INTELLIGENCE_SOURCE_HOSTS` étend explicitement cette liste. HTTPS obligatoire, sans identifiants, paramètres d'URL ou fragment. Une URL autorisée assure la traçabilité, pas la véracité : le producteur authentifié doit avoir vérifié la publication avant de marquer CONFIRMED. Les clés restent dans les credentials n8n.

## Fraîcheur, conflits et persistance

Publication source, collecte et expiration sont distinctes. La publication doit être antérieure à la collecte et dater de moins de sept jours ; l'expiration doit être future et à sept jours maximum. Les relevés Sleeper portent `COLLECTED_SNAPSHOT`, jamais une fausse date de publication.

Les faits officiels actuels priment sur un relevé quotidien Sleeper. Entre observations de même niveau, la plus récente prime. Une observation expirée ou hors semaine n'est plus appliquée. Une observation antérieure n'écrase jamais une nouvelle ; deux valeurs contradictoires à date identique et source identique donnent 409. Même valeur : aucun recalcul, mais une observation plus récente peut renouveler l'expiration. Reprise d'une observation expirée : recalcul.

`state.json` est privé (0600), remplacé atomiquement, avec verrou inter-processus et sérialisation des écritures. Les anciennes révisions sont conservées dans un historique borné à 10 000 lignes. Ce n'est pas une archive scientifique illimitée : les snapshots de décision restent le support du rejeu. Les caches Context/Waivers sont invalidés lors d'un changement accepté ; les lecteurs appliquent les observations au-dessus du référentiel Sleeper sans le muter. Les preuves de rôle/absence rejoignent le mécanisme DECISION_EVIDENCE_FILE, en conservant les observations opérateur plus récentes.

## Récupération

- 401 : choisir le bon credential, sans copier les tokens dans les logs.
- 503 : variables absentes, volume inaccessible ou source indisponible ; ne pas inventer un résultat vide.
- 400 : portée, ID, domaine, champ ou date invalides ; corriger la source, pas forcer une identité.
- 409 writer busy : laisser finir le job. Après crash seulement, vérifier qu'aucun processus n'écrit avant de retirer `writer.lock`.
- Capture trop ancienne : renouveler depuis la source réelle ; ne pas redater une ancienne actualité.
- Rapport toujours ancien : vérifier que la version serveur déployée inclut ce pipeline, que les deux services lisent le même volume, et que le recalcul utilise le bon roster.
- Plusieurs répliques : volume et verrou doivent être partagés ; sinon conserver un seul écrivain/une seule réplique pour ce pilote.

## Sources techniques vérifiées

- [Sleeper API](https://docs.sleeper.com/) : catalogue joueurs, API en lecture seule, recommandation d'un appel quotidien au catalogue.
- [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/) et [Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/) : requêtes authentifiées, planning et publication du workflow.
- [SportsDataIO NFL Workflow](https://sportsdata.io/developers/workflow-guide/nfl) : piste ultérieure pour un flux structuré plus fréquent ; aucun abonnement ni credential configuré dans ce pilote.

## Import dans l’instance — 20 novembre 2026

Deux brouillons enregistrés : [collecteur quotidien](https://n8n.bakene.tech/workflow/IQDUGDVldF2XPPhn) et [observations sourcées](https://n8n.bakene.tech/workflow/uj9tTxQvDwtBe5wh). Le collecteur est relié au credential Coach existant pour son recalcul, mais sa collecte est désactivée en attente du token d’ingestion. Le récepteur reste entièrement en attente de configuration. Aucun workflow publié ou exécuté.

Vérification de production en lecture seule : `GET /api/player-intelligence` retourne 404. Déployer le serveur et configurer le volume persistant, `PLAYER_INTELLIGENCE_DIR`, `PLAYER_INTELLIGENCE_TOKEN`, puis les credentials n8n avant le premier test réel.
