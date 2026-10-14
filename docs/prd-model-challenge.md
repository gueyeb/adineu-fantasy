# PRD — Challenger le modèle (FAAB, projections, trades, usage, journal)

Statut : implémenté localement, 14/10/2026 (non commité). Origine : « any way we can challenge and enhance our model? ».
Cinq chantiers validés par Babacar. Chaque chantier mesure avant de modifier : un modèle qui
ne bat pas sa référence hors échantillon reste affiché, jamais branché sur une décision.

## 1. Prix FAAB : enchère gagnante d'après les rivaux

### Problème
Le prix « marché » actuel est `surplus ROS × PRICE_PER_POINT (3 $)`. En semaine 5, 1 enchère
gagnante sur 14 tombait dans la fourchette prédite (7 %). Il prédit 0 $ pour des joueurs partis
à 30–180 $. Il ignore qui peut enchérir, combien il lui reste et s'il a besoin du joueur.

### Données (saison 2026, legs 1–5)
Sleeper publie aussi les enchères **perdues** (`status: failed`) : 162 enchères valides (hors
« roster plein ») sur 92 joueurs, 73 gagnantes, budget 1 000 $. On voit donc, pour chaque
enchère, la meilleure enchère des autres équipes : la quantité à battre.

Constats (analyse du 14/10/2026) :
- le besoin du rival compte : une équipe dont le lineup de la semaine suivante gagne > 5 pts avec
  le joueur enchérit 42 % du temps, 14 % sans gain ;
- le budget restant ne prédit rien pour l'instant (tous les budgets sont encore hauts), mais il
  plafonne mécaniquement l'enchère d'un rival ;
- l'agressivité propre à chaque manager (moyenne 25 $ à 165 $) n'améliore pas la prévision hors
  échantillon à ce volume ;
- la projection Sleeper de la semaine suivante n'aide pas ; la hausse d'opportunités et de snaps,
  la jeunesse (≤ 2 ans) et le poste, si.

### Solution
Module pur `public/assets/faab-auction.js` : pour un joueur et un enchérisseur,
`P(gagner avec b $) = P(aucun rival) + P(rival) × P(meilleure enchère rivale < b)`.
- `P(rival)` : logistique ; montant : log-normal (régression ridge sur `log(1 + enchère)`).
- Variables : poste, jeunesse, hausse d'opportunités et de snaps de la dernière semaine, part
  des rivaux dont le lineup de la semaine cible progresse de plus de 0,5 pt avec le joueur.
- Le budget restant de chaque rival plafonne : au-dessus du plus gros budget rival, P = 1.
- Écart-type gonflé (× 1,2) : sans ce facteur le modèle est trop sûr de lui hors échantillon.
- Sortie : fourchette de la meilleure enchère rivale (p25/p50/p75/p90), enchère pour 60 % de
  chances, probabilité de gagner à l'enchère proposée, rivaux probables (besoin + budget).

Calibration hors ligne `npm run calibrate:faab` (`scripts/calibrate-faab.js`) → fichier
`public/data/faab-auction-calibration.json` (coefficients, échantillon, validation). À relancer
chaque semaine après les waivers, comme la calibration Boom/Bust.

