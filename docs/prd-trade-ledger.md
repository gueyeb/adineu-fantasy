# PRD — Classement des trades

Statut : implémenté localement, 14/10/2026. Origine : demande d'un membre de la ligue — qui a
conclu le plus de trades depuis 2019 ?

## Problème

L'archive Yahoo du site couvre classements, matchs et playoffs, pas les transactions. Le nombre de
trades par manager n'existait nulle part hors des pages Yahoo, saison par saison et par nom d'équipe.

## Solution et périmètre

Une section « Qui trade le plus » sur `/history/#trades` :

- classement des managers par nombre de trades, 2019 → saison en cours ;
- détail par saison, moyenne par saison jouée, partenaire favori ;
- total de la ligue, saison la plus active, duo le plus actif.

Hors périmètre : juger qui a gagné un trade, valeur des joueurs échangés, trades refusés ou
annulés, détail joueur par joueur à l'écran (présent dans l'archive, pas affiché).

## Approche technique

- **Archive** `public/data/yahoo-trades.json` : 95 trades 2019–2025, relevés le 14/10/2026 dans les
  pages `…/{année}/f1/{ligue}/transactions?transactionsfilter=trade` via la session Chrome
  authentifiée (procédure `AGENTS.md`, lecture seule). Chaque trade : date, heure Yahoo, deux côtés
  avec manager canonique, nom d'équipe de la saison et joueurs reçus. L'URL source est conservée.
- **Identité** : le nom d'équipe Yahoo de la saison est relié au manager par `managerHistory` ;
  95/95 trades attribués, aucun rapprochement deviné.
- **Saison en cours** : transactions Sleeper `trade` / `complete`, rosters reliés aux managers par
  `sleeperManager`. Un roster non relié exclut le trade, qui est compté à part.
- **Module pur** `public/assets/trade-ledger.js` (`buildTradeRanking`, `buildSleeperTrades`), testé
  par `test/trade-ledger.test.js`, qui vérifie aussi la cohérence de l'archive avec `managerHistory`.

## Critères de succès

- Le total par saison égale le nombre de trades listés par Yahoo (20, 16, 6, 21, 14, 7, 11).
- La somme des trades par manager vaut deux fois le total (chaque trade a deux côtés).
- Un trade Sleeper conclu apparaît sans redéploiement.

## Cas limites et contraintes

- Yahoo ne liste que les trades conclus ; un trade puis son inverse comptent pour deux.
- La moyenne par saison compte la saison en cours, incomplète, pour les managers actifs.
- Sleeper indisponible : classement arrêté à 2025, mention explicite.
- Égalité : même rang.
- Ne remplacer l'archive que si chaque saison retrouve son total Yahoo et si tous les noms
  d'équipe correspondent à `managerHistory`.
