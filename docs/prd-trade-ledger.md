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

Hors périmètre : trades refusés ou annulés, jugement sur la décision au moment du trade, verdict
sur la saison en cours.

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

## Extension du 14/10/2026 — qui a gagné l'échange

Sous le classement, la liste complète des 95 trades par saison (joueurs reçus par chaque côté) et,
pour chacun, ce que les joueurs reçus ont produit ensuite. Le tableau gagne deux colonnes : bilan
gagnés-perdus-équilibrés et valeur nette.

- **Jointure des joueurs par identifiant** : chaque joueur porte son identifiant Yahoo, relié à
  Sleeper par `yahoo_id`. Sleeper ne le renseigne plus pour les rookies récents (60 lignes sur
  228) : repli sur nom normalisé + poste, accepté seulement s'il reste un candidat unique ayant
  joué cette saison. `matchedBy` garde la trace. Jamais de nom seul.
- **Valeur, pas points bruts** : points PPR Sleeper au-dessus du niveau de remplacement de la
  semaine au poste (score du dernier titulaire : équipes × QB 1, RB 2,5, WR 2,5, TE 1, K 1). En
  points bruts, tout trade contenant un quarterback était « gagné » par celui qui le recevait.
- **Fenêtre** : de la première semaine NFL dont le coup d'envoi suit le trade à la dernière semaine
  des playoffs de la ligue (16 en 2019–2020, 17 ensuite).
- **Verdict** : avantage déclaré au-delà de 15 points de valeur et de 15 % d'écart, sinon
  « équilibré » (57 avantages, 38 équilibrés). Seuils de lecture, non calibrés.
- **Chaque trade jugé seul** : un joueur revendu compte quand même. La première version arrêtait
  le compteur à la revente ; un joueur acquis puis revendu avant de jouer valait 0 pendant que la
  contrepartie comptait pleinement.
- **Figé** : `scripts/build-trade-outcomes.js` écrit `outcome`, `points`, `value` dans l'archive
  (stats en cache dans `.cache/backtest`). Rien n'est recalculé dans le navigateur.

Limites : le barème Yahoo de l'époque n'est pas reconstitué (PPR Sleeper) ; les blessures
postérieures au trade pèsent dans le résultat ; un trade conclu du vendredi au dimanche est compté
à partir de la semaine suivante ; le besoin d'effectif de chaque manager n'est pas pris en compte.
