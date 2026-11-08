# Revue ADIN — 8 novembre 2026

## Mise à jour après reconnexion Plane

Reconnexion OAuth `plane-dakhine` réussie dans cette session ; workspace confirmé
`dakhine-hq` / Dakhine HQ, projet ADIN retrouvé. Les limites d'accès relatées
ci-dessous décrivent la première passe, désormais résolues.

Descriptions et critères des 14 tickets lus. Preuves ajoutées à ADIN-7, ADIN-8,
ADIN-9, ADIN-10, ADIN-13 et ADIN-14, sans clôture prématurée : les validations
opérationnelles et mobiles restent ouvertes. Deux suivis créés après recherche
des doublons : ADIN-15 (revue projections/FAAB S9–S10, contrôle prévu le 10/11)
et ADIN-16 (benchmark experts après quatre semaines valides, revue possible le
17/11). Les suivis d'adoption du journal et de livraison restent dans les tickets
existants. Créations et descriptions relues dans Plane après écriture.

Audit du dépôt et lectures seules de Supabase production `adineu-fantasy`.
Les quatre intitulés ADIN proviennent de la demande utilisateur : leurs descriptions,
commentaires et critères Plane n'ont pas pu être lus. Le connecteur Plane disponible
expose quatre projets d'un autre espace, aucun ADIN ; les identifiants renvoient 404.
L'hôte d'accès navigateur est indisponible. Aucun ticket Plane créé ou modifié.

## Comparatifs effectivement disponibles

`model_feedback`, saison 2026, S8 : rapport généré le 03/11 à 09:00:29 UTC.
Snapshot hebdomadaire S9 présent le 03/11 à 09:00:31 UTC.

| Horizon de projection | Cohorte identique | MAE Sleeper | MAE Adineu | Lecture S8 |
| --- | ---: | ---: | ---: | --- |
| 2 semaines | 60 | 5,43 | 5,77 | Adineu moins précis |
| 3 semaines | 135 | 5,12 | 5,17 | Adineu légèrement moins précis |
| 4 semaines | 121 | 4,73 | 4,66 | Adineu légèrement plus précis |

MAE en points, plus bas = mieux. Ces cohortes diffèrent entre horizons ; ne pas
additionner les lignes comme autant de joueurs uniques. Le détail par poste existe
dans le rapport. Une seule semaine évaluée ne justifie pas de changer les poids.

FAAB S8 : 29 enchères notées sur 31 ; Brier 0,218 contre 0,248 pour le taux constant
(plus bas = mieux). Couverture p25–p75 de la meilleure enchère rivale : 79 % sur
24 cas contestés, pour une cible de 50 %. Résultat favorable sur le Brier, mais
fourchettes à surveiller. Fourchette de prix des gagnants : 13 claims couverts sur
15, seulement 15,4 % dans la fourchette ; ce dernier indicateur est descriptif et
distinct de la probabilité de gagner contre les enchères rivales.

Benchmark experts : captures S7 le 25/10 et S8 le 01/11 ; rapport S8 SCORED,
cumul de deux semaines. FantasyPros disponible ; Draft Sharks/CBS NOT_CONFIGURED.
Adineu = Sleeper à horizon 0 : ce benchmark ne prouve pas un avantage du mélange
usage ROS. Le seuil de quatre semaines n'est pas encore atteint.

## Journal réel

Validation détaillée supplémentaire du 08/11, ajoutée à ADIN-10 :

| Cas | À 2 semaines | À 4 semaines | Points effectivement alignés sur la fenêtre lue |
| --- | ---: | ---: | ---: |
| Hockenson, claim S5 à 21 $ sans coupe | 1,7 | 31 | 1,7 |
| Tre' Harris, claim S5 à 27 $ sans coupe | 3,6 | 9,7 | 3,6 |

Ces points produits ne mesurent pas le gain marginal de la lineup : sans coupe,
le net des mouvements égale la production brute du joueur. Germie Bernard S7 :
claim 41 $ perdu contre 250 $, net et points alignés restent null. Bo Nix S7 non
suivi : +20,18 pts de lineup optimale a posteriori sur S7–S8, coupe non enregistrée ;
ce n'est pas un gain réalisé ni la preuve qu'il était disponible. Trade S7 : non
évaluable, option non enregistrée.

