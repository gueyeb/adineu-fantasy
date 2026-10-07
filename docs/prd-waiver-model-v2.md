# PRD — Waiver Evaluation Model v2 (Event → Opportunity → Roster Fit → FAAB)

Statut : validé pour implémentation, 29/09/2026. Origine : retour « ALGO FEEDBACK » (ChatGPT,
post-semaine 3), vérifié sur les données Sleeper.

## Mise à jour fiabilité — backlog du 04/10/2026

Le [contrat de fiabilité](decision-reliability-2026-10-04.md) définit désormais la disponibilité,
les preuves serveur expirantes, les transactions complètes, les horizons et les actions. Les
exemples datés ci-dessous sont des observations de l’ancien export, pas des annonces NFL actuelles.
Les formules historiques de marché restent à calibrer ; la durée IR/ACL et les promotions ne
constituent plus des faits confirmés.

## Problème (constaté semaine 4)

| Joueur | Sortie v1 | Référence (Footballguys) | Ce que l'algo ignorait |
|---|---|---|---|
| Braelon Allen (NYJ RB) | STREAMING 3–7 % | 10–20 % | Breece Hall **Out** (cuisse), Allen RB2 au depth chart |
| Ollie Gordon (MIA RB) | PROFONDEUR 0–1 % | 10–20 % | Achane **IR, ACL** (ancien export : fin de saison supposée, non confirmée ici) ; Gordon 61/73 snaps (84 %), 17 courses en S3 |
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
| `UNCERTAIN` | titulaire Doubtful / IR / PUP / Sus, retour non confirmé | 1, scénario conditionnel |
| `SHORT_2_4W` | durée de rôle explicitement sourcée | fenêtre sourcée, pas déduite de IR |
| `SEASON_LONG` | fin de saison explicitement confirmée | toutes les restantes |
| `BREAKOUT` | SNAP/USAGE_SURGE sans blessure devant lui | restantes, confiance moyenne |

Rythme dans le rôle : `rolePpg = ros + confiance × (preuve − ros)`, où `preuve = max(ros, projection
semaine N, moyenne des 2 derniers matchs, points du dernier match s'il y a joué ≥ 60 % des snaps)`.
Confiance 75 % pour une promotion expliquée par une blessure, 50 % pour un BREAKOUT sans cause
(un seul match est un signal, pas une certitude). Hors du rôle : `rosPpg`, plus 10 % du surplus
de rôle en valeur de menotte (contingence) une fois le titulaire revenu.

Le rang Sleeper/depth chart servent uniquement à repérer un événement potentiel. Ils ne prouvent pas la titularisation du successeur. La confirmation est datée, sourcée et expirante ; le scénario de lineup utilise les projections de chaque semaine, et non le rythme maximal ci-dessus.

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

### 7. Fit roster et action (contrat actuel)

- Simuler chaque transaction ajout + coupe ; inclure les titulaires remplaçables au même poste,
  protéger IR/slots verrouillés, éviter une coupe lorsque le roster actif a une place libre.
- Comparer les meilleures lineups sur chaque semaine du rôle. Produire delta cible, slots,
  horizon, gains bruts/net totaux et moyennes explicites. Couverture insuffisante : total `null`.
- La production perdue après coupe est déjà dans ce calcul ; seule la prime d'option estimée
  est soustraite séparément, sur le même horizon. Pas de double comptage de cette production.
- Capture = part du surplus marché dans la lineup, jamais probabilité d'enchère gagnante.
- Détecter les événements ne confirme pas une promotion. Availability, kickoff et déblocage
  doivent être vérifiés avant `ADD_NOW`/`CLAIM_IF_CHEAP`.
- Les préférences datées affectent l’utilité, sans modifier le gain fantasy. Le plan multi-claims recalcule roster, coupes distinctes et budget après chaque ajout hypothétique.
- Le plafond personnel est borné par FAAB restant, marché et utilité nette totale × 3 $ ; enchère
  proposée distincte, zéro si scénario conditionnel. Les scénarios de claims sont alternatifs.

Voir [champs, configuration et limites](decision-reliability-2026-10-04.md).

## Boucle de feedback (ALGO FEEDBACK)
Chaque retour externe suit ce format et doit devenir une règle ou un test, jamais une
correction joueur par joueur :
```
ALGO FEEDBACK — <RÈGLE>
Player / Current output / Expected / Cause / Proposed rule
```
Les cas Braelon, Gordon, Keenan, Sadiq deviennent des tests de non-régression.

## Résultat historique v2 sur les données du 29/09 (non représentatif du contrat actuel)
| Joueur | v1 | v2 marché | Footballguys | Commentaire |
|---|---|---|---|---|
| Ollie Gordon | 0–1 % | 17–29 % PRIORITÉ, fit Boukki 20 (max 58 $) | 10–20 % | Ancienne hypothèse SEASON_LONG sur IR/ACL ; désormais non confirmée |
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
  Ancienne heuristique de marché : un joueur qui a pris ≥ 50 % des snaps est valorisé au rôle entier,
  quel que soit son rang. Cette hypothèse reste à auditer et ne confirme pas une succession.
- Projections futures partielles : `rosPpg` n'est calculé que si le joueur est projeté sur au moins
  la moitié des semaines chargées ; sinon repli sur le rang (`rosSource: RANK_ESTIMATE`, affiché
  « (rang) »). Si des semaines, des stats ou l'index ne chargent pas, la réponse porte
  `degraded: true` + `coverage`, et l'UI l'affiche.
