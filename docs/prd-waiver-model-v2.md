# PRD — Waiver Evaluation Model v2 (Event → Opportunity → Roster Fit → FAAB)

Statut : validé pour implémentation, 29/09/2026. Origine : retour « ALGO FEEDBACK » (ChatGPT,
post-semaine 3), vérifié sur les données Sleeper.

## Problème (constaté semaine 4)

| Joueur | Sortie v1 | Référence (Footballguys) | Ce que l'algo ignorait |
|---|---|---|---|
| Braelon Allen (NYJ RB) | STREAMING 3–7 % | 10–20 % | Breece Hall **Out** (cuisse), Allen RB2 au depth chart |
| Ollie Gordon (MIA RB) | PROFONDEUR 0–1 % | 10–20 % | Achane **IR, ACL** (saison finie) ; Gordon 61/73 snaps (84 %), 17 courses en S3 |
| Keenan Allen (IND WR) | STASH 1–3 % | 20–40 % | 9 targets, 52/71 snaps en S3 (vs 5 targets en S2) |

Et à l'inverse : 4 QB en tête « PRIORITÉ » alors qu'on joue en 1QB avec 6 places de banc.

Causes dans le code v1 (`getFreeAgents`, `scripts/league-context.js`) :
1. `score = 0.65·projection semaine + 0.25·récent + 0.10·rang` : la projection de la semaine et
   un ECR daté du 06/09 dominent.
2. **`recentPpg` vaut toujours `null` pour un free agent** : la production récente est lue dans les
   `players_points` des matchups de la ligue, qui ne contiennent que les joueurs rostés.
3. FAAB = palier fixe par catégorie de score (`[3,7]`, `[1,3]`…) : pas d'événement, pas de durée,
   pas de rareté par poste, pas de fit roster.
4. Une seule valeur pour tout le monde : valeur marché et valeur *pour moi* confondues.

## Principe

`valeur joueur ≠ valeur d'acquisition`. Deux scores séparés, affichés côte à côte :

`Market 86 | Fit Boukki 43 | FAAB marché 150–220 $ | Max Boukki 60 $`

## Modèle

### 1. Valeur de base (ROS)
- `rosPpg` = moyenne des projections Sleeper des semaines N→14 (publiées pour les semaines
  futures, gratuit) ; semaine de bye = 0.
- Repli si pas de projection future : estimation par rang (ECR catalogue), étiquetée.

### 2. Opportunité actuelle (poids fort), depuis `GET /stats/nfl/regular/{season}/{week}`
Par joueur, sur les 3 dernières semaines terminées :
- `snapShare` = `off_snp / tm_off_snp` ; tendance = dernière semaine − moyenne des précédentes.
- `opportunities` = `rush_att + rec_tgt` ; `rzOpps` = `rush_rz_att + rec_rz_tgt` (rôle goal line).
- `targetShare` = `rec_tgt / Σ rec_tgt de l'équipe`. `airYards` si disponible.
- `recentPpg` = `pts_ppr` moyen **depuis les stats** (corrige le bug `null`).
- Routes / participation aux routes : **non disponibles** (pas de source gratuite complète),
  affichées `n/d`, jamais imputées.

### 3. Événements → `NEWS_OVERRIDE`
Un joueur est marqué `NEWS_OVERRIDE` (avec la raison lisible) si :
- **PROMOTION** : un coéquipier du même poste, devant lui au depth chart Sleeper
  (`depth_chart_order`) ou mieux classé, est Out / Doubtful / IR / PUP / Sus.
- **SNAP_SURGE** : `snapShare` dernière semaine ≥ 70 % et ≥ +25 pts vs moyenne précédente.
- **USAGE_SURGE** : opportunités dernière semaine ≥ 8 et ≥ 1,5× la moyenne précédente.

Un joueur `NEWS_OVERRIDE` n'hérite **jamais** d'un palier ECR/ADP : sa valeur est recalculée
depuis le rôle (§4). Les tiers périmés sont ignorés pour lui.

