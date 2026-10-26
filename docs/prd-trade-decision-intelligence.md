# Trades pertinents et décisions de semaine cible

Date : 26/10/2026. Statut : première version TF-01 implémentée localement ; suite du chantier ouverte, aucun déploiement.
Source : retour utilisateur sur les 15 propositions Boukki et débrief waivers S7 → S8.

Priorité révisée après l'audit du 26/10 : [Quality & Consistency](quality-consistency-2026-10-26.md).
Les contrats de cohérence et les correctifs opérationnels QC-01 précèdent désormais
le scanner post-match. Les annonces de « prochain lot » plus bas sont historiques.

## Objectif

Produire moins de propositions, mais des échanges défendables pour les deux managers.
Relier trades, waivers et coupes à une semaine cible explicite, sans réécrire le
calculateur ni ajouter une probabilité d'acceptation artificielle. Le moteur reste
déterministe ; l'IA explique les preuves et aide à négocier.

Priorité exprimée pour Boukki : RB utilisable en S8, puis potentiel de titulaire ROS.
WR au second plan sauf opportunité exceptionnelle. Cette préférence est datée,
spécifique au roster, et ne devient pas une règle permanente pour les 12 managers.

## Constat vérifié dans le code

- `trade-recommender.js` analyse déjà les rosters adverses, leurs déficits/surplus,
  les gains bilatéraux, les préférences et les contre-offres. Étendre et exporter
  ces calculs plutôt que reconstruire une deuxième analyse de ligue.
- Sa recherche accepte un gain propre supérieur à 0,5 pt et un gain adverse nul.
  Le filtre final accepte aussi des gains propres faibles ; la limite de 15 est
  un plafond, pas une obligation de remplissage.
- Le dédoublonnage porte sur les packages identiques, sans filtre de dominance
  entre packages différents. Les plafonds intermédiaires peuvent masquer de meilleurs choix.
- `trade-score.js` distingue valeur marché et delta de lineup, mais sa confiance
  repose sur les avertissements et blessures ; auditer la provenance réelle des inputs.
- `trade-value.js` a un plancher à 1 et applique déjà taxes de roster et décote de
  package. Mesurer leurs effets avant de remplacer ou cumuler des pénalités.
- Le waiver existant expose déjà `lastCompletedWeek`, `targetWeekDelta`, gain net,
  coût de coupe et couverture. War Room, watchlist, journal et archives de trades
  existent : les enrichir et vérifier leur propagation dans le contexte IA.

Les propositions copiées sont des cas de régression à reconstruire avec des inputs
figés, pas une capture complète permettant de reproduire leurs scores. Les équipes
NFL, blessures, performances et cibles citées dans le débrief ne sont pas vérifiées
par ce document. Aucun classement de joueurs ni conseil d'enchère live n'en découle.

## Lots et critères d'acceptation

### P0 — TF-01 : sélection et confiance

- Éliminer avant classement, diversité et plafonds les offres strictement dominées
  pour un même partenaire et une même réception. Cas minimal : Puka + Cooper → Kyren
  disparaît si Puka → Kyren est disponible et faisable. Comparer les impacts réels,
  coûts de coupe et contraintes ; une assurance de profondeur explicitement utile
  n'est pas équivalente à une simple addition gratuite.
- Séparer exclusions pour données invalides, scénarios exploratoires pour données
  incomplètes, et recommandations exploitables. Projection par rang, identité/équipe
  contradictoire ou blessure non sourcée ne peuvent donner « confiance bonne ».
- Tester un gain minimum de 1,5 pt/semaine et une protection premium sous 2 pts/semaine.
  Seuils initiaux non calibrés, configurables et documentés. Définir les premiums par
  une règle générale et les préférences Keep/Untouchable, sans coder Puka/McBride en dur.
  Une exception ROS doit avoir un bénéfice quantifié ; une préférence explicite doit
  rester compatible avec les contrôles de validité.
- Exiger une utilité adverse identifiable pour recommander. Gain nul sans bénéfice
  démontré → exploration, jamais un argument prétendant améliorer les deux lineups.
- Trois groupes : recommandés, à négocier, exploration volontaire. Zéro recommandation
  est un résultat valide. Conserver les motifs d'exclusion pour diagnostic.
- Afficher le gain cible et les gains des semaines suivantes/ROS uniquement lorsque
  les données les permettent, avec horizon, risque, coupe éventuelle et raison adverse.
  Un delta moyen ROS ne doit pas être présenté comme une projection publiée de S8.

### P0 — LI-01 : contexte des 12 rosters et partenaires

- Exporter titulaires officiels, banc, IR, byes, blessures datées, besoins et profondeur
  des 12 équipes ; distinguer lineup déclarée et lineup optimale simulée.
