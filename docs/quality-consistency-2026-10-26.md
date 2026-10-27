# ADINEU Quality & Consistency

26/10/2026 — feedback utilisateur intégré à la roadmap. Statut : consolidation
priorisée ; premier incrément QC-01 implémenté et vérifié localement, non déployé.

## Direction et portée

Consolider les fonctionnalités actuelles avant d'en ajouter. Une recommandation doit
être réaliste, justifiée, actionnable et mesurable après coup. À sources, dates,
horizons et contraintes identiques, Coach, Trade Finder, Waiver Wire, Start/Sit,
contexte IA et page Équipe doivent raconter la même décision. Des métriques de nature
différente peuvent diverger, mais leur base et leur période doivent être explicites.

Cette priorité remplace l'ordre d'exécution du chantier trades qui annonçait le
scanner post-match comme prochaine livraison. Réutiliser les composants existants ;
pas de refonte générale, de nouveau moteur de décision ou de nouvelle API par défaut.
Les trois lots ci-dessous sont des périmètres de PR proposés, pas des PR déjà ouvertes.

## Provenance des constats

Source : audit collé par l'utilisateur, intitulé « Audit ADINEU — Consolider l'existant
avant de construire davantage », rapportant une consultation publique du 26/10/2026.
La production n'a pas été revérifiée lors de cette intégration documentaire.

| Constat | État de preuve à cette intégration |
| --- | --- |
| Trade Finder : faisabilité « naturelle », confiance « bonne » trop affirmatives | Libellés encore présents dans `trade-score.js` et `trade-ui.js`. La confiance mesure surtout la couverture du calcul, pas l'acceptation. |
| Boukki : all-play indisponible malgré six semaines terminées | Rapporté par l'audit ; message d'indisponibilité présent dans `teams.js`, cause à reproduire sur snapshot. |
| Force par poste sur rangs/ADP versus valeurs ROS du Trade Hub | Base rang/ADP confirmée dans les commentaires et libellés de `teams.js`. Choix d'alignement ou d'explication à faire explicitement. |
| Manager, équipe actuelle et alias historiques mélangés | Exemples « Magatte » / « SneakySlayerMG » et « Tamsir » / « flemme » rapportés ; contrôler les identités confirmées, sans déduire de nouveaux rapprochements. |
| Probabilités pré-match présentées près des scores live | Rapporté ; reproduire les états avant/pendant/après match. Ne pas transformer une probabilité figée en estimation live. |
| Gains trades sur S7–S14 pendant S7 et joueur IR dans une lineup simulée | Rapporté ; les gains cible ont été séparés localement, mais première semaine réellement affectable et hypothèses de retour restent à vérifier. |
| Waivers : 08:00 affiché contre « mercredi 09:00 Europe/Paris » dans l'IA | Conflit rapporté ; heure habituelle codée en dur confirmée dans `league-settings.js` et réutilisée par le contexte. Ni 08:00 ni 09:00 ne sont validés ici comme heure opérationnelle. |
| Identifiants bruts de transactions, codes de blocage, charge de `/api/free-agents` | Rapportés ; reproduire et mesurer avant correction. Taille annoncée supérieure à un million de caractères, pas preuve de latence. |

Les « 15 propositions » et « 11/15 sous +1 pt/semaine » décrivent l'échantillon de
production de l'audit. Les commits locaux `16732b6`, `2abe8d0` et `7fe3ff6` ont déjà
ajouté sélection, contexte de ligue, packages et cible datée ; ils n'ont pas été
déployés dans ce chat. Ne pas compter les constats de l'audit comme résultats de
ces versions locales, ni déclarer la production corrigée grâce aux tests locaux.

## QC-01 — Cohérence et exactitude opérationnelle (P0)

À traiter avant les améliorations de classement et toute extension fonctionnelle.

- [ ] Reproduire chaque anomalie prioritaire avec source, date, semaine, couverture
  et version du modèle ; convertir la reproduction en test de non-régression.
