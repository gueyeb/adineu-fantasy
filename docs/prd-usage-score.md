# PRD — Adineu Usage Score & buy-low / sell-high

Statut : validé et livré le 29/09/2026 (Trade Hub → onglet « Usage & Buy-Low », `GET /api/usage`).
Inspiration : Utilization Score de Fantasy Life (`docs/benchmark-fantasylife.md`, lot 2).

## Problème
Les points marqués sont bruités (TD, big plays). Le volume (part de l'attaque de son équipe) est
plus stable et prédit mieux la suite. Sans mesure d'usage, on vend trop tôt un joueur très utilisé
qui a juste manqué de TD, et on surpaie un joueur dopé par un TD isolé.

## Données (gratuites)
Sleeper `GET /v1/stats/nfl/regular/{season}/{week}`, par joueur et par semaine : `off_snp`,
`tm_off_snp`, `rec_tgt`, `rec_air_yd`, `rush_att`, `rec_rz_tgt`, `rush_rz_att`, `pts_ppr`.
Équipe NFL = index joueurs Sleeper (équipe actuelle). **Routes / first reads : non disponibles
gratuitement, jamais imputées.**

## Modèle (`public/assets/usage-score.js`)
1. **Totaux d'équipe par semaine** = somme des lignes des joueurs de l'équipe.
2. **Parts par match joué** (snaps > 0) : snaps, targets, air yards, courses, red zone. Air yards =
   part des air yards **positifs** de l'équipe (une cible derrière la ligne compte 0), toujours entre 0 et 100 %.
3. **Composite par poste**, sur les 3 derniers matchs joués (poids 0,5 / 0,3 / 0,2) :
   - WR/TE : 40 % targets, 20 % air yards, 20 % snaps, 20 % red zone ;
   - RB : 30 % snaps, 30 % courses, 20 % targets, 20 % red zone.
4. **Usage Score (0–100)** = percentile du composite dans le poste.
5. **xFP (points attendus)** = régression linéaire, par poste, des points PPR sur le volume
   (targets, courses, red zone, air yards), recalculée à chaque appel sur les données de la saison.
   Garde-fous : en dessous de 30 matchs-joueurs, coefficients fixes de repli ; une variable présente
   dans moins de 10 matchs (ex. courses d'un TE) garde sa valeur fixe au lieu d'être ajustée ;
   régression ridge (λ = 5) ; tout coefficient non fini ou hors bornes plausibles rejette l'ajustement.
6. **Égalités** : même composite = même Usage Score (percentile moyen du bloc).
7. **Signaux** (≥ 2 matchs) :
   - `BUY_LOW` : pts/match ≤ xFP − 3 et Usage ≥ 60 ;
   - `SELL_HIGH` : pts/match ≥ xFP + 4 et Usage ≤ 85 (un usage élite qui surproduit, c'est une star).
8. **Tendance** : composite du dernier match − moyenne des précédents (détecte un changement de rôle).

## Affichage
Pour l'équipe choisie : buy-low à cibler chez les autres, sell-high sur son roster, son roster
complet, free agents à fort usage, top 20 par poste. Toujours présenté comme une estimation Adineu.

## Limites / suite
- Les stats hebdo Sleeper n'ont pas d'équipe : les semaines jouées avant un transfert NFL
  (`team_changed_at`) sont exclues plutôt qu'attribuées à la nouvelle équipe.
- Les poids du composite sont posés à la main : à valider en backtest (le composite prédit-il les
  points des semaines suivantes mieux que les points passés ?), 2024–2025 via nflverse.
- Suite prévue : utiliser l'usage pour la valeur reste de saison au-delà des 2 prochaines semaines,
  là où les projections Sleeper sont peu mises à jour ; l'intégrer au Trade Finder et au waiver v2.