- Classer les 11 partenaires par complémentarité et utilité marginale, puis évaluer
  les packages au moyen du moteur partagé UI/API/Coach. Aucun identifiant privé public.
- Cas Boukki : rechercher jusqu'à trois partenaires avec un RB de profondeur améliorant
  son roster et un slot WR/FLEX pouvant bénéficier de Downs, Worthy, Burden ou DJ Moore.
  Ne pas forcer trois résultats ; RB3 et WR2 se mesurent avec leur éligibilité FLEX.
- Propriété manquante, joueur déjà transféré ou roster incomplet : diagnostic explicite,
  aucune proposition présentée comme actionnable à partir d'une propriété périmée.

### P0 — WK-01 : semaine cible et scanner post-match

- Contrat explicite : `lastCompletedWeek`, `liveWeek`, `targetWeek`, couverture et
  statut par match. Un dimanche S7 partiel peut préparer S8 sans déclarer S7 terminée.
- Comparer la semaine courante aux trois précédentes pour snaps, routes, courses,
  targets et touches red zone, selon sources réellement disponibles. Les absences
  de données restent nulles ; aucun rôle durable inféré d'un score isolé.
- Signaux : promotions après blessure, changements de rôle, émergences et retours.
  Chacun porte source, date de collecte, période observée et confiance ; les matchs
  en cours et preuves périmées sont visibles. Pas de fausses routes ou de reprise
  automatique d'un statut `GAME_COMPLETION` non vérifié.
- Créer une sélection d'opportunités distincte du top par poste, sans exiger une
  projection numérique pour rendre une cible visible. Sans projection suffisante,
  afficher surveillance et condition de confirmation plutôt qu'un gain inventé.
- Vérifier pourquoi `RELEVANT_CANDIDATE_ABSENT` écarte des candidats ; distinguer
  candidats détectés, évaluables et affichés, sans promettre que les 95 sont pertinents.

### P1 — MV-01 : valeur et coût d'opportunité

- Auditer la distribution des valeurs à 1 et conserver une granularité utile en
  calcul. Distinguer valeur marché générale, utilité roster et incertitude.
- Simuler les coupes réellement nécessaires des deux côtés, leur coût permanent,
  la profondeur perdue et la concentration premium dans les packages 2-pour-1.
- Comparer ajout–coupe, conservation et trade ; un joueur Out n'a pas une valeur
  nulle automatique. Examiner notamment Downs, DJ Moore et Coleman sans les
  désigner à l'avance comme coupes.
- Auditer BUY_LOW/SELL_HIGH : production seule insuffisante ; couverture et tendances
  d'usage nécessaires, sinon signal limité ou supprimé.
- Comparer aux trades archivés Yahoo et Sleeper séparément, avec scoring, contexte
  et taille d'échantillon. Aucun backtest utilisant des données futures.

### P1 — WR-01 : War Room et synthèse actionnable

- Enrichir la watchlist existante : raison, condition attendue, réévaluation,
  disponibilité Sleeper, propriétaire éventuel, enchère envisagée et provenance.
- Restituer trois sorties privées : qui ajouter, qui couper, à qui proposer un trade,
  avec claims conditionnels et alternatives. Le récap public conserve son périmètre
  actuel ; les décisions et préférences personnelles restent privées.
- Watchlist initiale à revérifier : Rodriguez, Kendre Miller, Pierce, McLaughlin,
  Holani et Spears. Ne pas importer les équipes/statuts cités comme vérités courantes.

## Classement à expérimenter après les garde-fous

Proposition utilisateur sur 100 : gain propre 30 %, équité marché 25 %, utilité
adverse 20 %, faisabilité 15 %, risque/qualité 10 %. Définir et tester les échelles
avant activation, éviter de compter deux fois les mêmes facteurs. La faisabilité
exprime des contraintes et un intérêt observable, jamais une probabilité d'acceptation.
Aucun score élevé ne compense une donnée invalide. Les poids ne sont pas livrés.

## Évaluations minimales et ordre de livraison

1. TF-01 : fixtures synthétiques identifiées comme telles pour dominance, premium,
   faible gain, gain adverse nul et projection absente. Reconstruire ensuite le cas
   Boukki avec un snapshot sourcé ; ne pas prétendre reproduire la copie seule.
2. LI-01 + WK-01 : 12 rosters, 11 partenaires possibles, FLEX, byes, propriété fraîche,
   S7 partielle/S8 cible, match en cours, routes absentes et nouvelle cible hors top.
3. MV-01 + WR-01 : coupe avec coût de retour, contraintes IR, package, préservation
   des préférences et contre-offres, cohérence UI/API/export et watchlist persistante.