Branchement : l'enchère proposée d'un `CLAIM_IF_CHEAP` devient
`min(plafond personnel, enchère pour 60 %)` (`bidBasis: AUCTION_MODEL_CAPPED_BY_PERSONAL_CEILING`)
et `auctionWinProbability` (déjà prévu, `null` jusqu'ici) est renseigné. Plafond personnel et
enchère proposée restent deux nombres distincts. Sans calibration ou sans signaux, l'ancien
calcul s'applique.

### Mesure
- Validation 14/10 (161 enchères, legs 1–5) : la fourchette p25–p75 de la meilleure enchère
  rivale la contient 62 % du temps en leave-one-leg-out, 51 % en chronologique (cible 50 % ;
  l'ancien prix : 7 % des enchères gagnantes dans sa fourchette). La probabilité de gagner ne bat
  pas un taux constant (Brier 0,252 contre 0,255 ; chronologique 0,271 contre 0,261) : elle est
  affichée comme estimation, jamais comme garantie, et sera re-mesurée chaque semaine.
- Suivi hebdo : le snapshot du mardi archive les variables de chaque joueur et le besoin de
  chaque équipe ; le bilan compare chaque enchère réelle à la probabilité qu'il aurait donnée
  (Brier, couverture p25–p75). Les tendances Sleeper (adds 24 h) sont archivées pour une future
  variable : elles ne sont pas reconstructibles a posteriori.

### Limites
- 162 enchères : modèle simple, recalibré chaque semaine ; aucune variable par manager.
- Les projections Sleeper des semaines passées sont relues aujourd'hui (fuite possible, faible :
  elles ne servent qu'au besoin des rivaux).
- Égalités et priorité waiver ignorées.

## 2. Tableau de bord projections : Adineu contre Sleeper

Livré : `projectionScorecard` (`scripts/model-tracking.js`), section « Adineu contre Sleeper » du
bilan du mardi. Premier constat (semaines 4–5, horizon 0–1) : l'usage seul se trompe plus que
Sleeper (5,45 contre 4,92 pts). Le mélange ne s'applique qu'à 2 semaines et plus : premières
mesures au bilan de la semaine 6 (snapshots archivés depuis la semaine 4).

Le bilan hebdomadaire mesure aujourd'hui l'erreur de Sleeper seule. Il ajoute l'erreur de notre
ROS (projections + usage) et de l'usage seul sur la même cohorte (mêmes joueurs, même semaine,
mêmes snapshots), par poste et par ancienneté. Si notre mélange ne bat pas Sleeper, on le voit.

## 3. Valeur d'échange contre les trades réels

Backtest : pour les 95 trades Yahoo 2019–2025 (verdicts figés), valeur de chaque camp au jour
du trade selon la méthode VORP de `buildLiveMarketValues`, calculée sur les points de saison
connus à cette date. Mesure : combien de fois le camp que la valeur favorise est celui qui a
gagné le trade (verdict existant). Résultat documenté dans `docs/backtest-trade-value.md` :
41–43 % sur 57 trades décidés, 30 % à nombre de joueurs égal. La valeur juge l'équité, pas le
gagnant ; aucun réglage changé.

## 4. Challenger de l'usage : expected points nflverse

`ffverse/ffopportunity` publie des expected fantasy points par joueur et par semaine issus du
play-by-play (2021–2026). Backtest contre notre xFP (`npm run backtest`) : qui prédit le mieux les
points des semaines suivantes. Adopté seulement s'il gagne, comme pour les défenses.
Résultat (`docs/backtest-ffopportunity.md`) : meilleur que notre xFP seul (3,79 contre 4,00), égal
une fois mélangé à Sleeper (3,51 contre 3,51). Non adopté.

## 5. Journal des décisions réelles (+ historique)

Le journal actuel (`decision-journal.js`) est lié à un snapshot local : une entrée depuis le 5/10.
Nouveau journal Supabase `decision_log` : chaque mouvement réel de l'équipe (claim gagné ou
perdu avec l'enchère, ajout libre, coupe, trade, choix de lineup) reconstruit depuis Sleeper, avec
son résultat (points du joueur ajouté contre le joueur coupé, points laissés sur le banc), la
recommandation du modèle quand un snapshot existait, et un motif saisi par Babacar.
Rattrapage : semaines 1–6 depuis Sleeper (78 lignes pour t0z le 14/10). Puis le job du mardi
enregistre le plan du modèle (`MODEL_PLAN`, avant les waivers) et resynchronise la saison.
Coach : section « Journal des décisions », motif modifiable par mouvement
(`GET`/`PUT /api/coach/decisions`).

## Critères de succès
- Fourchette FAAB calibrée (40–60 % de couverture p25–p75) mesurée chaque semaine.
- Chaque bilan hebdo dit si notre ROS bat Sleeper.
- Les verdicts « modèle vs réalité » existent pour trades, usage et décisions.

## Contraintes
- Aucun test ne touche le réseau ni Supabase.
- Changements de schéma via `supabase db query --linked`.
- Rien n'est soumis à Sleeper.