Audit global roster 1 : zéro claim perdu avec net chiffré ; zéro bilan à deux
semaines prématuré en S8/S9 ; zéro bilan à quatre semaines prématuré depuis S6,
avec S8 comme dernière semaine complète. Les 24 tests ciblés journal/mouvements/
contrefactuels passent. Volet données validé ; rendu mobile privé et adoption des
choix explicites restent ouverts. Aucune écriture en production.

`decision_log`, saison 2026, roster 1 : synchronisation des mouvements au 05/11
08:00:45 UTC. Des champs `outcome.reviews.weeks2` sont renseignés jusqu'à S7,
et `weeks4` jusqu'à S5. Les claims perdus ont aussi une structure de bilan :
sa présence ne signifie ni acquisition exécutée ni gain net réalisé.
S8/S9 n'ont pas encore de bilan complet à deux semaines dans cette lecture.

Plans MODEL_PLAN S7, S8 et S9 présents, mais `details.choices` absent pour les trois.
La mécanique des choix explicites existe ; son utilisation réelle n'est pas démontrée.
Ne pas reconstituer rétroactivement un refus à partir d'une absence de transaction.

## Proposition de traitement des quatre tickets

| Ticket | Preuve trouvée | Décision proposée, sous réserve des critères Plane |
| --- | --- | --- |
| ADIN-14 | Mini StatTracker implémenté et testé ; PRD laisse mobile 390 px, observation en match et déploiement ouverts | Garder ouvert jusqu'aux preuves mobile/live et de version déployée |
| ADIN-10 | Choix explicites et bilans 2/4 implémentés ; bilans présents en production, aucun choix explicite sur S7–S9 | Développement des bilans terminable ; conserver le suivi d'adoption et la revue des résultats |
| ADIN-9 | Classificateur partagé Coach/Waivers/Start-Sit/IA, incréments documentés et tests d'invariant | Candidat à clôture technique après contrôle du même snapshot en production et audit mobile authentifié |
| ADIN-7 | Conséquences bilatérales, profondeur/coupes/santé et fenêtre affectable implémentées ; comparatif des 12 rosters documenté le 28/10 | Candidat à clôture technique après revue manuelle des offres et preuve de livraison |

Références : `quality-consistency-2026-10-26.md`, `prd-live-standings.md`,
`product-roadmap.md`. Les comparatifs de trades sur snapshot mesurent cohérence et
présentation ; ils ne constituent pas un test prédictif contre des résultats réels.

## Suivis prêts à reporter dans Plane

Vérifier les tickets existants avant création pour éviter les doublons.

1. **P1 — Publier la revue S8 projections/FAAB et poursuivre S9–S10.**
   Premier livrable S8 : tableau ci-dessus. Prochain contrôle après clôture S9
   (prévu le 10/11) ; comparer mêmes cohortes par poste/horizon, Brier et couverture,
   puis décider sur plusieurs semaines. Aucun changement automatique de poids.
2. **P1 — Relire le journal réel et adopter les choix explicites.**
   Lier à ADIN-10. Contrôler un mouvement exécuté, un claim perdu et une recommandation
   non suivie avec leurs fenêtres 2/4 ; vérifier le rendu privé. Enregistrer les choix
   futurs et motifs par l'opérateur, sans inventer les décisions passées.
3. **P2 — Verdict benchmark experts après quatre semaines réellement notées.**
   Première revue attendue après S10 (vers le 17/11 si les captures S9/S10 réussissent).
   Vérifier dates avant kickoff, exclusions, couverture et cumul ; expliciter
   l'égalité Adineu/Sleeper à horizon 0. Ajourner si moins de quatre semaines valides.
4. **P1 — Réconcilier livraison et validation mobile des tickets QC.**
   Réutiliser ADIN-14 et les tickets existants : version production/commit,
   Coach authentifié à 390 px et observation NFL réelle. Ne pas recréer le moteur.

## Vérification locale effectuée

`npm test` : 717 tests réussis, aucun échec. `npm run check` : valide,
11 routes, 15 franchises, 609 matchs réguliers et 52 matchs de playoffs Yahoo.
Pas de build, typecheck ou linter configuré. Aucun code applicatif, coefficient,
workflow n8n, donnée de production ou statut Plane modifié. Les modifications
préexistantes de `CLAUDE.md` et `docs/product-roadmap.md` ont été conservées.
