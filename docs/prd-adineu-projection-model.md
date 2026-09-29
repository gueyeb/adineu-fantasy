# PRD — Modèle de projection Adineu (chantier 2)

Statut : proposition, 29 septembre 2026. Source d'entrée : `adineu-fantasy-technical-architecture.md`
(V1 du 28/09). Ce PRD le rend exécutable et tranche ce qu'il laisse ouvert.

## Problème

Tous nos outils (Trade Finder, Waiver Wire, Start/Sit, Game Center) reposent sur deux entrées
qu'on ne contrôle pas :

1. **Projection hebdo Sleeper** : une seule semaine, absente pour les joueurs Out/IR, aucune vue
   reste-de-saison (ROS). Un trade se juge sur 10 semaines, pas une.
2. **Valeur marché** = `players-catalog.json`, ECR FantasyPros + ADP **figés au 6 septembre 2026**
   (pré-draft). Semaine 4 : les valeurs de trade ignorent 3 semaines de réalité (rôles,
   blessures, breakouts). C'est la cause principale des trades « équitables » qui semblent
   absurdes.

Le correctif du 29/09 (estimation ROS = taux sain × part des matchs restants joués) a rendu le
Trade Finder fonctionnel, mais le « taux sain » reste une projection Sleeper ou un rang d'expert
pré-saison. Il nous faut notre propre estimation, reproductible, adaptée au scoring de la ligue.

## Objectif

Un modèle **Adineu** qui produit, chaque mardi, pour chaque joueur fantasy pertinent :
`projected_ppr` (semaine N), `ros_ppg` (moyenne semaines N→14), `p20/p80`, `confidence`, et
la provenance de chaque entrée. Consommé par tous les outils existants à la place des sources brutes.

Principe : **ne pas battre les experts sur tout — les combiner et corriger là où on a un avantage.**
Notre avantage : scoring exact de la ligue, statuts de blessure datés, horizon ROS, et signaux
d'usage (targets, air yards, snaps) sur lesquels le consensus réagit avec retard.

## Non-objectifs

- Pas de routes / TPRR / first reads tant qu'aucun flux complet licencié n'est vérifié (cf. doc
  d'architecture : `NULL`, jamais imputé).
- Pas de probabilité d'enchère FAAB, pas de cotes « officielles ».
- Pas de scraping de contenus payants (ESPN+ / Mike Clay, PFF) : voir Licences.

## Approche — trois phases, chacune livrable seule

### Phase 0 — Marché frais sans source payante (1–2 jours) · gain immédiat
Décision du 29/09 : **pas de FantasyPros ni de source commerciale pour l'instant** (à rediscuter
plus tard). Sleeper publie déjà ses projections pour **chaque semaine future** (vérifié le 29/09 :
≈1 000 joueurs projetés en sem. 6, 10 et 14), ce qui suffit pour une vraie base ROS gratuite.
- Job hebdo (mardi) : somme des projections Sleeper semaines N→14 par joueur (byes = 0 déjà
  intégrés par Sleeper), statuts blessure, production réelle de la ligue. Version + horodatage.
- `trade-value.js` / `restOfSeasonEstimate` lisent ce ROS au lieu de l'ECR draft du 06/09 et de
  la seule semaine N. Aucune autre logique ne change.
- Critère : plus aucune valeur marché datée de plus de 8 jours pendant la saison.