- [x] All-play (correctif local, non déployé) : partager les matchups et la règle de semaines complètes ; distinguer
  absence de données, couverture incomplète et seuil réellement non atteint.
- [ ] Identités : distinguer manager canonique, équipe actuelle et alias historique.
  Utiliser les identités confirmées et la réconciliation existante, sans guessing.
- [ ] Force par poste : aligner les inputs pertinents ou expliquer clairement la
  différence rang/ADP, valeur marché, projection hebdo et utilité ROS. Ne pas donner
  la même étiquette à des indicateurs différents.
- [ ] Formaliser `dataThroughWeek`, semaine live, semaine cible et première semaine
  effectivement affectable. Pour un trade, intégrer les règles de revue/traitement,
  kickoffs et locks sourcés ; une cible choisie ne prouve pas l'exécutabilité.
- [ ] IR : séparer simulation future, lineup optimale projetée et lineup alignable.
  Afficher semaine et hypothèse de retour, sans clearance médicale inventée ni
  retour automatique d'un joueur parce qu'il a une projection ROS.
- [x] Heure de waivers (correctif local, non déployé) : une source opérationnelle datée et vérifiée prime sur le
  libellé habituel. Tester le décalage de changements d'heure Europe/États-Unis du
  26–28 octobre ; conserver « estimé / à confirmer » si la preuve manque.
- [ ] Vérifier les fuseaux et exécutions réelles n8n mardi/jeudi ; aucune modification
  de workflow n'est effectuée par ce document.
- [ ] Game Center : signaler visuellement les probabilités figées pré-match près
  des scores live, ou les masquer selon l'état ; aucun nouveau modèle in-play.

Sortie : sur un même snapshot, aucun état contradictoire entre écrans et aucune
action bloquée présentée comme exécutable maintenant. Vérifier S7 partielle/S8 en
préparation, bye, IR, cutoff de trade, lock et transition de fuseau.

## QC-02 — Qualité des recommandations de trade (P1)

S'appuyer sur TF-01/LI-01 et les recherches 1-pour-1, 1-pour-2, 2-pour-1 existantes.
Ne pas augmenter le nombre de combinaisons ni changer arbitrairement les valeurs.

- [ ] Séparer équité marché, gain sportif de chaque équipe et crédibilité heuristique
  de la structure. Renommer « Confiance » en « Fiabilité du calcul » lorsqu'elle
  mesure la couverture ; retirer les affirmations d'acceptabilité non étayées.
- [ ] Justifier les motivations adverses avec les titulaires améliorés, besoins,
  profondeur perdue, places/coupes, santé et sensibilité aux scénarios. Deux deltas
  positifs et des valeurs proches ne suffisent pas à conclure « naturelle ».
- [ ] Présenter trois à cinq opportunités principales au maximum, et moins si
  nécessaire ; conserver petits gains et données fragiles en résultats secondaires.
  Une recherche sans offre défendable reste un résultat valable.
- [ ] Comparer avant/après sur les 15 offres Boukki comme référence qualitative,
  puis sur plusieurs autres rosters. Pour une comparaison numérique, reconstruire
  un snapshot complet sourcé : le texte collé ne permet pas de rejouer les scores.
- [ ] Évaluer les premières offres manuellement : motivation des deux managers,
  effet sur les lineups, coupe réelle, horizon affectable et scénario de blessure.

Sortie : chaque offre du top 5 disponible est défendable par l'analyse des deux
rosters, avec risques et limites explicites. Aucun objectif de remplir cinq places.

## QC-03 — Expérience des décisions et feedback (P1/P2)

- [ ] Waiver Wire : trois vues « Actions exécutables maintenant », « Préparer les
  waivers de la semaine cible » et « À surveiller ». Conserver les blocages du moteur
  sans exposer une liste de codes comme parcours principal ; zéro acquisition
  légale est un résultat normal, distinct d'une préparation prometteuse.
- [ ] Transactions récentes : noms des joueurs, équipes fantasy et impacts candidats
  visibles ; identifiants dans le détail technique. Traduire les codes, corriger
  « Tu devra », homogénéiser dates, états et unités.
