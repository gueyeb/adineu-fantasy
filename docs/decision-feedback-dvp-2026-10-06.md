# Échange Boukki / DvP — améliorations du 6 octobre 2026

Entrées : export AI Context S5 daté 2026-10-06T20:48:07.789Z et commentaire humain proposant Coleman/Harris/DEF. L’export texte est tronqué dans les notes de provenance. Il n’est pas un snapshot complet rejouable et ne remplace pas les preuves du modèle. Les montants 47/23 dollars sont des préférences proposées dans cet échange, pas des coefficients ni des overrides approuvés à appliquer.

## État et divergence de versions

Les modifications Claude locales sont prises en compte : ripple, motifs d’entrée du pool, profils de rôle, coûts de coupe et scénarios de déblocage figurent désormais dans le code. L’export reçu montre encore des transactions brutes et n’expose pas tous ces champs. Vérifier la version du générateur avant de conclure qu’un correctif local est absent. Aucun déploiement dans cette étape.

## Correction livrée : streaming inconnu n’est pas IGNORE

Une DEF/K/QB avec delta cible positif mais horizon incomplet est désormais classée STREAMER / WATCH même si sa valeur stratégique est faible. Les blocages de disponibilité et couverture restent explicites ; aucun ADD_NOW, plafond spéculatif ou gain total n’est inventé. Un scénario entièrement couvert dont le net est négatif peut toujours être IGNORE. Ceci corrige le cas DEF EMPTY avec delta 5,9–8,3 et couverture future manquante ; ce n’est pas encore une évaluation autonome de streaming S5.

## Prochains changements

- [x] Scénario d’urgence pour compléter un slot QB/K/DEF structurellement vide : horizon cible d’une semaine, indépendant de la comparaison ROS ; coupe permanente évaluée séparément et aucun verrou ignoré. Faire apparaître l’urgence DEF dans Coach même quand les acquisitions restent bloquées.
- [x] Portefeuille de claims alternatifs : un choix puis son repli sur la même coupe/date, branches gagnant/repli/tous échoués, suite et budget recalculés. La DEF utilise la place libre une seule fois par branche, avant ou après les claims selon sa disponibilité. Maximum de dépense explicite sur les scénarios détaillés ; `null` si exploration partielle. Aucune annulation automatique supposée. [Contrat et limites](conditional-claim-portfolio-2026-10-07.md).
- [ ] Option spéculative : séparer strategicUpside, perte de la coupe, speculativeCeiling et plafond basé sur un gain de lineup couvert. Un rôle unconfirmed ne devient pas confirmé parce que Market est élevé. Pas de prix non nul uniquement fondé sur une performance récente ; seuils et calibration à définir.
- [x] TE2 : expliquer semaine de bye du titulaire, possibilité FLEX, rôle de secours et valeur nette de la place de banc. Un marché élevé pour Hockenson ne suffit pas à justifier une acquisition derrière McBride.
- [ ] Rotation WR/FLEX : les mouvements Puka vers WR1 et Moore vers FLEX sont couplés. Afficher le remplacement global Wicks → Moore (+1,7), puis les affectations de slots, sans présenter +12,7 et −11 comme décisions indépendantes.
- [ ] Projections manquantes : identifier joueur + semaine + cause ; distinguer un bye confirmé d’un échec de chargement et d’une absence dans la source. Ne pas contourner une projection manquante par zéro.
- [ ] Provenance compacte : garder les données détaillées dans le JSON et résumer couverture/source/date dans le texte plutôt que dupliquer toutes les semaines de tous les joueurs.

## Contrat DvP à préparer avant intégration

Source consultée le 6 octobre : https://thefantasyfellowship.com/fantasy-points-allowed/. La page décrit des points fantasy concédés par poste ; QB annonce 4 points par TD à la passe et les tables RB/WR/TE distinguent PPR/half/standard. Ses tableaux ne sont pas des mesures de sacks/turnovers de DEF. Aucun chiffre n’est injecté dans le modèle ici.

Requis : version/saison/semaines achevées, nombre de matchs par défense/poste, scoring compatible avec la ligue, date de capture, source numérique, rapprochement des équipes et adversaire du calendrier. Vérifier adversaires déjà affrontés et petit échantillon avant d’interpréter un rang comme force intrinsèque. Pas de multiplicateur « volume × matchup » arbitraire ni double comptage d’un matchup déjà présent dans les projections Sleeper. DvP reste d’abord contexte explicatif, ne confirme ni rôle ni disponibilité.