- Fourchette FAAB toujours plafonnée au budget (1 000 $ / 100 %).
- Le depth chart Sleeper peut être en retard sur la réalité : le SNAP_SURGE sert de second signal.
- Semaine 1 : pas d'historique de stats, donc pas de surge (seulement les promotions).
- Joueur coupé : propriété et transactions relues ; disponibilité UNKNOWN tant que le déblocage n’est pas confirmé.

## Hors scope v2
- Actualités textuelles (commentaires des coachs) : pas de source gratuite structurée. Ce
  signal reste manuel, via la boucle de feedback.
- Routes / first reads : voir `prd-adineu-projection-model.md`.

### Mise à jour du 05/10 — rythme marché (DEC-08)

Le rythme marché historique fondé sur `max(ROS, projection, points récents)`, les poids
75/50 %, le partage inféré et le bonus de contingence est remplacé par
`PROJECTION_WINDOW_V1`. ROS reste la base ; une projection cible temporaire est limitée
à la fenêtre de rôle. Un match exceptionnel ne devient plus un rythme durable. Méthode
et limites sont exportées ; calibration FAAB et provenance complète restent ouvertes.
Voir [le contrat et les validations](decision-reliability-2026-10-04.md).

### Coût opérationnel des actions — 5 octobre 2026

`ADD_NOW` sur un agent libre vérifié a une enchère proposée de zéro : il ne consomme pas le FAAB. Le plafond personnel reste une estimation distincte de volonté de payer. Seul `CLAIM_IF_CHEAP` propose une enchère réservée dans le plan conditionnel. Un plan refuse un `ADD_NOW` portant un coût d’enchère non nul.

### Horizons des acquisitions successives — 5 octobre 2026

Le plan conditionnel conserve maintenant la fenêtre de rôle évaluée pour chaque acquisition supposée réussie. Si un calcul ultérieur utilise ce joueur après cette fenêtre, son gain reste inconnu et le scénario est bloqué (`UNCONFIRMED_PRIOR_ACQUISITION_ROLE_WEEK_N`). Cela couvre aussi le coût permanent des coupes après le rôle du deuxième ajout. Aucune projection zéro ni prolongation du rôle n’est inventée ; cette règle conservatrice peut raccourcir un plan même si le joueur resterait utile après son rôle temporaire. Une nouvelle évaluation sur un snapshot actualisé reste nécessaire. Les plans couvrant des rôles sur toute la période restent disponibles.

Validation : reproduction du défaut avant correction, propagation de la fenêtre entre étapes, régressions budget/coupes distinctes/place libre ; **265 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### Durée confirmée commune au marché et au roster — 5 octobre 2026

Une durée de rôle provenant d’une preuve actuelle et confirmée prend désormais priorité sur les étiquettes heuristiques `BREAKOUT`, `SEASON_LONG` et sur l’absence d’événement détecté. L’estimation marché utilise cette fenêtre explicite, plafonnée aux semaines de saison régulière restantes ; le scénario ajout–coupe reçoit exactement la même durée normalisée. `marketEstimate.roleWindowSource` distingue la preuve confirmée du repli heuristique/ROS. Sans preuve valide, les règles ROS et locations existantes restent applicables. Cette durée ne constitue pas une garantie de production ; le mélange de projections reste une estimation non calibrée.

Validation : défaut reproduit avant correction, quatre étiquettes testées et plafonnement en S14, rejeu hors ligne et conflits QB préservés ; **266 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.

### FAAB inconnu — 5 octobre 2026

Un solde FAAB absent ou invalide reste `null` dans les plans conditionnels (`budgetKnown=false`, `UNKNOWN_FAAB_BALANCE`). Pour un scénario légal et couvert, le plafond personnel reste inconnu ; une enchère passe en `WATCH` avec ce motif. Un scénario inexécutable garde son plafond de zéro. Les ajouts libres vérifiés à coût zéro restent possibles et ne transforment pas le solde inconnu en zéro. Les champs budgetBefore/budgetAfter restent null ; reservedFaab=0 décrit uniquement les fonds réservés par ce plan. La convention Sleeper existante « waiver_budget_used absent = zéro dépensé » reste distincte de ce contrôle sur un solde explicitement inconnu.

Validation : reproduction du plafond inventé, ajout gratuit avec solde inconnu, blocage de claim et régressions scénarios inexécutables ; **268 tests passent**, contrôles statiques et assets réussis. Aucun déploiement.


### Claims alternatifs — 7 octobre 2026

Le plan gagnant glouton reste disponible ; `alternativeClaimGroups` et `claimPortfolio` ajoutent les replis sur une coupe/place libre partagée au même instant de traitement. Chaque issue recalcule roster, rôle et FAAB. Le maximum des scénarios détaillés distingue les alternatives de dépenses cumulées ; exploration limitée à seize scénarios, maximum global inconnu si tronquée. Les claims cumulables avec deux coupes justifiées restent disponibles. Aucun automatisme de soumission ou d’annulation Sleeper. [Contrat, limites et evals](conditional-claim-portfolio-2026-10-07.md). Rendu local partagé Waiver/AI Context/Coach, utilisable dans le message n8n ; aucun déploiement.

### 07/10 — utilité TE supplémentaire

Diagnostic partagé des semaines TE/FLEX, bye couvert dans le rôle, coût de coupe et gain net. Aucun score ou prix nouveau ; secours sur blessure future et valeur d’une acquisition alternative inconnus. [Contrat et evals](te-roster-utility-2026-10-07.md).