- [ ] Normaliser une vue des décisions existantes, sans recalcul parallèle : date,
  semaine des données, semaine effective, état ACTIONABLE/PREPARE/WATCH/BLOCKED,
  action, gain nullable, fiabilité, raisons, blocages, prochaine vérification et
  snapshot. Le `DecisionSummary` proposé dans l'audit est un contrat à évaluer,
  pas une structure déjà disponible ni une nouvelle API imposée.
- [ ] Pour une même décision, Coach/Start-Sit/Waiver/IA partagent état, semaine, gain
  et avertissements bloquants ; les interfaces adaptent seulement leur détail.
- [ ] Start/Sit : différencier optimal projeté, alignable et Boom/Safe ; expliquer
  les compositions identiques plutôt que multiplier des variantes sans effet.
- [ ] FAAB : conserver fourchette marché, plafond personnel et enchère proposée.
  Expliquer couverture et calibration ; ne pas ajouter de fausse précision aux
  probabilités de gain ni prétendre connaître les intentions adverses.
- [ ] Notifications n8n : privilégier les changements utiles (rôle, recommandation,
  levée d'un blocage, décision proche du kickoff) plutôt que répéter le rapport.
  Concevoir/tester le delta avant d'activer ou modifier une notification réelle.
- [ ] Exploiter journal et snapshots : choix réels, motifs de refus, bilans à deux
  et quatre semaines. Une proposition non choisie n'est pas un mouvement exécuté.
- [ ] Terminer l'audit mobile du Coach authentifié et les parcours modifiés.
- [ ] Réconcilier les cases de roadmap avec preuves de production datées : snapshot
  RB du 20/10 cité par l'audit, job du mardi, horaires, statut livré/local/déployé.
  Ne pas cocher sur la seule présence d'une fonctionnalité dans le code.
- [ ] Mesurer taille transférée, temps de réponse, rendu et usages des gros payloads,
  notamment `/api/free-agents`, avant d'en réduire le contenu ou changer le cache.

Sortie : une décision se lit, se prépare, se retrouve et s'évalue sans contradiction
entre outils, avec identité et horizon traçables.

## Garde-fous de modèle et travaux différés

Les résultats 41–43 % sont documentés dans le [backtest des trades](backtest-trade-value.md) :
95 trades archivés, 57 avec un gagnant, 47–56 notés selon les inputs. Ce n'est ni un
taux d'acceptation, ni une garantie sur les échanges futurs. La valeur live sert
de repère d'équité heuristique, pas de prédiction du gagnant ou de l'accord adverse.
Le backtest n'a pas été relancé pour cette intégration.

Conserver le mélange Sleeper/usage 80/20 et ne pas intégrer ffopportunity au mélange
sans bénéfice supplémentaire démontré ; voir [usage](backtest-usage.md) et
[ffopportunity](backtest-ffopportunity.md). Les conclusions sur défenses, SELL_HIGH
et calibration FAAB rapportées par l'audit doivent garder leurs échantillons,
horizons et limites ; aucun coefficient ne change à cause d'une seule semaine.

Différer SOS QB/TE, nouveau moteur de projection, nouveaux indicateurs de trade,
refonte frontend et ouverture multi-ligues. Le SOS reste explicatif tant que sa
fiabilité prédictive ne justifie pas d'entrer dans les projections : distinguer
difficulté relative, difficulté absolue et fiabilité. Les anciennes fenêtres
« S8–S10 » de décision SOS ne constituent pas une autorisation d'extension prioritaire.

Le scanner post-match et les enrichissements du chantier précédent restent au
backlog ; ils reprennent après les contrats et correctifs P0, sans reconstruire
la War Room, les rosters partagés, le journal ou le système de snapshots.

## Ordre des prochains travaux

1. QC-01 : reproductions/test de cohérence, puis all-play, horaires/fenêtres,
   identités et états opérationnels.
2. QC-02 : comparer les recommandations à données fixes et faire relire les offres
   de Boukki et d'autres équipes ; corriger les formulations et motifs bilatéraux.
3. QC-03 : simplifier la lecture/action et mesurer les résultats réels.

Pour chaque livraison, consigner les tests exécutés, les contrôles manuels, les
limites, le commit et la preuve de déploiement lorsqu'il existe. Les vérifications
de compilation/type/lint ne sont pas inventées si aucun outil n'est configuré.


## QC-01 — Premier incrément local : all-play et horaires

26/10/2026. Les autres cases QC-01 restent ouvertes ; aucune publication en production.

**Reproduction all-play sur les sources publiques actuelles.** La requête de la page
renvoyait 84 lignes (S1–S7), dont six semaines terminées pour les 12 équipes. Le calcul
était bloqué avec `incomplete_coverage`, mais l'UI affichait « pas assez de semaines ».
Cause : comparaison des noms canoniques Supabase aux pseudos Sleeper actuels. Les
écarts Birama/bmb22 et MouhammadAT/Shiro00 empêchaient la validation globale ; ce
n'était pas une absence des scores de Boukki.

Le chargement inclut désormais `teams.external_roster_id`, colonne existante et
publique. All-play, badge Power et Record Watch du dossier sont reliés au roster
exact de la saison. Aucune identité n'est déduite d'un surnom et aucune table, policy
ou donnée Supabase n'est modifiée. La page distingue aussi nom canonique et compte
Sleeper lorsqu'ils diffèrent ; le classement du dossier est retrouvé par cette
liaison explicite. L'harmonisation des autres pages reste à faire.

Les états « source indisponible », « rattachement manquant », « couverture incomplète »
et « seuil de semaines non atteint » ont des messages distincts. Le total affiché
est le nombre de confrontations hypothétiques, avec le nombre de semaines à part.
Sur la lecture datée du 26/10 : Boukki **19–47 sur 66 confrontations en six semaines** ;
Ethan Hunt **34–32**, Kuro **29–37**. S7 live exclue, formules Power inchangées.
Ces chiffres sont une vérification datée, pas une fixture de scores à maintenir.

**Horaires.** `waiver-schedule.js` reprend la règle dérivée des réglages Sleeper et
validée par au moins deux batches historiques, déjà utilisée pour la disponibilité.
Une seule représentation source/date/UTC alimente le libellé Europe/Paris du Waiver
Wire, du contexte décisionnel, du bulletin waivers et du Coach (plan, texte, UI).
Le créneau de traitement en cours est distingué du passage hebdomadaire suivant.
Le libellé fixe 09:00 est retiré de la configuration et de l'onglet règles ; sans
preuve suffisante, le contexte compact indique un horaire non vérifié.

L'heure future reste **déduite et à confirmer dans Sleeper**, pas une observation
opérateur ni une confirmation de disponibilité de chaque joueur. Les échéances
propres aux coupes récentes peuvent différer du passage hebdomadaire. La vue locale
sur données réelles affiche mercredi **28/10 à 08:00 Europe/Paris**, cohérente avec
les échéances des lignes candidats. Tests de fuseaux : 21/10 à 09:00, 28/10 à 08:00,
04/11 à 09:00 pour la règle testée. Aucun workflow n8n ni horaire de production modifié.

**Vérification.** Suite complète de 602 tests et tests ciblés ; contrôles statiques,
versions d'assets et syntaxe valides. Reproduction avant/après sur les données
publiques, fixtures synthétiques sans identifiants de compte privés, tests du
rattachement de 12 rosters, des motifs d'indisponibilité, de l'invariance Power et
du même horaire en sortie waiver/IA/Coach. Navigateur local : Boukki, Ethan Hunt et
Kuro vérifiés, ainsi que le libellé du Waiver Wire. Coach authentifié et mobile
390 px non audités. Aucun recalibrage de modèle ni accès élargi aux données.

Prochain incrément QC-01 : première semaine réellement affectable des trades
(revue, kickoffs, locks, IR) et présentation des probabilités pré-match en live.
Le scanner post-match reste différé après les correctifs P0.


## QC-01 — Deuxième incrément : hypothèses IR et lineups simulées

26/10/2026. Les détails Finder désignent maintenant les lineups comme des simulations
ROS et précisent que leur composition n’est pas une lineup alignable confirmée.
Le calculateur et son export texte partagent la semaine supposée de retour, sa base
(projection future positive ou durée forfaitaire), et une disponibilité non vérifiée.
Les blessés conservés dans les rosters sont inclus dans cette provenance, pas seulement
les actifs échangés. Une projection n’est jamais une preuve d’activation IR.

Les projections futures nulles ou négatives ne déclenchent plus une hypothèse de retour.
Les scénarios et leurs rampes restent non calibrés ; valeurs marché inchangées.
Les champs de compatibilité `expectedReturnWeek` sont conservés comme hypothèses de
modèle, accompagnés de la nouvelle provenance. Délai de trade, kickoffs et locks sont
explicitement non vérifiés ; ce lot ne prétend pas déterminer la première semaine
affectable. La case opérationnelle correspondante reste ouverte.

Vérification : 616 tests réussis, dont provenance IR et absence de retour déclenché
par zéro/négatif ; syntaxe, archives/routes et versions d’assets valides. Aucun contrôle
médical, changement de règles Sleeper ou workflow n8n. Push du lot précédent jusqu’à
`03e9793` confirmé sur origin/main ; cela ne constitue pas une preuve de déploiement.

Prochain incrément : sourcer la revue/échéance de trade et les kickoffs, puis distinguer
la semaine cible de la première semaine réellement affectable.

## QC-01 — Troisième incrément : fenêtres conditionnelles des trades

26/10/2026. Lecture publique datée des réglages Sleeper : `trade_review_days=1`,
`trade_deadline=12`, `disable_trades=0`, saison 2026. Les kickoffs réutilisent le
chargeur nflverse existant (272 matchs réguliers), sans nouveau fournisseur.
Le contexte borné aux règles et au calendrier public est partagé dans
`/api/player-values`, Finder, partenaires et analyse CLI/n8n ; aucun workflow modifié.

La cible reste un scénario, jamais une confirmation d’exécution. Sous hypothèse
conditionnelle d’un accord maintenant, on modélise la revue en tranches de 24 heures.
L’heure exacte de traitement après revue n’est pas déduite : la documentation Sleeper
évoque un passage ultérieur et le commissaire peut intervenir. Une candidate n’est
ni un retour médical ni une activation IR. Le calendrier conserve sa provenance/date.
Le contexte est refusé après cinq minutes pour ce contrôle ; recharger le Finder
permet de récupérer les réglages. Les données de calendrier gardent le cache existant
(12 heures), donc un changement tardif d’horaire reste une limite.

Pour chaque joueur : kickoff cible et première semaine candidate après la fin de
revue modélisée. Une fenêtre dépassée masque le gain chiffré cible. Le contrôle
porte aussi sur les autres joueurs des deux rosters : l’optimisation avant match
ne peut pas être présentée comme une recomposition réalisable si des matchs ont
commencé ou commencent avant la fin de revue supposée. Ce contrôle conservateur
ne tente pas de reconstruire les lineups figées ni les points « Off Roster ».
Les byes des joueurs conservés sont exclus de ce contrôle ; les projections et
hypothèses de blessure restent vérifiées séparément. La fermeture des nouveaux
trades est reconnue lorsque désactivés ou après la semaine limite ; aucune
transaction déjà acceptée n’est supposée. La frontière exacte de fin du dernier
match de la semaine limite reste à confirmer ; on ne transforme pas un kickoff
en heure de fin de match.

Sources : [effet des trades pendant les matchs](https://support.sleeper.com/en/articles/3351190-how-could-a-weekend-trade-impact-my-team),
[revue et traitement](https://support.sleeper.com/en/articles/3188802-how-to-trade),
[deadline](https://support.sleeper.com/en/articles/2435411-when-is-my-trade-deadline),
[API](https://docs.sleeper.com/). Un joueur déjà passé reste à l’ancienne équipe
pour cette semaine ; l’acquéreur ne récupère pas ses points. Les règles Yahoo
ne sont pas transposées à Sleeper.

Evals : revue franchissant un kickoff, frontière exacte du kickoff, contexte périmé,
règles absentes, calendrier ambigu, deadline désactivée, fermeture, lineup conservée
verrouillée et transmission API. 620 tests réussis, syntaxe et contrôles statiques
valides. Navigateur local : Boukki S7 affiche gain indisponible et fenêtres dépassées.
Pas de preuve de déploiement. Aucun nouveau coefficient de valeur marché.

Reste ouvert : observation d’un trade réellement accepté, instant de traitement
publié, cas des points figés et limite de deadline en cours. La première semaine
alignable confirmée ne doit pas être cochée sur ce seul contrôle conditionnel.

## QC-01 — Quatrième incrément : profondeur catalogue et identités

27/10/2026. La page Équipe nomme désormais l’indicateur « Profondeur par poste ·
base catalogue ». Il additionne les valeurs estimées sur rang expert/ADP pour tous
les joueurs du roster, puis compare leur percentile aux autres rosters. Titulaires,
banc et IR sont inclus. La note distingue cette base des valeurs ROS live du Trade
Hub et des projections de semaine ; aucun nouvel appel réseau ou coefficient.

Les anciens badges Surplus/Besoin sont remplacés par profondeur relative haute/basse.
Les extrema à égalité sont tous conservés ; si tous les postes sont à égalité, aucun
badge n’est attribué. Les champs singuliers de compatibilité sont nuls lorsqu’aucun
poste unique ne se distingue. Une profondeur basse n’est pas un besoin de recrutement
prouvé, ni une profondeur haute un actif échangeable sans impact.

Le calendrier du Game Center étiquette séparément manager confirmé, compte Sleeper et
équipe actuelle. Il réutilise exclusivement les alias déjà confirmés, sans nouvelle
réconciliation ; un compte inconnu n’est pas promu en identité canonique. L’historique
des duels conserve sa clé et son orientation. L’harmonisation de toutes les autres
surfaces reste ouverte.

Vérification : 623 tests réussis, dont extrema à égalité, roster uniforme et séparation
équipe/compte/identité confirmée ou inconnue. Syntaxe et contrôles routes/archives valides.
Aucune donnée Supabase modifiée. La case d’alignement de tous les indicateurs et celle
d’identité globale restent ouvertes ; ce lot ne certifie pas toute l’application.

**Nouvelle anomalie relevée au contrôle navigateur du 27/10.** La page Boukki affiche
un record 2–4 mais un all-play « 19–47–11 sur 77 confrontations, sept semaines » après
passage de l’état NFL en S8. Le total correspond à l’ajout de onze égalités à la
vérification précédente 19–47 sur six semaines. Hypothèse à reproduire sur les lignes
source : scores S7 non synchronisés ou nuls traités comme une semaine terminée.
Ne pas considérer ce résultat comme validé ; prochain correctif QC-01 prioritaire :
fraîcheur/couverture par semaine et cohérence all-play/Power/classement. Ne pas masquer
un vrai score nul ni lancer de synchronisation en production sans validation.

## QC-01 — Cinquième incrément : résultats non confirmés après rollover

27/10/2026. Reproduction en lecture seule sur la requête publique du dossier :
S1–S6 ont chacune 12 lignes et 12 scores non nuls ; S7 a 12 lignes, zéro score
non nul, sans valeurs nulles. Après passage NFL en S8, ces zéros étaient comptés
comme onze égalités all-play par manager. L’hypothèse initiale de conversion de
`null` n’est donc pas la cause de cette capture, même si ce cas est aussi protégé.
Aucune écriture ou synchronisation Supabase n’a été effectuée.

All-play et Power Rankings partagent désormais le contrôle de couverture de chaque
semaine passée : exactement une ligne par manager, valeurs présentes et numériques,
aucune semaine absente entre S1 et la dernière semaine attendue. Une semaine
entièrement à zéro sans preuve explicite `completed=true` sur chaque ligne suspend
la publication avec le motif `score_completion_unverified`. Le connecteur actuel
n’apporte pas ce champ : il faut attendre des scores publiés ou ajouter une preuve
de fin sourcée avant de pouvoir accepter un improbable vrai zéro collectif.
Un zéro individuel et les égalités non nulles sont conservés. Le contrôle ne décide
pas qu’une semaine collective à zéro est forcément fausse : il exige confirmation.

La page Équipe annonce une synchronisation à vérifier au lieu d’un bilan inventé.
La page Power distingue résultats à confirmer, couverture incomplète et seuil initial.
Course aux playoffs et calculs réutilisant ce gate restent suspendus sur cette source.
Les poids Power, scores réels, classements stockés et identités ne changent pas.
Le contrôle compte six semaines validées, mais ne publie pas un classement ancien
comme s’il couvrait S7. Résultats partiels non nuls périmés : toujours une limite
sans métadonnée fiable de complétion ; ce lot ne certifie pas la fraîcheur globale.

Vérification : 627 tests réussis ; contrôles statiques et syntaxe valides. Evals :
rollover sur semaine à zéro, preuve explicite de complétion, zéro individuel, égalités,
valeurs nulles, doublons, semaine/manager manquant, exclusion live/playoffs. La remise
à jour de la source et l’observation du prochain batch restent à vérifier séparément.


## QC-01 — Sixième incrément : audit public de synchronisation

27/10/2026. `npm run audit:sleeper-sync` compare chaque semaine régulière passée aux
scores officiels Sleeper, par roster exact, avec dates des lectures et des lignes stockées.
GET uniquement, configuration publishable publique partagée avec la page Équipe ; aucun
secret serveur lu, aucun appel de synchronisation. Codes de sortie : 0 concordance,
2 vérification requise, 1 source ou contexte invalide. Aucun owner ID exporté.

Capture du 27/10 à 05:59:45 UTC (06:59:45 Paris) : S1–S6 concordent, douze écarts S7
(stockés à zéro). Dernière écriture S7 : 20/10 à 08:00:20 UTC, soit 10:00 Paris.
Le créneau mardi 08:00 UTC documenté est encore à venir lors de cette capture
(09:00 Paris le 27/10) : aucune panne du job affirmée. Les deux synchroniseurs du
dépôt relisent déjà les semaines passées. Logs et exécution n8n restent à contrôler.

L’audit respecte custom_points, y compris zéro, et détecte valeurs manquantes,
couverture absente ou dupliquée et source entièrement à zéro. Une concordance ne
certifie ni fin des matchs ni fraîcheur future ; lectures non atomiques. Tests :
écarts, correction manuelle, couverture, panne source, GET uniquement, exclusion
semaine live et absence d’IDs privés. Aucune écriture de production ni changement
de workflow. Prochaine preuve : nouvel audit après le job et observation des logs.

Vérification de ce lot : 629 tests réussis avec ouverture des serveurs locaux autorisée ;
contrôles statiques et versions d’assets valides. Le premier lancement restreint était
bloqué sur les ports des tests, puis la suite complète a réussi.

## QC-01 — Vérification du rattrapage S7

Audit GET du 27/10/2026 à **15:40:44 UTC (16:40:44 Paris)** : S1 à S7 concordent
sur tous les scores des rosters avec Sleeper (`MATCH`). Le problème des zéros S7
est donc résorbé à cette lecture. Aucun job n’a été relancé par ce chat. Ce résultat
ne constitue pas une lecture des logs n8n ni une preuve de fuseau/exécution du workflow.
Le garde-fou de complétion reste nécessaire pour les prochains rollovers.

## QC-02 — Premier incrément : langage et motifs des recommandations

27/10/2026. L’ancienne affirmation « Naturelle » devient « Gains bilatéraux, marché
proche ». Les autres états décrivent les données manquantes, la perte de lineup ou
la structure à examiner. « Faisabilité / Confiance » devient « Structure estimée /
Fiabilité du calcul », avec absence explicite de probabilité d’acceptation.

Le résultat partagé expose `structure.id`, son libellé, `acceptanceProbability=null`
et `calculationReliability`. Les champs de compatibilité `tradeability` et `confidence`
restent présents, mais leur sens est explicité. La sélection s’appuie sur l’état de
structure, sans changer valeurs, seuils, gains ni ordre de score. Anciennes fixtures
sans état structuré gardées compatibles ; aucun nouvel appel réseau.

Les changements de slots avant/après sont extraits des lineups déjà calculées, sans
nouvelle optimisation. Le Finder affiche ceux du partenaire pour appuyer le motif
sportif sur des joueurs nommés. Coupes, santé et intentions adverses restent à examiner :
un gain calculé n’est pas une offre validée par les deux managers. Le calculateur et
les exports texte/JSON partagent la qualification et les limites. Aucun taux
historique de réussite n’est transformé en taux d’acceptation.

629 tests réussis, dont gains conservés, changements de titulaires et absence de
probabilité inventée ; sélection historique et contrôles statiques valides. Restent
la revue manuelle multi-rosters sur snapshots fixes, profondeur perdue/coupes réelles,
risques de retour et réduction des opportunités principales à 3–5 quand nécessaire.
QC-02 n’est pas déclaré terminé ; publication en production non confirmée.

## QC-02 — Deuxième incrément : coupes, profondeur et cinq offres principales

27/10/2026. Les conséquences sont structurées pour les deux côtés : nombre de places
à libérer, candidats hors titulaires simulés et hors joueurs reçus, joueurs cédés
qui étaient sur le banc simulé. Le nombre de coupes couvre aussi un roster déjà
au-dessus de la capacité ; l’ancien message ne nommait qu’une seule coupe.
La capacité IR reste une hypothèse tirée des statuts, pas la réserve réelle certifiée.
Aucun candidat n’est une instruction de drop, aucun lock/activation n’est confirmé.

Une offre nécessitant une coupe reste À négocier. Candidat protégé Keep/Untouchable
ou nombre de candidats insuffisant : Exploration. Aucun remplacement automatique
de la coupe protégée n’est inventé. Profondeur cédée nommée séparément des gains de
lineup ; son optionalité n’est pas monétisée. Valeurs, projections et seuils inchangés.
Le Finder principal et l’analyse CLI/API sont plafonnés à cinq offres ; les vues
secondaires gardent leurs quinze résultats. Aucun objectif de remplir cinq places.

Capture réelle commune du 27/10 à 15:46 UTC, S8, puis réanalyse hors réseau des douze
rosters : zéro offre principale ; Boukki a une offre À négocier, Estocade cinq.
Les autres offres restent en exploration. Ce n’est pas une validation humaine de
chaque combinaison, ni une comparaison numérique avec les quinze offres historiques.
Exemples inspectés :
- Boukki : DJ Moore contre Carnell Tate + Rhamondre Stevenson, +1,9/+0,2 pts/sem ;
  coupe candidate Alvin Kamara sous hypothèse de capacité IR. Retour de DJ Moore,
  bye de Kamara, couverture perdue et préférence de conservation à examiner.
- Estocade : Kyle Pitts + Stevenson contre Luther Burden, +1,7/+1,0 ; Pitts sort du
  banc simulé, et une coupe Kamara apparaît côté partenaire. Variante Aaron Rodgers :
  même gain mais profondeur QB cédée au lieu de TE. Aucun accord adverse déduit.

630 tests réussis, dont deux coupes sur roster déjà surchargé, préférence protégée,
candidats insuffisants et sélection existante. La revue ne justifie aucun changement
arbitraire de coefficient. Restent : réserve officielle/coupes réellement exécutables,
sensibilité des rosters conservés aux blessures et évaluation sur plusieurs captures.