4. Calibration des valeurs et du classement seulement après comparaison des sorties.

Signal de livraison : aucune offre dominée ni donnée invalide parmi les recommandés,
aucun bénéfice adverse inventé, horizons cohérents et motifs lisibles. Mesurer nombre
avant/après et causes de rejet ; mesurer l'acceptation seulement sur choix réels tracés.
Vérification d'implémentation : pas de compilation/linter configurés actuellement ;
`npm run check`, tests ciblés puis suite appropriée, versions d'assets et navigateur
desktop/mobile si UI modifiée. Aucun suivi quotidien ni changement n8n créé par ce cadrage.


## Livraison locale TF-01 — 26/10/2026

- Filtre partagé Finder/CLI/API : dominance avant plafonds, vues RECOMMENDED
  (par défaut), NEGOTIATE et EXPLORATION. Contre-offres soumises aux mêmes seuils.
- Paramètres expérimentaux exportés : gain 1,5 ; premium/Keep 2 ; premium défini
  par valeur ≥ 70 ou rang expert global ≤ 24. Shop lève uniquement la protection
  automatique premium ; Untouchable reste exclu. Pas d'exception ROS inventée.
- Confiance abaissée pour Questionable sans projection, statut inconnu et projection
  manquante d'un joueur utilisé dans les lineups comparées. Les blessures reconnues
  limitent toujours la confiance à moyenne. Ne vérifie pas automatiquement la véracité
  médicale, la date du statut ni les contradictions entre équipes NFL : audit de
  provenance restant ouvert. « Bonne » décrit la couverture actuelle, pas une validation externe.
- Dominance conservatrice : même partenaire/réception, package cédé strictement inclus,
  gain propre au moins égal, gain adverse positif et confiance au moins égale. Elle
  conserve l'option de profondeur sans prétendre mesurer son prix ; coût permanent
  de coupe et dominance plus générale restent dans MV-01.
- Les moyennes ROS restent des moyennes ; aucune courbe hebdomadaire nouvelle ni
  prévision cible S8 ajoutée. La présence d'une projection est vérifiée sans encore
  distinguer absence liée au bye et défaut de publication (peut sur-filtrer).
- Vérification : fixtures synthétiques de dominance/seuils/confiance, tests existants
  de préférences et contre-offres ; suite complète finale 581/581 et tests ciblés validés. Contrôle statique et
  versions d'assets valides ; navigateur local Boukki : une recommandation principale
  (Puka → Nabers + Swift), exploration avec raisons. Aucun snapshot live archivé,
  aucune preuve de calibration ni promesse d'acceptation. Mobile 390 px non vérifié.

Restant TF-01 : provenance sourcée/date/contradictions, diagnostic global des exclusions,
validation mobile dédiée et mesures reproductibles sur snapshot. Puis LI-01/WK-01.


## Livraison locale LI-01 — 26/10/2026

- Snapshot des rosters réels ajouté au contexte, avec source et date de collecte,
  joueurs détenus, titulaires déclarés réconciliés avec la propriété, banc et IR.
  Aucun `owner_id` ni identifiant de compte privé exporté dans ce snapshot.
- Contexte décisionnel JSON et texte : toutes les équipes et leurs joueurs enrichis
  (projection cible, ROS, statut plateforme, bye), lineup optimale distincte de la
  lineup déclarée, profondeur RB/WR/TE/QB et diagnostic de besoins existant, étiqueté
  comme heuristique de marché. Les identités/équipes NFL live alimentent aussi les
  valeurs partagées lorsque disponibles ; repli catalogue sinon, dont la provenance
  détaillée par joueur reste à exposer.
- `league-trade-intelligence.js` : calcul pur commun au contexte IA, à l'API trades
  et au Finder. Écran initial 1-pour-1 avec gains strictement positifs des deux côtés,
  seuils TF-01, préférences et écart marché ≤ 18 % (seuil existant du calculateur).
  Classement par plus petit gain des deux équipes, puis gain propre ; ce score est
  un gain de lineup en points, pas une probabilité d'acceptation.
- Les 11 partenaires restent visibles ; jusqu'à trois partenaires qualifiés, sans
  forcer de résultat. Chaque exemple expose les deux gains, son groupe et sa confiance.
  Métadonnées/propriété absentes, joueur détenu par plusieurs équipes, titulaire
  transféré, doublon ou incohérence IR : aucun exemple qualifié pour la comparaison.
- Vérification : 585 tests passent, dont quatre nouveaux tests de ligue synthétique
  (12 équipes/11 partenaires, FLEX, banc/IR/byes, préférences, récupération des données
  absentes et conflits de propriété, export IA complet). Contrôles statiques et
  versions d'assets passent. UI locale contrôlée : liste des onze partenaires,
  diagnostics explicites et absence de résultat forcé. Aucun déploiement/push.

