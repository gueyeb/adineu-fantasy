# Vue publique, weekly awards et bilan de draft

Date : 7 octobre 2026. État : **V1 codée et testée sur branche, non déployée**. Le bilan de draft et la V1.1 restent au backlog.

## Objectif et références

Donner aux membres et aux visiteurs hors ligue un récit simple de la semaine : qui a gagné, qui a marqué, quels matchs ont été serrés et ce que le calendrier a changé. Les trois captures Sleeper fournies montrent awards, joueurs titulaires/de banc et score réel comparé au maximum théorique. Les deux exports FantasyPros fournis distinguent bilan hebdomadaire et bilan de saison, avec all-play. Référence publique indiquée : https://fantasypros.com/nfl/pg/yoMImI (non accessible avec la recherche web lors de cette lecture ; exports locaux consultés).

Réutiliser `public/assets/weekly-recap.js` et le récap Matchups. Déjà présents : meilleur score, match serré, upset estimé et points laissés sur le banc. Auditer leurs conditions de couverture avant réutilisation : l'implémentation actuelle remplace certaines absences par zéro et choisit un seul gagnant aux égalités. Cette base ne suffit donc pas à certifier tous les awards.

## V1 — awards objectifs et all-play

| Award | Règle | Données nécessaires |
| --- | --- | --- |
| Meilleur score | Maximum des points officiels de la semaine | Tous les scores définitifs |
| Plus faible score | Minimum, zéro et scores négatifs inclus s'ils sont réels | Même couverture |
| Victoire la plus large | Plus grand écart parmi les matchs décidés | Paires officielles complètes |
| Victoire sur le fil | Plus petit écart strictement positif | Même couverture ; égalité séparée |
| Meilleur score dans une défaite | Maximum parmi les perdants | Résultat officiel de chaque match |
| Plus faible score dans une victoire | Minimum parmi les gagnants | Même couverture |
| Victoire malgré le calendrier | Vainqueur avec le plus faible taux all-play, strictement inférieur à 50 % | Tous les scores et résultats |
| Défaite malgré un bon score | Perdant avec le meilleur taux all-play, strictement supérieur à 50 % | Même couverture |

All-play hebdomadaire : comparer chaque équipe aux N−1 autres. Afficher W/L/T ; taux = (W + 0,5 × T)/(N−1). Ce taux est une convention descriptive ADINEU, pas une règle officielle de classement ni une probabilité. L'all-play de saison additionne W/L/T des seules semaines terminées ; ne pas confondre les deux périodes. Aucun award calendrier si aucune équipe ne satisfait la condition.

Tous les ex aequo sont co-lauréats. Les noms publics restent ceux déjà approuvés pour le site. Ton convivial, sans présenter un faible score comme une preuve d'incompétence.

## V1.1 — joueurs et efficacité de lineup

- MVP par poste QB/RB/WR/TE/K/DEF : meilleur score **parmi les titulaires de la ligue cette semaine**, FLEX classé au poste NFL. Les agents libres et joueurs de banc ne sont pas dans cet univers.
- Joueurs du banc par poste : même principe sur les joueurs non titularisés et hors IR. Lire le roster historique de la semaine, jamais le roster courant après transactions.
- Tableau performance : score officiel, maximum théorique sur le roster de cette semaine et écart. Maximum sous contraintes de slots/éligibilité réelles ; données manquantes ou incohérence score/max ⇒ ratio indisponible.
- Efficacité = score réel / maximum × 100 seulement si maximum > 0 et couverture complète. Ne pas borner artificiellement un ratio pour cacher une incohérence. Label « efficacité de lineup après match », pas « meilleur manager » ni « précision prédictive » : blessures et événements imprévisibles affectent le résultat.
- Les projections historiques doivent être capturées avant kickoff pour sur/sous-performance ou upset. Une projection disponible aujourd'hui ne prouve pas ce qui était prévu avant le match. Supprimer ces awards si le snapshot ou sa couverture manque.

## Vue publique simple — Cette semaine dans ADINEU

V1 proposée : enrichir l'accueil existant, avec lien stable vers la semaine dans Matchups ; une route supplémentaire n'est nécessaire que si elle améliore réellement le partage.

Ordre de lecture :
1. Une phrase sur la ligue : 12 équipes, NFL fantasy, PPR, huit places en playoffs ; semaine et date de mise à jour.
2. Résultats de la dernière semaine terminée : vainqueur, adversaire, score et marge ; liens vers les matchs.
3. Quatre à six cartes awards prioritaires ; autres awards accessibles dans le récap.
4. Classement officiel W/L/T et points marqués ; all-play séparé et expliqué en une phrase.
5. Prochaines affiches, si publiées dans Sleeper, avec un lien vers archives/champions pour découvrir la ligue.

