# Mini StatTracker — classement provisoire du Game Center

26/10/2026. Demande utilisateur : retrouver dans l'interface existante l'essentiel
du StatTracker Yahoo, en priorité l'évolution du classement de la ligue pendant les
matchs. Cette extension ciblée est explicitement demandée après la priorité de
consolidation ; elle ne lance pas une nouvelle plateforme ou un modèle entraîné.

## Deux scénarios distincts

- **Scores actuels** : classement si les scores publiés à cet instant se figeaient,
  bilan V/D/N provisoire, points cumulés et mouvement depuis l'avant-semaine.
- **Estimation fin de semaine** : scénario déterministe Adineu tenant compte des
  points acquis et du temps NFL restant. Ni classement officiel, ni simulation de
  playoffs, ni probabilités de victoire live, ni projection propriétaire Yahoo.

Les matchups de la semaine exposent en plus le détail des titulaires et du banc /
réserve, leurs points acquis et leur état NFL. Le banc ne contribue jamais au total.
Un panneau secondaire présente les matchs NFL, scores et horloges. Les leaders NFL
passing/rushing/receiving et le play-by-play ne sont pas dans cette V1.

## Contrats et calculs

`GET /api/live-standings` est public et en lecture seule, sur la ligue ADINEU
configurée. Aucun token Yahoo, identifiant privé de compte ou secret Supabase.
Scores fantasy, lineups et corrections viennent de Sleeper ; ESPN fournit les
états et horloges NFL. Les noms d'équipe et comptes sont les affichages Sleeper
actuels, sans réinterprétation via les alias historiques. L'historique des duels
Yahoo déjà présent reste affiché, séparé de la semaine live.

Le moteur reconstruit la base depuis les matchups des semaines antérieures à la
semaine opérationnelle NFL. Il ne rajoute jamais le résultat courant aux W/L des
rosters, qui peuvent déjà l'inclure. Chaque duel est appliqué une fois. Une affiche
non commencée à 0–0 ne crée pas deux égalités ; une égalité réellement terminée peut
compter. PF inclut uniquement le score d'équipe publié, avec `custom_points` prioritaire
lorsqu'il est numérique (y compris zéro). Les scores négatifs sont valides.

Tri : victoires, puis PF cumulés, comme la configuration `playoff_seed_type: 0`
vérifiée pour ADINEU. Les rangs strictement égaux sont partagés ; l'ordre des noms
sert seulement à stabiliser l'affichage des ex aequo. Autres seeds, divisions ou
match contre la moyenne de ligue non pris en charge → classement suspendu. La vue
reste limitée à la saison régulière fantasy, sans modifier les classements officiels,
le Power Ranking, le Playoff Race ou l'archive Yahoo.

### Estimation explicite et non calibrée

Pour chaque titulaire :

- match terminé / bye : aucun point restant estimé ;
- match à venir : projection d'avant-match, au barème réel de la ligue ;
- match en cours : projection d'avant-match × secondes réglementaires restantes / 3600.

Estimation de l'équipe = **score fantasy acquis publié + somme des points restant
estimés des titulaires**. Les projections sont rescorées avec `leaguePoints`, déjà
utilisé par les leaders et rankings ; pas de fallback par rang ni d'addition de
la projection entière à un score déjà acquis. Les changements de titulaire, de
lineup ou les corrections sont relus aux actualisations suivantes.

Hypothèse : rythme uniforme sur le temps réglementaire. L'estimation s'ajuste aux
points déjà marqués et à l'horloge, mais ne modélise ni possession, ni scénario de
jeu, ni rôle modifié, ni remontée, ni rythme de touches. Elle n'est pas calibrée
comme un modèle prédictif. Prolongation, horloge inconnue, projection manquante,
lineup incomplète ou contradiction score/état pré-match/bye → estimation suspendue
pour l'équipe ; le classement estimé de toute la ligue est masqué si une équipe manque.
Le classement aux scores actuels reste disponible si ses sources sont complètes.

Une horloge pré-match avec des points déjà acquis ne permet pas de rajouter la
projection complète : cette incohérence suspend l'estimation. Quand tous les
matches des titulaires sont terminés, l'estimation rejoint le score publié, sans
exiger de projections résiduelles. Cela n'exclut pas des corrections Sleeper ultérieures.

## Rafraîchissement et modes dégradés

- Page visible, onglet Live : actualisation toutes les 30 secondes, bouton manuel.
- Requêtes live simultanées regroupées et cache partagé de 15 secondes ; historique
  relu au plus tard après cinq minutes pour les corrections. Les appels en échec
  ne sont pas conservés dans leur cache de requêtes.
- Si le rafraîchissement échoue, dernier affichage conservé avec son horodatage et
  un avertissement. Aucune valeur fictive fraîche ne remplace les données anciennes.
- Un échec de l'historique suspend le classement, tout en laissant les duels lisibles.
  Une panne de l'horloge NFL suspend les estimations, pas les scores fantasy.
- Les sources sont lues séparément : ce n'est pas un snapshot atomique. L'heure
  affichée est celle de lecture du rapport ; les fournisseurs peuvent être en retard.
- Changement de semaine : base reconstruite et semaine courante actualisée. Un
  changement de saison exige de recharger la page. Les vues secondaires gardent
  leurs propres sélections de semaines.
- Mode de classement et détails de duels ouverts conservés pendant les actualisations.
  Les probabilités pré-match ne sont plus présentées comme des pourcentages live.

## Vérifications

Evals : baseline reconstruite, rafraîchissements idempotents, changement de W/L et
PF, égalités de rang, 0–0 avant kickoff, custom score, banc exclu, temps restant,
matchs terminés, prolongation/horloge manquante, couverture partielle, historique
manquant, sources en panne, méthode HTTP en lecture seule et absence d'IDs privés.

Les tests utilisent des scores et comptes synthétiques. Vérification locale sur
la lecture du 26/10 : S7, 12 équipes, six affiches, 14 matchs NFL, estimations
couvertes pour les 12 lineups. Boukki : base 2–4 / 11e ; scénario aux scores publiés
3–4 / 9e, 121,60 pts ; estimation de semaine 130,62 pts (Aubrey encore à jouer).
Ces valeurs datées ne sont pas une promesse sur le résultat final.

Suite complète : 615 tests passent ; tests ciblés supplémentaires de présentation,
contrôles statiques et versions d'assets valides. Navigateur local : classement réel,
bascule estimée et détail titulaires/banc contrôlés. Mobile 390 px et expérience
sur un vrai match en progression restent à auditer ; aucune validation prédictive.
Aucun push ni déploiement en production effectué par cette livraison.

## Sources et limites de collecte

- Référence visuelle fournie par l'utilisateur : capture Yahoo StatTracker et
  [GameChannel Yahoo](https://sports.yahoo.com/nfl/gamechannel/?lid=800282).
  Lecture publique limitée à la page générale ; aucune session Yahoo utilisée.
- [Documentation officielle Sleeper](https://docs.sleeper.com/) : ligues, rosters
  et matchups en lecture seule ; pas de flux de projection live ajustée documenté
  dans la page consultée. Les projections hebdomadaires existantes sont conservées.
- Scoreboard NFL ESPN : endpoint public vérifié sur la S7 2026, période contrôlée
  avant utilisation. Exemple :
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=7`.
  Contrat externe susceptible d'évoluer : normalisation, timeout et repli explicites.