### 4. Durée de l'opportunité
| Classe | Déclencheur | Semaines valorisées |
|---|---|---|
| `RENTAL_1W` | titulaire Out, non IR | 1 |
| `UNCERTAIN` | titulaire Doubtful / Questionable | 1 (demi-poids) |
| `SHORT_2_4W` | titulaire IR / PUP | 3 |
| `SEASON_LONG` | titulaire IR avec blessure de fin de saison (ACL, Achilles…) ou statut « season » | toutes les restantes |
| `BREAKOUT` | SNAP/USAGE_SURGE sans blessure devant lui | restantes, confiance moyenne |

Rythme dans le rôle : `rolePpg = ros + confiance × (preuve − ros)`, où `preuve = max(ros, projection
semaine N, moyenne des 2 derniers matchs, points du dernier match s'il y a joué ≥ 60 % des snaps)`.
Confiance 75 % pour une promotion expliquée par une blessure, 50 % pour un BREAKOUT sans cause
(un seul match est un signal, pas une certitude). Hors du rôle : `rosPpg`, plus 10 % du surplus
de rôle en valeur de menotte (contingence) une fois le titulaire revenu.

Qui était titulaire avant la news : **rang Sleeper (`search_rank`)**, pas le depth chart, que
Sleeper met à jour *après* la blessure (Braelon Allen y est déjà RB1 devant Hall).

### 5. Fit de ligue (Adineu 2026)
- Valeur = points **au-dessus du remplacement** : `replacement[pos]` = moyenne `rosPpg` des 3–5
  meilleurs free agents du poste. Ça capte automatiquement la rareté et la profondeur à 12 équipes.
- Full PPR : déjà dans les projections et les targets.
- 1 QB / 1 TE / 6 places de banc : pas de décote arbitraire. Le niveau de remplacement élevé des
  QB (beaucoup de QB à ~15 pts disponibles) donne naturellement un surplus quasi nul à un QB2.
- USAGE_SURGE ne s'applique qu'aux RB/WR/TE (carries + targets ne mesurent pas l'usage d'un QB).
- 8 équipes sur 12 en playoffs : on privilégie la valeur ROS au plancher d'une semaine
  (les rentals sont plafonnées).

### 6. Market score et FAAB marché
- `surplus` = Σ sur l'horizon de `(ppg − replacement[pos])`, borné à ≥ 0.
- `marketScore` (0–100) = échelle logarithmique du surplus.
- **FAAB marché ($)** = `surplus × prix du point`, fourchette ±25 %, affiché aussi en % du budget.
  Prix du point v2 = **3 $** (`PRICE_PER_POINT`), calé à la main sur les enchères gagnées de la ligue
  (Vele 301 $, Kyler 181 $, Kamara 176 $, Pitts 122 $). À recalibrer automatiquement quand il y aura
  assez d'enchères (`/transactions/{week}`, `waiver_bid`) rapprochées du surplus prédit ce jour-là.

### 7. Fit roster (par équipe)
- `lineupGain` = gain de lineup optimale ROS si on ajoute le joueur (moteur `buildProjectedLineup`
  + `restOfSeasonEstimate` du Trade Finder, un seul moteur pour tout le site).
- `fitScore` (0–100), affiché **Capture**, = part du surplus marché qui passe réellement dans **ta** lineup. Ce n'est pas une note globale de fit.
  v2 : la **redondance** est couverte par construction (un TE derrière McBride n'entre jamais en
  lineup optimale, donc fit = 0).
- **v2.1 livré** : `dropCandidate` est le joueur de banc non-IR/non-titulaire au plus faible coût marginal. `dropCostPerWeek` additionne son surplus au-dessus du remplacement et sa valeur d'option (Usage Score, BUY_LOW, projection court terme) ; `netGainPerWeek = lineupGain − dropCost`. Un stash sous le remplacement n'est donc plus considéré automatiquement gratuit.
- Le modèle expose aussi les trois meilleures coupes possibles avec valeur immédiate, valeur d'option, Usage Score, bye et risque de regret. L'export IA ne présente donc plus une coupe unique comme une certitude.
- `priorityScore` combine gain net, rareté du poste, durée de l'opportunité et Market Score. Les QB/K/DEF sont décotés dans cette ligue 1QB afin qu'un petit streaming upgrade ne masque pas un stash RB/WR asymétrique.
- **v2.2 livré** : le classement brut est traduit en décision. `ImmediateValue` mesure le gain net propre au roster, `StrategicUpside` le potentiel de marché/usage, et `DecisionClass` distingue `STARTER_UPGRADE`, `STREAMER`, `UPSIDE_STASH`, `HANDCUFF`, `INJURY_PROMOTION`, `BREAKOUT` et `NO_ACTION`. `RecommendedAction` vaut `ADD_NOW`, `CLAIM_IF_CHEAP`, `WATCH` ou `IGNORE`. Un fort potentiel avec gain net négatif devient explicitement `WATCH`, jamais une recommandation d'achat implicite.
- **Max pour moi** = `FAAB marché × Capture × part du gain restant après coût de coupe`, plafonné par le FAAB restant, avec un plancher à 0 $ si le gain net est nul.

