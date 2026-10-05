# Decision Engine — propagation du contexte live

Retour ajouté le 5 octobre 2026 depuis le document « Corrections ADINEU — Waiver / Decision Engine ». Ce document complète le backlog existant ; les demandes ci-dessous ne sont pas encore toutes implémentées. Les exemples Week 4 constituent des cas de régression à reconstruire, pas des faits NFL certifiés ni des overrides à appliquer directement.

## État constaté dans le code

- Transactions : collecte récente, invalidation des preuves d’accès périmées et relecture de propriété existent. Résolution nominative livrée le 5 octobre : joueurs, équipe fantasy, manager, statut et propriété courante ; IDs conservés. Un DROP ne prouve pas FREE_AGENT : propriétaire courant et éventuel waiver lock restent déterminants.
- Pool : `decision-features.js` parcourt déjà l’index Sleeper complet, avec catalogue en repli. Mais les filtres excluent les joueurs en statut ALERT et ceux sans projection/rang ni match statistique. L’évaluation de tous les joueurs disponibles et leur présence dans un board limité sont deux garanties différentes.
- News : le groupe équipe/poste et les blessures peuvent produire des événements heuristiques. Cela ne constitue ni un depth chart sourcé ni une propagation complète des événements, retours et changements de rôle. Une promotion doit toujours être confirmée.
- Coupe : les scénarios ajout–coupe, perte de lineup permanente, option d’usage et BUY_LOW existent. La progression du rôle, rareté et optionalité contingente ne sont pas encore décomposées comme demandé. La récurrence de Kamara comme coupe doit être reproduite avec les données réellement utilisées.
- Fit marginal : la comparaison de lineups tient déjà compte de la redondance avec le titulaire, notamment TE2/QB2. Ne pas soustraire une seconde pénalité représentant exactement la même perte déjà mesurée.
- GAME_LOCKED : marché et action sont déjà distincts ; le calcul de fit reste contraint à la semaine verrouillée et ne constitue pas une estimation indépendante du prochain déblocage. Une valeur indicative future nécessite un horizon et des projections explicites.
- Horizons : durée confirmée commune au marché/fit et propagation de la fenêtre dans les plans livrées. Le mélange entre progression organique et promotion temporaire reste à traiter.
- Contrôles : audits archivés disponibles, mais les sanity checks demandés avant publication restent à ajouter.

## P0 — prochaine implémentation

- [x] Résoudre ADD/DROP en noms joueur, équipe fantasy et manager, avec IDs conservés pour la traçabilité. Afficher UNKNOWN si non résolu ; exposer le même résumé dans le bulletin et AI Context.
- [ ] Réintégrer les joueurs récemment coupés dans l’analyse suivant la propriété courante ; les classer WAIVER_LOCKED/UNKNOWN tant que le déblocage n’est pas vérifié.
- [ ] Conserver les candidats sans projection/statistiques lorsqu’un événement sourcé les rend pertinents. Ajouter motifs d’entrée, exclusions et couverture du pool ; absence de projection reste null et bloque le gain chiffré.
- [ ] Définir un ripple équipe/poste depuis le snapshot Sleeper et les événements datés. Réévaluer les joueurs affectés, sans attribuer une part de cibles ou une succession inventée. Une acquisition fantasy n’est pas une modification du depth chart NFL.
- [ ] Reproduire le cas Kamara, enrichir les données du roster nécessaires à son coût de coupe et expliquer chaque composante ; aucune constante spécifique au nom du joueur.
- [ ] Évaluer séparément l’action courante GAME_LOCKED et un scénario au prochain déblocage vérifié. Horizon, couverture et FAAB indicatif distincts ; aucun gain futur inventé ni ADD_NOW avant déblocage.

## P1 — optionalité et cohérence

- [ ] Ajouter une distinction de profil de rôle : PURE_RENTAL, INJURY_PROMOTION_WITH_EXISTING_ROLE, ROLE_EXPANSION, BREAKOUT, UNCERTAIN. Conserver DecisionClass et l’horizon confirmé comme dimensions distinctes.
- [ ] Décomposer Emerging Role Option Value depuis tendances snaps/cibles/opportunités datées et comparables. Routes inconnues restent null ; aucun proxy snap → routes.
- [ ] Comparer le coût de sacrifier une progression organique au bénéfice d’une location ; n’autoriser cette coupe que si le bénéfice net documenté la justifie. Pas d’interdiction absolue ni de poids présenté comme calibré sans évaluation.
- [ ] Ajouter les avertissements de cohérence : coupe trop concentrée, news sans effet explicable, progression ignorée, candidat pertinent absent du board, BUY_LOW non représenté. Distinguer incohérence de calcul, manque de couverture et recommandation WATCH justifiée par coût de coupe.

## P2 — validation des durées

- [ ] Évaluer les profils de rôle contre snapshots pré-match et résultats 2/4 semaines, incluant WATCH/IGNORE. Définir ensuite les pondérations et seuils à partir de cette évaluation.

## Régressions et critères de validation

1. Harris → Jennings : fixture sourcée montrant progression préalable versus absence temporaire ; vérifier décomposition d’option et comparaison nette, sans inventer de rendement futur.
2. Kamara : faible projection seule ne suffit pas à le désigner systématiquement ; comparer plusieurs coupes avec usage, tendances et sources visibles.
3. Coleman / blessure Moore : réévaluation seulement si les sources établissent un groupe NFL affecté ; un nom ou un exemple textuel ne prouve pas qu’ils partagent un depth chart.
4. Douglas : événement de retour/changement daté, projection absente ; joueur analysé et éventuellement WATCH, pas de gain chiffré fictif.
5. Washington/Wilson : ADD par un autre roster exclut le joueur selon l’état de propriété courant ; noms et managers visibles dans le contexte. DROP ne garantit pas ajout libre.
6. GAME_LOCKED : action bloquée, marché conservé ; scénario futur daté et couvert seulement si le prochain horizon est connu.
7. Invariant : même joueur, roster, snapshot et horizon donnent les mêmes métriques pour Coach, Waiver et AI Context ; les explications doivent rendre les objectifs différents lisibles.

Validation de cette mise à jour : comparaison du retour avec les parcours de collecte, extraction de features, fit et plans existants. Aucun calcul modifié, aucune affirmation de livraison de ces cases, aucun déploiement.
