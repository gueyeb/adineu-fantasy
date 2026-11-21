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

Deux brouillons enregistrés : [collecteur quotidien](https://n8n.bakene.tech/workflow/IQDUGDVldF2XPPhn) et [observations sourcées](https://n8n.bakene.tech/workflow/uj9tTxQvDwtBe5wh). Le collecteur est relié au credential Coach existant pour son recalcul, mais sa collecte est désactivée en attente du token d’ingestion. Le récepteur reste entièrement en attente de configuration. État initial à l’import : aucun workflow publié ou exécuté (activation décrite ci-dessous).

Vérification initiale avant déploiement : `GET /api/player-intelligence` retournait 404. Déployer le serveur et configurer le volume persistant, `PLAYER_INTELLIGENCE_DIR`, `PLAYER_INTELLIGENCE_TOKEN`, puis les credentials n8n avant le premier test réel.

## Activation du collecteur — 20 novembre 2026

- Serveur déployé sur `234efd8`, sain ; volume persistant `/data/player-intelligence` et variable runtime configurés. Token généré et enregistré par l’utilisateur dans Coolify et dans le credential n8n `ADINEU player intelligence` ; aucune valeur reproduite ici.
- API sans identifiant : 401, confirmant que le token est appliqué.
- Collecteur lié au credential dédié ; recalcul lié au credential `Adineu — Coach API Token` existant. Premier relevé réel : `COLLECTED`, baseline=true, 104 joueurs, saison 2026 / semaine 11.
- Recalcul Coach testé : résultat publishable=true. Aucun message envoyé ; nœud de sortie conservé pour inspection.
- Deuxième appel : `DAILY_SOURCE_COOLDOWN`, changed=false et shouldRecompute=false ; le plafond quotidien empêche un nouveau téléchargement et un nouveau recalcul.
- Workflow `IQDUGDVldF2XPPhn` publié avec la version « Pilote collecte joueurs — 20 novembre 2026 ». Contrôle horaire, téléchargement Sleeper quotidien.
- Récepteur `uj9tTxQvDwtBe5wh` maintenu en brouillon, nœuds désactivés : il attend un producteur externe d’informations sourcées et son authentification distincte. Il n’est pas requis par le collecteur quotidien et aucun flux d’actualités en temps réel n’est activé.

## Vérification source NFL et notifications — 21 novembre 2026

La page officielle `https://www.nfl.com/injuries/league/2026/reg11` a été téléchargée et analysée : 293 lignes, tableaux par équipe, participation aux entraînements et désignation pour le match. Elle ne fournit pas de date de publication exploitable dans cette capture. Le titre confirme saison/semaine, mais cela ne prouve pas la fraîcheur de chaque ligne.

Le diagnostic en lecture seule `node scripts/audit-nfl-injuries.js 2026 11` distingue `collectedAt` et `publishedAt:null`. Il retourne `PUBLICATION_TIME_UNVERIFIED`, `eligibleForIngestion:false`, `shouldRecompute:false`. Aucun ancien rapport n'est redaté, aucune absence de désignation n'est convertie en joueur disponible et un DNP n'est pas converti en Out. Ce diagnostic n'est pas un collecteur actif.

Le workflow Coach existant `WSIPLP3jam3PC000` utilise Telegram et les filtres « Bulletin publiable ? » puis « Changement utile ? ». Son canal pourra être réutilisé sans nouvelle clé. Le collecteur quotidien conserve sa sortie sans envoi : le branchement Telegram n'a pas été effectué, l'export navigateur n'ayant pas abouti. Pour l'activer, filtrer strictement `publishable === true` ET `notify === true`, puis transmettre `message` au même destinataire privé ; ne pas envoyer de bulletin de test ou de baseline. Vérifier aussi la reprise après échec d'envoi avant publication.

État opérationnel : relevé Sleeper quotidien publié ; récepteur externe en brouillon ; flux NFL rapide et nouvelles notifications non activés.

## Alertes Telegram activées — 21 novembre 2026

Le collecteur `IQDUGDVldF2XPPhn` est désormais publié avec la version « Alertes Telegram joueurs — 21 novembre 2026 ». Le credential `Telegram account` et le destinataire privé du Coach existant sont réutilisés, sans nouvelle clé et sans reproduire le destinataire dans le dépôt. Cette activation remplace l'état « branchement non effectué » décrit plus haut.

Chaîne : collecte → `shouldRecompute === true` → Coach delta → contrôle intermédiaire → filtre Code → Telegram. Le filtre ignore `collection.baseline === true`, exige strictement `publishable === true`, `notify === true` et un message non vide. Les messages dépassant 4 000 caractères sont raccourcis avec un lien vers le Coach. Envoi en texte brut, sans attribution n8n.

Validation : contrôle réel réussi avec `DAILY_SOURCE_COOLDOWN`, `changed:false`, `shouldRecompute:false`, aucun appel Telegram. Huit cas logiques vérifiés : cas utile accepté, baseline refusée, bulletin non publiable refusé, notify=false refusé, chaîne "true" refusée, texte vide refusé, texte null refusé, longueur limitée. Aucun message de test n'a été envoyé ; la livraison Telegram de cette nouvelle branche attend le premier changement réel.

Le delta serveur stocke son état avant l'envoi : cette chaîne ne constitue pas une outbox avec garantie de livraison après échec Telegram. Une erreur d'envoi doit être inspectée dans les exécutions n8n ; ne pas relancer aveuglément une notification déjà envoyée. Le relevé reste quotidien et la source externe rapide reste à finaliser. Les JSON locaux demeurent des modèles d'import désactivés pour configuration explicite.

## Collecte des actualités officielles NFL — 21 novembre 2026

`POST /api/player-intelligence/collect-news?team=t0z` utilise le même token dédié et lit directement [NFL News](https://www.nfl.com/news), sans abonnement ni clé externe. La source a été vérifiée sur une capture contenant 23 cartes officielles récentes avec une date ISO explicite. Le parseur HTML parse5 décode les entités, limite la réponse à 4 Mio et accepte uniquement les articles NFL datés de moins de 48 heures. Une page vide ou au format modifié échoue explicitement, sans avancer le curseur.

Seuls les noms complets et uniques du catalogue sont rapprochés, pour les joueurs du roster suivi et leurs coéquipiers du même poste. Aucun rapprochement par nom de famille, aucune déduction automatique de rôle ou de blessure. Les observations NEWS restent REPORTED et shouldRecompute=false. L'alerte privée donne le titre, la date source et le lien ; elle annonce explicitement qu'elle ne change pas les recommandations.

Le premier relevé crée une référence sans alerte. Plafond de collecte : 30 minutes, persistant. Les nouvelles observations rejoignent une file privée persistante, avec lots de trois et un bail de cinq minutes pour éviter les envois simultanés. Le workflow doit appeler `POST /api/player-intelligence/news/ack` avec `{ "deliveryId": "…" }` seulement après le succès Telegram. Sans acquittement, le même lot est proposé après expiration du bail, même pendant le délai entre collectes. Une panne Telegram n'efface donc pas les articles à envoyer. Une panne après envoi mais avant acquittement peut produire un doublon : livraison au moins une fois, pas une garantie exactement une fois. La file est bornée à 100 entrées par portée et à 12 portées. Une bascule de semaine/roster crée une nouvelle référence.

Tests : source officielle datée, doublons, dates absentes/futures/périmées, noms ambigus, premier relevé, changements, redémarrage, bail, reprise, acquittement, taille Telegram, échec source et contrats HTTP privés. Pas de build, typecheck ou lint configuré ; contrôles syntaxiques Node, suite de tests et vérification statique exécutés.
