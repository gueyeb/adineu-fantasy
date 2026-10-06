# Échange Boukki / DvP — améliorations du 6 octobre 2026

Entrées : export AI Context S5 daté 2026-10-06T20:48:07.789Z et commentaire humain proposant Coleman/Harris/DEF. L’export texte est tronqué dans les notes de provenance. Il n’est pas un snapshot complet rejouable et ne remplace pas les preuves du modèle. Les montants 47/23 dollars sont des préférences proposées dans cet échange, pas des coefficients ni des overrides approuvés à appliquer.

## État et divergence de versions

Les modifications Claude locales sont prises en compte : ripple, motifs d’entrée du pool, profils de rôle, coûts de coupe et scénarios de déblocage figurent désormais dans le code. L’export reçu montre encore des transactions brutes et n’expose pas tous ces champs. Vérifier la version du générateur avant de conclure qu’un correctif local est absent. Aucun déploiement dans cette étape.

## Correction livrée : streaming inconnu n’est pas IGNORE

Une DEF/K/QB avec delta cible positif mais horizon incomplet est désormais classée STREAMER / WATCH même si sa valeur stratégique est faible. Les blocages de disponibilité et couverture restent explicites ; aucun ADD_NOW, plafond spéculatif ou gain total n’est inventé. Un scénario entièrement couvert dont le net est négatif peut toujours être IGNORE. Ceci corrige le cas DEF EMPTY avec delta 5,9–8,3 et couverture future manquante ; ce n’est pas encore une évaluation autonome de streaming S5.

## Prochains changements

- [ ] Scénario d’urgence pour compléter un slot : horizon cible d’une semaine, indépendant de la comparaison ROS ; coupe permanente évaluée séparément et aucun verrou ignoré. Faire apparaître l’urgence DEF dans Coach même quand les acquisitions restent bloquées.
- [ ] Portefeuille de claims alternatifs : Coleman puis Harris avec la même coupe constituent un groupe de fallback, pas deux ajouts supposés gagnés. Conserver ordre, budget maximal exposé, dépendances et raisons d’échec. Ne pas promettre une annulation automatique sans règles plateforme vérifiées. Ajouter ensuite la DEF avec la place libre, sans consommer deux fois cette place.
- [ ] Option spéculative : séparer strategicUpside, perte de la coupe, speculativeCeiling et plafond basé sur un gain de lineup couvert. Un rôle unconfirmed ne devient pas confirmé parce que Market est élevé. Pas de prix non nul uniquement fondé sur une performance récente ; seuils et calibration à définir.
- [ ] TE2 : expliquer semaine de bye du titulaire, possibilité FLEX, rôle de secours et valeur nette de la place de banc. Un marché élevé pour Hockenson ne suffit pas à justifier une acquisition derrière McBride.
- [ ] Rotation WR/FLEX : les mouvements Puka vers WR1 et Moore vers FLEX sont couplés. Afficher le remplacement global Wicks → Moore (+1,7), puis les affectations de slots, sans présenter +12,7 et −11 comme décisions indépendantes.
- [ ] Projections manquantes : identifier joueur + semaine + cause ; distinguer un bye confirmé d’un échec de chargement et d’une absence dans la source. Ne pas contourner une projection manquante par zéro.
- [ ] Provenance compacte : garder les données détaillées dans le JSON et résumer couverture/source/date dans le texte plutôt que dupliquer toutes les semaines de tous les joueurs.

## Contrat DvP à préparer avant intégration

Source consultée le 6 octobre : https://thefantasyfellowship.com/fantasy-points-allowed/. La page décrit des points fantasy concédés par poste ; QB annonce 4 points par TD à la passe et les tables RB/WR/TE distinguent PPR/half/standard. Ses tableaux ne sont pas des mesures de sacks/turnovers de DEF. Aucun chiffre n’est injecté dans le modèle ici.

Requis : version/saison/semaines achevées, nombre de matchs par défense/poste, scoring compatible avec la ligue, date de capture, source numérique, rapprochement des équipes et adversaire du calendrier. Vérifier adversaires déjà affrontés et petit échantillon avant d’interpréter un rang comme force intrinsèque. Pas de multiplicateur « volume × matchup » arbitraire ni double comptage d’un matchup déjà présent dans les projections Sleeper. DvP reste d’abord contexte explicatif, ne confirme ni rôle ni disponibilité.

## Règles qui restent applicables

SELL_HIGH Raymond ne signifie pas couper ; comparer optionalité, alternatives et horizon de l’ajout. Les preuves de disponibilité et rôle ne sont pas remplacées par une appréciation humaine non sourcée. Les préférences de conservation individuelles ne sont pas appliquées à partir du commentaire attaché. L’état 1–3/497 dollars est celui de l’export fourni, pas une vérification live actuelle.

Validation : défaut STREAMER/IGNORE reproduit avant correction, test du cas incomplet et du scénario négatif couvert ; **324 tests passent**, contrôles statiques, 42 assets à jour et whitespace réussis. Aucun push ni déploiement.
