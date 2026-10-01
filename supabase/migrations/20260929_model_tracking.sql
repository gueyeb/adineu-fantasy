-- Adineu Fantasy — suivi hebdomadaire du modèle (docs/prd-model-tracking.md).
-- Additif : aucune table existante n'est modifiée. Idempotent (if not exists / drop policy if exists).
--
-- Chaque mardi (après MNF, avant les waivers du mercredi) :
--   1. model_snapshots            : une ligne par semaine (version du modèle, réglages, couverture)
--   2. waiver_market_snapshots    : ce que le modèle estimait pour chaque free agent (marché, FAAB)
--   3. player_projection_snapshots: les projections Sleeper des semaines FUTURES telles qu'elles étaient ce jour-là
--   4. player_usage_snapshots     : Usage Score, xFP et signal buy-low / sell-high du moment
-- Puis le bilan de la semaine écoulée :
--   5. faab_outcomes              : enchères FAAB gagnées (Sleeper /transactions)
--   6. model_feedback             : rapport (calibrage FAAB, précision des projections par ancienneté, signaux)
-- Données dérivées de l'API publique Sleeper : lecture publique, écriture réservée à la clé secrète.

create table if not exists model_snapshots (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  week int not null,
  kind text not null default 'weekly',
  taken_at timestamptz not null default now(),
  model_version text not null,
  settings jsonb not null default '{}'::jsonb,   -- PRICE_PER_POINT, FAR_WEEK_USAGE_WEIGHT, ...
  coverage jsonb not null default '{}'::jsonb,
  unique (season, week, kind)
);

create table if not exists waiver_market_snapshots (
  snapshot_id uuid not null references model_snapshots(id) on delete cascade,
  sleeper_player_id text not null,
  name text,
  position text,
  nfl_team text,
  category text,
  market_score int,
  faab_low int,
  faab_high int,
  surplus_points numeric,
  effective_ppg numeric,
  ros_ppg numeric,
  news_override boolean not null default false,
  events jsonb,
  primary key (snapshot_id, sleeper_player_id)
);

create table if not exists player_projection_snapshots (
  snapshot_id uuid not null references model_snapshots(id) on delete cascade,
  sleeper_player_id text not null,
  target_week int not null,
  pts_ppr numeric not null,
  primary key (snapshot_id, sleeper_player_id, target_week)
);

create table if not exists player_usage_snapshots (
  snapshot_id uuid not null references model_snapshots(id) on delete cascade,
  sleeper_player_id text not null,
  position text,
  usage_score int,
  xfp numeric,
  ppg numeric,
  signal text,
  primary key (snapshot_id, sleeper_player_id)
);

create table if not exists faab_outcomes (
  season int not null,
  week int not null,                    -- leg Sleeper : enchères du mercredi après les matchs de la semaine `week`
  transaction_id text not null,
  sleeper_player_id text not null,
  roster_id int,
  bid int not null,
  processed_at timestamptz,
  primary key (transaction_id, sleeper_player_id)
);

create table if not exists model_feedback (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  week int not null,                    -- semaine évaluée (terminée)
  generated_at timestamptz not null default now(),
  report jsonb not null,
  message text,
  unique (season, week)
);

create index if not exists model_snapshots_season_week_idx on model_snapshots(season, week);
create index if not exists player_projection_snapshots_target_idx on player_projection_snapshots(target_week, sleeper_player_id);
create index if not exists faab_outcomes_season_week_idx on faab_outcomes(season, week);

alter table model_snapshots enable row level security;
alter table waiver_market_snapshots enable row level security;
alter table player_projection_snapshots enable row level security;
alter table player_usage_snapshots enable row level security;
alter table faab_outcomes enable row level security;
alter table model_feedback enable row level security;

drop policy if exists "public read model_snapshots" on model_snapshots;
drop policy if exists "public read waiver_market_snapshots" on waiver_market_snapshots;
drop policy if exists "public read player_projection_snapshots" on player_projection_snapshots;
drop policy if exists "public read player_usage_snapshots" on player_usage_snapshots;
drop policy if exists "public read faab_outcomes" on faab_outcomes;
drop policy if exists "public read model_feedback" on model_feedback;
create policy "public read model_snapshots" on model_snapshots for select using (true);
create policy "public read waiver_market_snapshots" on waiver_market_snapshots for select using (true);
create policy "public read player_projection_snapshots" on player_projection_snapshots for select using (true);
create policy "public read player_usage_snapshots" on player_usage_snapshots for select using (true);
create policy "public read faab_outcomes" on faab_outcomes for select using (true);
create policy "public read model_feedback" on model_feedback for select using (true);
