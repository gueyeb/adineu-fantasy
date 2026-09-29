# PRD — Suivi hebdomadaire du modèle (snapshots + bilan)

Statut : livré le 29/09/2026. Tables créées en prod (`supabase/migrations/20260929_model_tracking.sql`).

## Problème
Sleeper ne garde ni les projections futures telles qu'elles étaient à une date donnée, ni l'état
du marché waiver au moment des enchères. Sans archive, impossible :
- de calibrer le prix du point FAAB (on ne peut comparer une enchère qu'au marché du jour) ;
- de mesurer le vieillissement des projections lointaines, et donc le bon poids de l'usage
  au-delà de 2 semaines (le backtest 2021–2025 n'a que les projections « fraîches ») ;
- de vérifier chaque semaine que les signaux buy-low / sell-high tiennent.

## Solution
Un job unique, **chaque mardi** (après le Monday Night, avant les waivers du mercredi 09:00) :
1. **Bilan de la semaine terminée W-1** (`model_feedback`) :
   - enchères gagnées (`faab_outcomes`) vs fourchette du marché estimée le mardi d'avant :
     taux dans la fourchette, prix payé par point de surplus (médiane) ;
   - erreur des projections Sleeper selon leur ancienneté (0, 1, 2… semaines avant le match) ;
   - évolution des joueurs signalés buy-low / sell-high depuis le signal ;
   - **ALGO FEEDBACK** automatique : enchère aberrante vs prédiction, prix du point à recalibrer
     (écart > 40 % sur au moins 8 enchères), projections lointaines trop dégradées → plus
     de poids à l'usage.
2. **Snapshot de la semaine W** : marché waiver (`waiver_market_snapshots`), projections Sleeper
   des semaines W → 14 (`player_projection_snapshots`), Usage Score et signaux
   (`player_usage_snapshots`), réglages du modèle (`model_snapshots.settings`).

Idempotent : relancer la même semaine remplace son snapshot et son bilan.

## Déclenchement
- Production : `POST /api/model/weekly` avec `Authorization: Bearer $MODEL_JOB_TOKEN`
  (workflow n8n du mardi). Variables serveur requises : `MODEL_JOB_TOKEN`, `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`.
- Manuel : `npm run track:weekly:production` (lit `.env.production`) ; `-- --dry-run` pour tester
  sans rien écrire.
- Lecture : `GET /api/model/feedback[?format=text]` (dernier bilan) ; le site lit `model_feedback`
  en direct (clé publique) dans Trade Hub → Règles & Scoring → « Suivi du modèle ».

## Boucle de décision
Le bilan **propose**, il ne modifie jamais le modèle tout seul. Un changement de réglage
(`PRICE_PER_POINT`, `FAR_WEEK_USAGE_WEIGHT`) se fait en code, avec un test et une note dans
`docs/backtest-usage.md`, quand le signal est stable plusieurs semaines. Les retours externes
(ChatGPT) suivent le même format ALGO FEEDBACK (`docs/PRD.md` §10).

## Données et sécurité
Données dérivées de l'API publique Sleeper : lecture publique (RLS `select using (true)`),
écriture uniquement avec la clé secrète (serveur / CLI). Volume : environ 5 000 lignes par semaine.

## État au 29/09/2026
- Rattrapage : 32 enchères gagnées (S1–S2) et bilans S1–S3, sans snapshot antérieur (le suivi démarre en S4).
- Premier snapshot : S4 (198 free agents, 4 011 projections futures, 402 profils d'usage).
- Premier bilan exploitable : mardi 6 octobre (S4 terminée).