## Règles qui restent applicables

SELL_HIGH Raymond ne signifie pas couper ; comparer optionalité, alternatives et horizon de l’ajout. Les preuves de disponibilité et rôle ne sont pas remplacées par une appréciation humaine non sourcée. Les préférences de conservation individuelles ne sont pas appliquées à partir du commentaire attaché. L’état 1–3/497 dollars est celui de l’export fourni, pas une vérification live actuelle.

Validation : défaut STREAMER/IGNORE reproduit avant correction, test du cas incomplet et du scénario négatif couvert ; **324 tests passent**, contrôles statiques, 42 assets à jour et whitespace réussis. Aucun push ni déploiement.

## Livraison : slot vide, horizon hebdomadaire

`starterVacancyScenario` compare le remplissage d’un QB/K/DEF absent de la lineup réalisable depuis le roster actif (IR exclu). Le scénario ne confond pas un joueur déjà disponible sur le banc avec une acquisition nécessaire. Les slots verrouillés restent fixes. Le fit principal prend cet horizon cible d’une semaine (`decisionHorizon=TARGET_WEEK_SLOT_FILL`), alors que `rosFit` conserve séparément horizon, couverture, gain net et blocages du scénario ROS. Les preuves de durée de rôle et le marché ne sont pas modifiés (`roleDurationChanged=false`). Il s’agit d’une fenêtre de décision, pas d’une confirmation de rôle d’une semaine.

Avec une place libre, les projections futures ne sont pas requises pour chiffrer le gain S5. Si une coupe est nécessaire, sa perte de lineup après cette semaine reste évaluée sur la saison : manque de couverture = gain net inconnu, aucune action. Les coûts d’option/préférence et les protections de progression restent appliqués. Les projections cibles manquantes, les joueurs réservés, la propriété, le kickoff et les promotions non confirmées gardent leurs blocages. Aucun déblocage ni projection zéro n’est inventé.

Le plan privilégie un slot vide à heure d’exécution égale, puis recalcule roster et budget. Il reste glouton et conditionnel. Coach priorise une option par slot vide, puis laisse de la place aux autres postes dans la watchlist. Les exports IA affichent les scénarios hebdomadaires à part ; métriques canoniques identiques dans les trois outils. Une disponibilité inconnue reste WATCH, même si le gain S5 est connu.

Portée : slots structurellement vides QB/K/DEF ; un titulaire OUT encore présent, les slots RB/WR/FLEX restent des cas distincts. Les groupes de claims alternatifs sont livrés dans la suite du 7 octobre, indépendamment de ce scénario hebdomadaire. Ce changement ne résout pas toutes les acquisitions à horizon incomplet.

Validation : **330 tests passent**, dont absence de projection S7 avec gain S5 conservé, coupe permanente bloquée faute de couverture future, disponibilité/projection cible inconnue, position déjà pourvue, parité des métriques, priorité opérationnelle et watchlist multi-postes. Contrôles statiques, 42 assets et whitespace réussis. Aucun push ni déploiement.


## Livraison du 7 octobre : claims alternatifs

Le plan conserve les acquisitions successives légales avec des coupes distinctes. Les vrais replis sur la même ressource/date ont des scénarios exclusifs : premier choix acquis, repli acquis après échec/renoncement, ou aucun acquis. Roster, fenêtres de rôle et budget sont recalculés par branche ; un repli plus cher peut empêcher l’étape suivante. Coach/n8n expliquent le groupe et son maximum sans doubler les recommandations individuelles. Exploration bornée, limites exportées, pas de garantie d’annulation plateforme. [Détails, exemples de test et evals](conditional-claim-portfolio-2026-10-07.md).

Validation de cette suite : **354 tests passent**, syntaxe, contrôles statiques, 42 assets et whitespace réussis. Aucun push ni déploiement.

### 07/10 — Diagnostic TE livré localement

Le candidat explique ses semaines projetées en TE/FLEX, le bye du titulaire dans la durée du rôle et le gain net après coupe. Référence au slot TE déclaré, réserves exclues ; données insuffisantes et secours sur blessure future restent non chiffrés. Les rotations TE vers FLEX utilisent le gain global de lineup. La valeur comparative d’une autre acquisition reste inconnue : une place libre n’est pas déclarée sans coût d’opportunité. [Contrat et validations](te-roster-utility-2026-10-07.md). Le chantier général WR/FLEX reste ouvert.
