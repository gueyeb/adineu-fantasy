# Backtest — valeur d'échange live contre les 95 trades Yahoo (2019–2025)

14/10/2026 · `npm run backtest:trade-value` (`scripts/backtest-trade-value.js`) · données en cache dans
`.cache/backtest/` · PRD : `docs/prd-model-challenge.md` (chantier 3).

## Protocole

Pour chaque trade archivé, les deux lots sont valorisés comme le fait aujourd'hui le Trade Finder
(`buildLiveMarketValues` : rythme hebdomadaire au-dessus du niveau de remplacement du poste, échelle
1–100, K/DEF plafonnés), avec **seulement ce qui était connu à la date du trade**. Trois rythmes :
moyenne de la saison jusqu'au trade, projection Sleeper de la semaine suivante, moyenne des deux.
Référence naïve : points bruts cumulés jusqu'au trade. On compare le camp favorisé au verdict figé
(`outcome` : points au-dessus du remplacement jusqu'à la fin des playoffs). Seuls les 57 trades
`WON` comptent ; les 38 `EVEN` n'ont pas de gagnant.

## Résultats

| Méthode | Trades notés | Le camp favorisé a gagné | Appels nets (écart ≥ 25 %) |
|---|---|---|---|
| Valeur live, rythme = moyenne à date | 47 | 43 % | 40 % (45) |
| Valeur live, rythme = projection Sleeper | 56 | 41 % | 41 % (49) |
| Valeur live, moyenne des deux | 50 | 42 % | 41 % (46) |
| Points bruts à date (naïf) | 56 | 52 % | 55 % (33) |

Trades à nombre de joueurs égal (1 contre 1, 2 contre 2…) : le camp favorisé par la moyenne à date
n'a gagné que **30 % (8/27)** ; par la projection, 41 % (37). Trades déséquilibrés (2 contre 1…) :
55–60 %. Le camp qui reçoit le plus de joueurs a gagné 11 fois sur 20 : pas de biais de quantité.

## Conclusion

- **La valeur live ne prédit pas le gagnant d'un trade** dans cette ligue : elle fait moins bien
  qu'une pièce (41–43 %), et la référence naïve n'est pas meilleure (52 %).
- **Le camp qui reçoit le joueur « chaud » perd le plus souvent** (30 % à joueurs égaux). C'est la
  régression vers la moyenne : un rythme de début de saison surestime la suite. Le même effet que
  le signal SELL_HIGH (13 % de progression seulement, `docs/backtest-usage.md`).
- Ce que ça change : la valeur marché sert à juger l'**équité** d'un échange (ce que l'autre manager
  acceptera), pas à prédire qui le gagnera. L'avantage d'un trade vient de l'écart entre la valeur
  perçue et la suite attendue : vendre un SELL_HIGH, acheter un BUY_LOW. Le Trade Finder donne déjà
  un petit bonus à ces deux cas ; aucun réglage n'est changé sur 57 trades.
- Limites : 57 trades sur 7 saisons, deux plateformes de scoring proches mais pas identiques (Yahoo
  2019–2025, points PPR Sleeper pour le verdict), projections Sleeper historiques relues aujourd'hui.
- Piste : rejouer ces trades avec les signaux BUY_LOW / SELL_HIGH de chaque joueur à la date (usage
  des 3 semaines précédentes) pour mesurer si « acheter bas » gagne vraiment ici.
