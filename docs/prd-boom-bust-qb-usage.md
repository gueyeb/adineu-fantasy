# PRD — Boom / Bust et Usage Score des QB

Statut : validé (priorité), 01/10/2026. Inspiration : Fantasy Life (Boom % / Bust %, lineups Boom / Safe).

## 1. Boom / Bust

### Problème
Une projection est une moyenne. Pour décider qui titulariser, il faut aussi savoir **à quel point
elle peut se tromper** : un WR à 12 pts qui fait soit 3 soit 25 n'a pas la même valeur qu'un WR à
12 pts régulier, et le bon choix dépend du match. Outsider : on cherche le plafond. Favori : le plancher.

### Solution
- **Distribution calibrée sur 5 saisons réelles** (2021–2025, Sleeper : projection d'avant-match vs
  score réel). Pour chaque poste et tranche de projection, on garde la distribution du ratio
  `score réel / projection` (quantiles de 5 % en 5 %). Fichier : `public/data/boom-bust-calibration.json`,
  généré par `npm run calibrate:boom-bust`.
- Pour un joueur projeté `p` cette semaine :
  - **Plancher** = 20ᵉ percentile, **Plafond** = 80ᵉ percentile ;
  - **Boom %** = P(score ≥ seuil boom du poste), **Bust %** = P(score ≤ seuil bust du poste).
  - Seuils (PPR, ligue à 12) : QB boom ≥ 25 / bust ≤ 12 ; RB et WR ≥ 20 / ≤ 6 ; TE ≥ 15 / ≤ 4 ;
    K ≥ 12 / ≤ 4 ; DEF ≥ 12 / ≤ 2.
  - Joueur Out / IR : 0, boom 0 %, bust 100 %.
- **Lineups** : actuelle, optimale (projection), **Boom** (maximise les plafonds), **Safe**
  (maximise les planchers), avec le même moteur de lineup que le reste du site.
- **Recommandation selon le match** : estimation de victoire pré-match contre l'adversaire de la
  semaine. En dessous de 40 % → lineup Boom ; au-dessus de 60 % → Safe ; sinon optimale.
- **Validation** : calibrage sur 2021–2024, test sur 2025 (jamais vu). Les Boom % / Bust % prédits
  doivent correspondre aux fréquences observées (tableau de calibration par tranche).

### Limites v1
Pas encore de volatilité propre à chaque joueur (le poste et le niveau de projection seulement).
Piste v2 : multiplier l'écart par la volatilité historique du joueur, ramenée vers la moyenne du poste.

## 2. Usage Score des QB

### Problème
Les QB sont le seul poste sans Usage Score ni signal buy-low / sell-high.

### Solution
- Volume QB = **dropbacks** (`pass_att + pass_sack`), **courses** (`rush_att`), **red zone**
  (`pass_rz_att + rush_rz_att`), **air yards** (`pass_air_yd`).
- Composite QB (percentile) : 40 % part des dropbacks de l'équipe ¹, 25 % courses par match,
  20 % red zone, 15 % air yards par tentative. ¹ un QB titulaire a ≈ 100 % : le composite distingue
  surtout les QB qui courent, qui jouent en red zone et qui lancent loin.
- **xFP QB** : régression par poste comme pour RB/WR/TE (dropbacks, courses, red zone, air yards),
  avec les mêmes garde-fous (ridge, bornes, repli).
- Signaux buy-low / sell-high avec seuils adaptés à l'échelle QB (± 5 pts).
- **Validation** : backtest 2021–2025 sur les QB avant mise en prod.

## Résultats (01/10/2026)

**Boom / Bust** — 31 080 matchs (2021–2025). Validation hors échantillon (calibré 2021–2024, testé
sur 2025) : Bust % prédit 13,9 / 28,7 / 48,6 / 69,5 / 88,0 % contre 16,2 / 29,3 / 50,8 / 71,0 /
84,4 % observés ; Boom % 8,1 / 25,8 / 43,9 % contre 7,7 / 24,2 / 50,9 %. **Bien calibré.**
La volatilité propre à chaque joueur a été testée et **rejetée** : elle dégrade la saison test
(Brier boom 0,0940 → 0,0948, bust 0,1754 → 0,1769). L'écart de régularité entre joueurs est
surtout du bruit une fois le poste et la projection connus. Le recalibrage la re-teste
automatiquement à chaque fois (`useVolatility`). Conséquence : les lineups Boom / Safe ne diffèrent
de l'optimale que rarement (surtout au FLEX, RB vs WR) ; l'interface le dit au lieu d'afficher
trois lineups identiques.

**Usage QB** — 933 décisions (2021–2025). Premier essai avec des coefficients de repli posés à la
main : xFP QB mauvais (erreur 6,16), presque tous les QB signalés buy-low. Cause : une saison n'a pas
assez de matchs de QB pour passer les garde-fous de la régression, donc le repli servait toujours, et
il surestimait les dropbacks d'un facteur 10. Correctif : repli = même régression ajustée sur 1 685
matchs de QB (les points d'un QB viennent des air yards, des courses et de la red zone, pas du nombre
de dropbacks).

Validation « une saison écartée » (ajusté sur 4 saisons, testé sur la 5ᵉ, cible = semaines N+2 à N+5) :
coefficients quasi identiques d'une saison à l'autre (courses 0,70–0,79 ; air yards 0,076–0,081) ;
erreur Sleeper seul 4,89, xFP seul 4,71, **mélange 50/50 4,37 (−11 %)**. → L'usage QB entre dans la
valeur reste de saison avec un poids de 50 % (`FAR_WEEK_USAGE_WEIGHT_BY_POSITION`, RB/WR/TE restent
à 20 %). Signaux QB (seuils ± 5 pts) : buy-low +2,6 pts ensuite (75 % progressent), sell-high
−4,3 pts (29 %), contre 47 % pour l'ensemble des QB.
