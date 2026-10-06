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
- [x] Réintégrer les joueurs récemment coupés dans l’analyse suivant la propriété courante ; les classer WAIVER_LOCKED/UNKNOWN tant que le déblocage n’est pas vérifié.
- [x] Conserver les candidats sans projection/statistiques lorsqu’un événement sourcé les rend pertinents. Ajouter motifs d’entrée, exclusions et couverture du pool ; absence de projection reste null et bloque le gain chiffré.
- [x] Définir un ripple équipe/poste depuis le snapshot Sleeper et les événements datés. Réévaluer les joueurs affectés, sans attribuer une part de cibles ou une succession inventée. Une acquisition fantasy n’est pas une modification du depth chart NFL.
- [x] Reproduire le cas Kamara, enrichir les données du roster nécessaires à son coût de coupe et expliquer chaque composante ; aucune constante spécifique au nom du joueur.
- [x] Évaluer séparément l’action courante GAME_LOCKED et un scénario au prochain déblocage vérifié. Horizon, couverture et FAAB indicatif distincts ; aucun gain futur inventé ni ADD_NOW avant déblocage.

### Livraison P0 du 6 octobre 2026 (locale, non déployée)

- **Coupes récentes** (`findRecentDrops`) : dernier mouvement complet sur 72 h = DROP. Le joueur entre dans le pool (`poolEntry.reasons` contient `RECENT_DROP`), reste au board au-delà de la limite par poste (`pinned`) et porte `RECENT_DROP_CLEARANCE_UNVERIFIED` tant qu’aucune preuve postérieure ne dit `WAIVER_LOCKED`/`FREE_AGENT`. Un ADD ultérieur → `ROSTERED`. Le résumé des transactions affiche la disponibilité résolue, plus `UNKNOWN` en dur.
- **Pool** (`poolCoverage`) : motifs d’entrée (`PROJECTION`, `RANK_FALLBACK`, `RECENT_STATS`, `SOURCED_EVENT`, `ROLE_EVIDENCE`, `RECENT_DROP`), exclusions comptées (`ROSTERED`, `INACTIVE_OR_NO_NFL_TEAM`, `NON_FANTASY_POSITION`, `STATUS_ALERT`, `NO_PROJECTION_OR_STATS`), évalués / affichés / maintenus. Sans projection : `valuationCovered=false`, `rosPpg`, `effectivePpg`, `faabMarket`, `surplusPoints` à `null`, blocage `NO_PROJECTION`, gain `null`. Un statut ALERT n’entre que par événement sourcé ou coupe récente.
- **Ripple** (`public/assets/team-position-ripple.js`) : déclencheurs `SNAPSHOT_STATUS` (statut bloquant Sleeper) et `SOURCED_EVENT` (`eventsById` du fichier de preuves : `type`, `nflTeam`, `positions`, `source`, `observedAt`, `expiresAt`). Effet unique `REEVALUATE`, `shareAttributed=null`, `successionInferred=false`. Équipe différente du snapshot → `EVENT_TEAM_MISMATCH` ; groupe non sourcé → `EVENT_GROUP_UNSOURCED`. Les transactions fantasy ne sont pas une entrée.
- **Kamara — reproduction du 5–6 octobre** (roster t0z, S4, 72 candidats) : désigné 60 fois. Deux causes, aucune liée à sa projection : (1) A.J. Brown, en slot IR, sans projection S5–S7, rendait tout l’horizon non couvert → tous les gains `null` → le tri retombait sur l’ordre lexical des IDs Sleeper, et `4035` est le plus petit du roster ; (2) avant le Monday Night, il était le seul joueur non verrouillé. Corrections : aucune coupe désignée sans comparaison couverte (`cutSelection=UNRANKED_INCOMPLETE_COVERAGE`), `ONLY_ELIGIBLE_CUT` + `cutExclusions` quand la contrainte fait le choix, `coverageBlockers` nomme le joueur bloquant, `dropCostComponents` détaille usage / buy-low / upside de projection / option totale / perte après rôle avec les entrées lues (snaps, opportunités, tendance) et les entrées manquantes (`regretRisk=UNKNOWN`, plus `LOW`). Au scénario S5, la coupe comparée devient Worthy pour 42 candidats.
- **Hypothèse nouvelle à valider** : les joueurs en slot réserve sont exclus des lineups simulées (`RESERVE_PLAYERS_NOT_STARTABLE`), donc leurs projections absentes ne bloquent plus l’horizon. Un retour d’IR pendant l’horizon n’est pas modélisé.
- **GAME_LOCKED** (`nextUnlockScenario`) : l’action courante reste bloquée (`GAME_LOCKED` dans `actionBlockers`, enchère 0). Scénario distinct recalculé depuis la semaine suivante si le calendrier la couvre : `startWeek`, `firstKickoffAt`, horizon propre (une location consomme la semaine verrouillée ; `ROLE_WINDOW_ENDS_BEFORE_UNLOCK` si elle s’y termine), couverture propre, `indicativeMaxBid` non exécutable. `unlockVerified` exige une preuve datée ; sinon `UNLOCK_UNVERIFIED`. La fourchette marché reste celle de la semaine courante (`marketRangeBasis`).
- Tests : `test/live-state-regressions.test.js`, `test/team-position-ripple.test.js`. Régressions 2, 4, 5, 6 couvertes par fixtures fictives ; 1 (Harris → Jennings) et 3 (Coleman/Moore) attendent une fixture sourcée et le P1.

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