Limites : comparaison des partenaires sur échanges simples uniquement ; pas encore
le classement des packages ni la préférence RB S8 persistante, ni le recoupement de
propriété entre deux collectes à des heures différentes. La date du snapshot indique
la collecte des rosters, pas la date de mise à jour de chaque blessure ou projection.
Le texte compact historique garde son format ; le texte en mode décision inclut la
ligue complète. L'IR peut contribuer à l'estimation ROS mais ne vaut pas confirmation
d'éligibilité immédiate. Mobile 390 px et calibration sur archives restent ouverts.
Le scanner post-match et la distinction complète semaine live/cible restent WK-01.


## Livraison locale LI-01 V2 / cible de trade — 26/10/2026

- Le classement des partenaires reprend désormais `findTradeProposals` avec les
  packages 1-pour-1, 1-pour-2 et 2-pour-1 du Finder, avant son plafond d'affichage.
  Suppression du deuxième moteur de recherche d'échanges simples. Le mode interne
  `ALL` et `limit: null` permettent d'évaluer chaque partenaire avant de limiter
  ses exemples. Les explorations restent exclues du classement qualifié.
- Contrat V2 : `method=SHARED_FINDER_PACKAGES_V2`, `give` et `receive` sont des listes
  dans les exemples de partenaires. Gain moyen ROS et `targetWeekImpact` séparés.
  Préférence de poste : le package reçu doit inclure ce poste ; ce filtre ne prouve
  pas à lui seul une amélioration du slot de ce poste en semaine cible.
- UI : poste et semaine cible sauvegardés par saison/ligue/roster dans le navigateur,
  sans synchronisation Coach/n8n. Une priorité de semaine passée expire sans être
  renouvelée automatiquement. Aucune préférence RB S8 codée en dur pour Boukki.
- Les gains cible sont des scénarios pré-match calculés sur les projections publiées
  de cette semaine, avec FLEX et bye à zéro. Pas de réutilisation du ROS, du rang ou
  de la projection d'une autre semaine. Coverage exigée aussi sur le banc : une
  projection absente, une équipe NFL inconnue, une propriété contradictoire ou un
  retour futur Out/IR non vérifié rendent les deltas nuls (`null`), pas zéro.
  Ce garde conservateur peut supprimer un gain lorsque la lacune concerne un joueur
  peu pertinent. Il ne certifie ni les blessures ni la faisabilité avant kickoff.
- Avec cible configurée, gain cible positif démontré d'abord, puis estimations
  couvertes et fit ROS. Une cible sans couverture reste distincte d'un gain nul.
  La sélection qualifiée garde les garde-fous ROS existants : elle ne cherche pas
  encore des locations S8 au gain ROS négatif. Délai d'acceptation/traitement du
  trade explicitement `UNVERIFIED` ; aucun échange réel envoyé ni appliqué.
- `/api/trades?team=t0z&tradePosition=RB&targetWeek=8` et
  `/api/context?team=t0z&tradePosition=RB&targetWeek=8` acceptent les paramètres
  explicites. Paramètres invalides → 400 ; clés de cache séparées par priorité.
  Le bulletin montre la cible demandée et distingue son gain de la moyenne ROS.
  Le bouton contexte générique et le Coach ne lisent pas encore la priorité locale
  du navigateur ; l'appel API paramétré permet de l'exporter explicitement.
- Correction d'intégration LI-01 : `/api/context` demande maintenant les valeurs de
  tous les joueurs des rosters collectés, et pas seulement de l'équipe sélectionnée.
  `/api/player-values` expose la fenêtre hebdomadaire limitée aux joueurs rostés et
  à `pts_ppr`, afin que le navigateur utilise les mêmes projections que le serveur.
- Vérification : 596 tests passent ; contrôles statiques, versions d'assets et syntaxe
  passent. Tests de package 1-pour-2 avec gains cible et ROS différents, expiration,
  byes/FLEX, couverture/retour/propriété, ordre des cibles, paramètres API, isolation
  du cache et enrichissement adverse. UI locale : RB/S8 sauvegardés et conservés
  après rechargement, Ethan Hunt présent via Puka → Nabers + Swift, gain S8 absent
  avec la couverture réelle et donc étiqueté indisponible. Mobile 390 px non audité.

Prochain lot : WK-01 (semaines terminée/live/cible et scanner post-match sourcé).
Les anciens chapitres décrivent les incréments précédents ; la limitation aux seuls
échanges simples de LI-01 V1 est levée. Aucun push ni déploiement.
