# Rotations de lineup — 07/10/2026

Le moteur conserve ses projections, son optimisation, les joueurs promus et le gain global. Le nouveau champ `movementGroups` regroupe les affectations de slots connectées par un même identifiant joueur. Une rotation est une décision indivisible ; deux remplacements indépendants restent deux groupes. Les noms sans identifiant sont conservés mais ne servent jamais à inventer une connexion.

Coach/n8n et AI Context utilisent le même rendu : joueurs entrant/sortant de la lineup, gain total du groupe, puis affectations de slots sans gains individuels trompeurs. Les anciens snapshots contenant seulement `changes` sont regroupés au rendu. Les données par slot restent disponibles dans le JSON. Les petits gains sont qualifiés de choix proches au niveau du groupe ; compléter un slot vide reste prioritaire.

Exemple fictif : Puka remplace Moore en WR (+12,7), Moore remplace Wicks en FLEX (−11). Le rendu annonce Puka à la place de Wicks, +1,7 points au total, puis WR Puka / FLEX Moore. Il ne présente pas −11 comme une décision à appliquer seule. Cet exemple illustre la transformation, sans représenter une projection actuelle.

Le gain de groupe additionne les deltas par slot déjà arrondis : de petits écarts d’arrondi avec le total global restent possibles. Un delta absent garde le gain du groupe inconnu. Aucun nouveau calcul de disponibilité ou de projection n’est introduit ; les vérifications de santé et verrouillage restent nécessaires avant action. Le rendu ne rend pas une projection incomplète plus fiable.

Validation : six tests ciblés (rotation, changements indépendants, connexion transitive, données manquantes, ancien format sans identifiant, intégration avec l’optimiseur). Suite complète et contrôles statiques/assets vérifiés. Aucune modification de workflow n8n ni action de déploiement.