## Boucle de feedback (ALGO FEEDBACK)
Chaque retour externe suit ce format et doit devenir une règle ou un test, jamais une
correction joueur par joueur :
```
ALGO FEEDBACK — <RÈGLE>
Player / Current output / Expected / Cause / Proposed rule
```
Les cas Braelon, Gordon, Keenan, Sadiq deviennent des tests de non-régression.

## Résultat v2 sur les données du 29/09 (semaine 4)
| Joueur | v1 | v2 marché | Footballguys | Commentaire |
|---|---|---|---|---|
| Ollie Gordon | 0–1 % | 17–29 % PRIORITÉ, fit Boukki 20 (max 58 $) | 10–20 % | Achane IR (ACL) + 84 % des snaps : SEASON_LONG |
| Wan'Dale Robinson | 3–7 % | 14–24 % PRIORITÉ | — | 11 targets en S3 : BREAKOUT |
| Kenyon Sadiq | 1–3 % | 4–7 %, **fit Boukki 0** | — | McBride titulaire, pas de bonus TE |
| Keenan Allen | 1–3 % | 3–5 % | 20–40 % | Pierce IR, mais Sleeper le projette à 6,8 pts ROS |
| Braelon Allen | 3–7 % | 3–5 % | 10–20 % | Sleeper projette le retour de Hall dès la S5 |

Les deux derniers écarts viennent de la baseline ROS de Sleeper, pas des règles d'événements.
C'est la prochaine cible (modèle de projection Adineu, Phase 1), à alimenter par la boucle de feedback.

## Mesures de succès
- Cas de référence : Gordon ≥ 10 % marché, Braelon ≥ 5 % (rental), Keenan ≥ 10 %, pas de QB
  en tête quand les 12 équipes ont un QB titulaire, Sadiq : Fit Boukki bas malgré un marché moyen.
- Backtest (Phase 2 du modèle de projection) : les adds `NEWS_OVERRIDE` battent-ils le
  remplacement sur 2–4 semaines ?
- Calibration : écart entre FAAB marché prédit et enchères gagnées suivantes dans la ligue.

## Cas limites
- Le titulaire revient (statut effacé) : l'événement disparaît automatiquement au calcul suivant.
- Comité (deux remplaçants de rang proche, ≤ 1,5× le rang du premier) : promotion partagée à 50 %.
  Exception : un joueur qui a pris ≥ 50 % des snaps au dernier match hérite du rôle en entier,
  quel que soit son rang (le rang Sleeper des remplaçants est souvent périmé : Gordon est 466e).
- Projections futures partielles : `rosPpg` n'est calculé que si le joueur est projeté sur au moins
  la moitié des semaines chargées ; sinon repli sur le rang (`rosSource: RANK_ESTIMATE`, affiché
  « (rang) »). Si des semaines, des stats ou l'index ne chargent pas, la réponse porte
  `degraded: true` + `coverage`, et l'UI l'affiche.
- Fourchette FAAB toujours plafonnée au budget (1 000 $ / 100 %).
- Le depth chart Sleeper peut être en retard sur la réalité : le SNAP_SURGE sert de second signal.
- Semaine 1 : pas d'historique de stats, donc pas de surge (seulement les promotions).
- Joueur coupé après avoir été réclamé : aucun traitement spécial, on repart des données actuelles.

## Hors scope v2
- Actualités textuelles (commentaires des coachs) : pas de source gratuite structurée. Ce
  signal reste manuel, via la boucle de feedback.
- Routes / first reads : voir `prd-adineu-projection-model.md`.