Sans compte ni connexion Sleeper. Mobile lisible. Expliquer PPR et all-play à la demande. Afficher « semaine en cours » séparément ; ne jamais attribuer ses awards avant clôture. Les rectifications officielles recalculent le récap avec une nouvelle date de mise à jour.

La page expose uniquement résultats, noms publics, calendrier, agrégats et awards calculés à partir des données publiques déjà utilisées par le site. Ne pas publier secrets, identifiants techniques de managers, préférences KEEP/SHOP, plans Coach, enchères privées/pending, notes personnelles ou stratégies de Boukki. Conserver les contrôles d'accès du Coach. Ne pas importer les avatars/photos des captures comme nouveaux assets sans décision explicite.

## Nice-to-have après saison — notes de draft

Attendre la fin de la saison fantasy définie dans Sleeper. Reconstituer l'ordre et les picks réels ; afficher pick, joueur, points pendant la période retenue, rang final au poste et écart aux attentes si une référence pré-draft datée existe. Les absences, trades, coupes et acquisitions doivent être distingués.

Deux bilans distincts : rendement des joueurs sélectionnés sur la saison et contribution de ces joueurs aux lineups de leur manager pendant leur détention. Un joueur coupé ou échangé ne continue pas à créditer artificiellement son drafteur dans le second bilan. Waivers et trades ne deviennent pas du rendement de draft. Sans référence pré-draft comparable, rester descriptif ; aucune note A/F ou score global inventé. Si un score est ajouté plus tard, publier sa formule et vérifier sa sensibilité aux picks, postes et blessures.

## Acceptation et ordre de livraison

1. Awards + all-play dans le récap partagé : semaines terminées seulement, toutes les équipes couvertes, ex aequo, score zéro réel, égalités et correction de scores testés. Comparer S4 aux pièces fournies comme vérification secondaire, Sleeper restant la source canonique.
2. Vue visiteurs : accueil lisible et partageable sans login, aucun chargement de données Coach ; vérifier desktop/mobile et séparation semaine terminée/live.
3. MVP/banc/efficacité : historique complet, contraintes légales, zéro distinct de données absentes, aucune IR incluse. Supprimer métriques non couvertes.
4. Bilan de draft : backlog après saison, dépendant de la reconstruction des picks et de la période exacte. Garder la fiabilité du moteur de décision prioritaire pendant la saison.

Tests futurs : 12 équipes ⇒ 11 comparaisons all-play par équipe ; nombre total de victoires égal aux défaites ; égalités comptées symétriquement ; tous les ex aequo conservés ; absence de match décidé ⇒ pas de carte victoire ; couverture manquante ⇒ award indisponible ; maximum nul ⇒ ratio n/d ; aucune projection post-match présentée comme snapshot pré-match.

## Livraison V1 locale

`weekly-awards.js` calcule les huit catégories objectives et l'all-play hebdomadaire. Les scores nuls et négatifs sont inclus ; données absentes, équipes dupliquées, paires incomplètes ou semaine non terminée suspendent tous les awards. Les ex aequo sont tous affichés. Le rendu est partagé entre accueil et Matchups/Récap ; la semaine du récap est encodée dans `?week=N#recap` pour le partage.

`public-week.js` lit uniquement league/rosters/users/state/matchups dans l'API publique Sleeper. Le bilan de saison reprend W/L/T et points marqués, avec ordre de lecture explicite victoires/points, sans inventer un rang officiel. Les données Coach et enchères privées ne sont ni chargées ni affichées. L'accueil existant conserve ses archives et navigation ; son nouveau bloc charge indépendamment et peut échouer sans masquer le reste.

Le récap publié ne reprend plus l'ancien upset calculé à partir de projections relues après match ni le panneau de points de banc dont la couverture historique n'était pas contrôlée. Le module historique `weekly-recap.js` est conservé ; l'efficacité et le banc restent pour la V1.1 avec données vérifiées. Ce changement retire des métriques insuffisamment justifiées, pas une mesure certifiée.

Validation : 406 tests passent, contrôles statiques et versions d'assets réussis. Les six tests dédiés couvrent les 11 comparaisons, symétrie W/L, égalités, vrais zéros, valeurs absentes, semaine live, saisons/périodes et absence de ressources Coach. Lecture live S4 : 12 équipes et huit catégories couvertes ; Gridiron gang meilleur score, Estocade victoire sur le fil et calendrier favorable, Binaries meilleur score en défaite et défaite malgré un bon score. Le navigateur cloud refuse localhost (`ERR_BLOCKED_BY_CLIENT`) : vérification visuelle desktop/mobile encore ouverte, aucun screenshot validé.
