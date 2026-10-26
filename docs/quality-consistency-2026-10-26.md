# ADINEU Quality & Consistency

26/10/2026 — feedback utilisateur intégré à la roadmap. Statut : consolidation
priorisée ; aucun correctif de cette phase ni contrôle de production livré par ce cadrage.

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
- [ ] All-play : partager les matchups et la règle de semaines complètes ; distinguer
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
- [ ] Heure de waivers : une source opérationnelle datée et vérifiée prime sur le
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
