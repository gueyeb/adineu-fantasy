# Benchmark — Fantasy Life « Fantasy HQ » (league sync)

29/09/2026. Source : pages publiques d'aide de Fantasy Life. Les pages league-sync elles-mêmes
exigent une ligue synchronisée : les métriques propriétaires (Utilization Score, projections
Xfinity) ne sont connues que par leur description.

## Comparatif

| Fantasy HQ | Adineu aujourd'hui | Reproductible avec nos données gratuites ? |
|---|---|---|
| Standings : record, séries, PF/PA, **playoff %**, **Luck score** | Standings + Playoff % (page Power) + All-Play | **Oui, facile** : luck = victoires réelles − victoires attendues (all-play) ; ajouter playoff % au tableau |
| **Standings Over Time** (courbe du rang semaine par semaine) | — | **Oui, facile** : matchups Sleeper semaine par semaine |
| Matchup : projection + win probability | Game Center (estimation pré-match) | Déjà là |
| **Lineups Current / Optimize / Boom / Safe** | Start/Sit (alertes) + points laissés sur le banc (récap) | Optimize : **oui, facile** (même moteur). Boom/Safe : moyen, il faut une variance par joueur (écart-type de ses scores) |
| **Boom % / Bust %** par joueur et par équipe | — | Moyen : distribution des scores réels (archive + 2026) autour de la projection |
| **Injured players : points projetés perdus** (2 rosters) | Start/Sit (mon roster) | **Oui, facile** : somme des projections des titulaires Out/IR, pour moi et l'adversaire |
| **Utilization Score** + buy-low / sell-high | — | **Oui, cœur du chantier 2** : « Adineu Usage Score » depuis snaps, opportunités, red zone (déjà collectés par le waiver v2). Buy-low = usage élevé, production faible |
| Trending Up (roster % en hausse) | — | **Oui, facile** : Sleeper `GET /players/nfl/trending/add` (gratuit) croisé avec notre modèle |
| Free agents : ROS rank, projection, **FAAB suggéré**, **historique FAAB de la ligue** | Waiver v2 (Market / Fit / FAAB) | Historique : **oui, facile**, avec `waiver_bid` dans `/transactions/{week}` (sert aussi à calibrer le prix du point) |
| **DvP / matchup boost** | — | Moyen : points concédés par défense et par poste, calculés depuis les stats Sleeper ; il faut le calendrier NFL (nflverse) |
| **Game Exposure** (points projetés par match NFL) | — | Moyen : calendrier NFL + projections |
| Start/Sit : comparer jusqu'à 8 joueurs, contexte favori/outsider | Start/Sit (alertes) | Moyen : comparateur côte à côte, facile ; contexte favori/outsider = choisir plafond ou plancher |
| Trade Analyzer : **Trade Win %**, force par poste avant/après | Trade Finder (deltas de lineup ROS, les deux côtés) | Force par poste avant/après : **oui**. « Win % » : **non**, c'est un pourcentage synthétique contraire à nos principes. On garde les deltas en points |

## Priorités proposées

**Lot 1 : quick wins — ✅ livré le 29/09/2026**
1. Standings : colonnes Luck (réel − all-play) et Playoff %.
2. Standings Over Time (courbe du rang).
3. Historique FAAB de la ligue par joueur/poste (Waiver Wire), qui sert aussi à calibrer le prix du point du modèle v2.
4. Trending adds Sleeper croisés avec le modèle waiver v2.
5. Game Center : points projetés perdus sur blessure, pour les deux équipes.
6. Start/Sit : bouton « lineup optimisée », avec le gain en points vs la lineup actuelle.

**Lot 2 : modèle (chantier 2) — validé, prochain**
7. ✅ Adineu Usage Score + buy-low / sell-high (livré le 29/09 : onglet Usage du Trade Hub ; intégration Trade Finder / page équipe à suivre).
8. Boom / Bust % et lineups Boom / Safe (variance par joueur).

**Lot 3**
9. ✅ DvP / difficulté du matchup (livré le 29/09 : calendrier nflverse, onglet Start/Sit). Game Exposure : à faire.
10. ✅ Comparateur Start/Sit jusqu'à 8 joueurs (livré le 29/09 : projection, matchup, ROS, usage, statut).

Principe maintenu : tout pourcentage affiché est une estimation Adineu étiquetée, jamais un
« Trade Win % » ni une probabilité de gagner une enchère.
