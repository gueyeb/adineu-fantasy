# Benchmark privé : Adineu/Sleeper contre les experts

Date : 20 octobre 2026. État : **décidé (option a), en développement.**

## Problème

Le scorecard du mardi compare Adineu à Sleeper seulement. Sleeper n'est pas la meilleure référence : le consensus d'experts FantasyPros (ECR, ~20 à 100 experts) est le standard que tout modèle doit battre. Draft Sharks et CBS sont déjà collectés (`collect-projections.js`, Firecrawl Alexandria) mais seulement affichés, jamais notés. Sans mesure, on ne sait pas quelle source suivre pour start/sit et waivers.

## Solution

1. **Capture figée avant kickoff**, dimanche 05:00 ET (même workflow n8n que le contrôle avant verrouillage), une fois par semaine : la première capture d'une semaine gagne, comme les snapshots du mardi.
   - FantasyPros ECR hebdo PPR, QB/RB/WR/TE/K/DST : pages publiques `https://www.fantasypros.com/nfl/rankings/{qb,ppr-rb,ppr-wr,ppr-te,k,dst}.php` (QB/K/DST publiés en STD, identiques en PPR hors réceptions), objet `ecrData` (`rank_ecr`, `pos_rank`, `r2p_pts`, `player_game_kickoff_ts`, `total_experts`, `last_updated`). 6 requêtes par semaine, rien d'autre.
   - Draft Sharks + CBS (RB/WR/TE) via Firecrawl si `FIRECRAWL_API_KEY` est configuré ; sinon source absente, jamais inventée.
   - Sleeper `pts_ppr` relu au même instant, pour une cohorte identique.
2. **Stockage** : Supabase `model_snapshots`, kind `expert-rankings-v1`, une ligne par semaine (aucune migration).
3. **Notation au job du mardi** sur les points PPR réels (Sleeper `/stats`), par source × poste :
   - cohorte appariée source ∩ Sleeper (et une cohorte commune à toutes les sources disponibles), joueurs dont le match commence après la capture (exclut le TNF) ;
   - Spearman rang prédit vs rang réel, MAE en points (si la source en publie), taux de réussite top-N (top 12 QB/TE/K/DST, top 24 RB, top 36 WR) ;
   - cumul saison + semaine, `n` toujours affiché.
4. **Sortie** : section « Experts vs Adineu » dans `model_feedback` (rapport + message Telegram du mardi). Rien sur le site public.

## Hors périmètre

- Afficher ou republier les classements tiers (CGU, droits) : privé uniquement, champs minimaux.
- Fantasy Life (payant).
- Remplacer ou mélanger les projections : décision seulement après échantillon suffisant (≥ 4 semaines).

## Contraintes et cas limites

- Identité : FantasyPros → Sleeper par nom normalisé + équipe + poste, candidat unique seulement ; sinon exclu et compté. DST par équipe.
- Bye, inactifs : un joueur inactif a 0 réel ; il reste dans la cohorte s'il était classé (c'est une erreur de la source).
- Source en échec ou format changé : capture partielle marquée, aucune note pour cette source.
- Barème : PPR pour tous (les sources publient en PPR). Le barème Adineu (INT −2, kickers…) n'entre pas dans la comparaison.

## Mesure du succès

Après 4 semaines : savoir, par poste, si Sleeper/Adineu bat le consensus FantasyPros sur rang et points, avec n et écart. Décider alors : garder Sleeper, mélanger, ou afficher l'ECR en contexte privé.

## Approche technique

Module pur `public/assets/expert-benchmark.js` (parse, rapprochement, métriques) ; `scripts/expert-benchmark.js` (capture, stockage, notation) ; route job `POST /api/model/experts/capture` (bearer `MODEL_JOB_TOKEN`) ; notation appelée par `runWeeklyJob`. Tests sur fixtures, aucun réseau.