### Phase 1 — Projection Adineu v1 (≈1–2 semaines)
Modèle **opportunité × efficacité**, position par position (WR/TE d'abord, puis RB, puis QB) :

```
targets_attendus  = volume_passes_équipe (rolling, shrink vers moyenne ligue)
                    × target_share joueur (fenêtres 1/3/5 matchs joués, shrink vers prior de rôle)
receptions/yards/TD = targets × taux (catch, yards/target, TD/target) shrink vers moyennes du poste
carries / rush idem pour RB ; QB = dropbacks × efficacité
projected_ppr     = scorer officiel Adineu 2026 (league-settings.js, versionné)
```
Puis **blend** avec le consensus disponible (Sleeper aujourd'hui, autre source plus tard) :
`final = w·adineu + (1−w)·consensus`, `w` appris par poste en backtest (stacking simple, pas de
ML opaque). Sans consensus → Adineu seul, `confidence` abaissée.

ROS : `ros_ppg = Σ_{s=N..14} projected(s) × P(joue s)`, `P(joue)` depuis le statut daté
(barème actuel de `trade-score.js` : Out 1 match, IR/PUP 3) et les byes officiels.

### Phase 2 — Validation et intégration (≈1 semaine)
- Backtest **par date de décision** (données connues avant mardi 23:59), saisons 2024–2025,
  2026 tenu à part chronologiquement.
- Métriques : MAE points/semaine par poste, rappel top-12/top-24, calibration p20/p80, et
  « les adds recommandés battent-ils le remplacement sur 2–4 semaines ».
- **Gate de mise en prod** : le blend doit battre le consensus seul en MAE sur au moins 3 postes
  sur 4, sinon on publie le consensus et on continue d'itérer.
- Intégration : `projected_ppr` / `ros_ppg` alimentent `trade-score.js`,
  `waiver-opportunity.js`, `lineup-advisor.js`, `matchups-live.js` via un seul fichier
  `public/data/projections-2026-wNN.json` (+ pointeur `latest`).

## Sources

| Besoin | Source | Statut / licence |
|---|---|---|
| Play-by-play, stats hebdo, snaps, injuries historiques | nflverse (`nflreadpy` ou fichiers CSV/Parquet des releases GitHub) | Ouvert, attribution. Vérifier la licence de chaque dataset (FTN charting ≠ PBP). |
| Rosters ligue, statuts, projections Sleeper | Sleeper API | Gratuit, **non commercial**. |
| Consensus projections hebdo + futures | Sleeper `/projections/nfl/regular/{season}/{week}` | Gratuit, non commercial. **Source consensus V1.** |
| Consensus experts (ECR ROS) | FantasyPros API officielle | **Reporté** (décision 29/09) ; à rediscuter avec l'ouverture grand public. |
| Mike Clay / ESPN | Projections ESPN (API non documentée) ou PDF ESPN+ | **Benchmark interne uniquement**, jamais redistribué ni scrappé derrière paywall. |
| Routes / first reads | FTN Data, Fantasy Points Data | Achat seulement après la Phase 2, si le backtest montre que c'est ce qui manque. |

## Architecture — décision pragmatique

Le doc d'architecture propose Python + DuckDB + Parquet. **On le garde pour le pipeline batch**
(nflreadpy n'existe qu'en Python/R, DuckDB est idéal pour les backtests as-of), mais isolé :

```
model/                  # Python, hors du site, lancé par cron/n8n le mardi
  pyproject.toml
  src/adineu_model/{providers,transforms,model,publish}.py
  tests/                # scorer, as-of, identité, ownership (cf. doc)
public/data/projections-2026-wNN.json   # seul contrat avec le site
```
Le site reste Node sans dépendance ; il ne lit qu'un JSON versionné. Pas de Supabase ni de
queue pour ce modèle en V1. Identité joueur : `gsis_id` ↔ `sleeper_id` via la table de
correspondance nflverse, **jamais de jointure par nom** ; la file des non-résolus est revue à la main.

## Contrat JSON publié

`{ model_version, generated_at, as_of, data_through_week, forecast_week, provisional,
players: [{ sleeper_id, gsis_id, name, position, team, status, projected_ppr, ros_ppg, p20, p80,
consensus_ppr|null, confidence, inputs: { targets_3, target_share_3, air_yards_share_3, snaps_pct_3,
routes: null }, sources: [...] }] }`

L'UI affiche toujours la fraîcheur (`as_of`) et « estimation Adineu », jamais un chiffre présenté
comme officiel.

## Cas limites

- Rookie / changement d'équipe : prior de rôle (rang ADP/ECR) jusqu'à 3 matchs joués.
- Blessure en cours de match : le match compte comme partiel (snaps), pas comme référence d'usage.
- Bye, DNP, match non terminé, donnée absente = états distincts (`game_status`, `coverage_status`).
- Changement de QB : volume équipe recalculé, la part du joueur conservée avec confiance réduite.
- K / DEF : scorers dédiés ; V1 = consensus seul.
- Correction de stats nflverse le mercredi : upsert idempotent par `game_id + player_key`.

## Mesures de succès

- Phase 0 : 0 valeur marché > 8 jours ; proportion de trades proposés jugés « absurdes » par
  les managers (retour qualitatif) en baisse.
- Phase 2 : MAE blend < MAE consensus (gate ci-dessus) ; top-24 WR recall ≥ consensus.
- Produit : pages Trade Hub sans aucune mention « indisponible » hors panne source réelle.

## Ouverture grand public

Prérequis avant toute ouverture : (1) remplacer ou licencier chaque source non commerciale
(Sleeper, FantasyPros) ; (2) multi-ligues (ID de ligue + scoring lus depuis Sleeper, plus rien
d'Adineu en dur : `SLEEPER_LEAGUE_ID`, `t0z`, `league-settings.js`) ; (3) comptes et quotas ;
(4) coûts d'API. Le modèle lui-même est générique dès lors que le scorer est paramétré par ligue.

## Questions ouvertes

1. Hébergement du job Python : même serveur que le site, ou n8n + runner séparé ?
2. Sources commerciales (FantasyPros, etc.) et ouverture grand public : reportées, à rediscuter
   une fois le modèle validé en backtest.
