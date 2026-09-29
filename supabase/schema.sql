-- Adineu Fantasy League — schema Supabase (Postgres)
-- Phase 1 : porte Sleeper (2026, live). Phase 2 ajoutera Yahoo (2025, cold extract)
-- dans les mêmes tables, sans changement de structure — c'est tout le point.
--
-- Modèle mental : owners = golden record des amis, à travers les plateformes.
-- Tout le reste (seasons/teams/matchups) est scopé par plateforme + saison,
-- et rattaché à owners via owner_platform_ids. Rosters/joueurs NFL détaillés
-- sont hors scope v1 (Phase 3+ si un jour utile pour du power-ranking fin).

create extension if not exists pgcrypto; -- pour gen_random_uuid()

-- ============================================================
-- owners : identité canonique d'un ami, indépendante de toute plateforme.
-- Créée automatiquement au premier sync avec le display_name Sleeper comme
-- valeur de départ — à renommer à la main ensuite si besoin (le sync ne
-- touche plus jamais display_name une fois la ligne créée).
-- ============================================================
create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- owner_platform_ids : mappe un identifiant plateforme (sleeper user_id,
-- yahoo manager id, ...) vers un owner canonique. C'est la table de
-- réconciliation — le vrai sujet MDM de ce projet.
-- ============================================================
create table if not exists owner_platform_ids (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  platform text not null check (platform in ('yahoo', 'sleeper', 'nfl')),
  platform_user_id text not null,
  platform_display_name text, -- valeur brute vue côté plateforme, pour audit
  created_at timestamptz not null default now(),
  unique (platform, platform_user_id)
);

-- ============================================================
-- seasons : une ligue, sur une plateforme, pour une année.
-- ============================================================
create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  platform text not null check (platform in ('yahoo', 'sleeper', 'nfl')),
  league_external_id text not null,
  league_name text,
  status text, -- pre_draft / in_season / complete
  playoff_week_start int,
  updated_at timestamptz not null default now(),
  unique (platform, league_external_id, year)
);

-- ============================================================
-- teams : une équipe, pour une saison donnée, rattachée à un owner canonique.
-- Standings dérivables directement de wins/losses/ties/points_for.
-- ============================================================
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  owner_id uuid not null references owners(id),
  team_name text,
  external_roster_id text not null, -- sleeper roster_id (texte) ou yahoo team_key
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points_for numeric not null default 0,
  points_against numeric not null default 0,
  final_rank int, -- rempli en fin de saison (classement final)
  is_keeper_team boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (season_id, external_roster_id)
);

-- ============================================================
-- matchups : détail semaine par semaine, une ligne par équipe par semaine
-- (donc 2 lignes par affrontement — plus simple à requêter que 1 ligne/paire).
-- ============================================================
create table if not exists matchups (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  week int not null,
  team_id uuid not null references teams(id) on delete cascade,
  opponent_team_id uuid references teams(id),
  points numeric,
  opponent_points numeric,
  is_playoff boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (season_id, week, team_id)
);

-- ============================================================
-- Vue pratique pour la page standings publique : classement lisible direct,
-- sans jointure à écrire côté frontend.
-- ============================================================
create or replace view v_standings
with (security_invoker = true) as
select
  s.year,
  s.platform,
  s.league_name,
  o.display_name as owner_name,
  t.team_name,
  t.wins,
  t.losses,
  t.ties,
  t.points_for,
  t.points_against,
  t.final_rank,
  row_number() over (
    partition by t.season_id
    order by t.wins desc, t.points_for desc
  ) as live_rank
from teams t
join seasons s on s.id = t.season_id
join owners o on o.id = t.owner_id;

-- Index foreign keys used by joins and cascading deletes.
create index if not exists owner_platform_ids_owner_id_idx on owner_platform_ids(owner_id);
create index if not exists teams_owner_id_idx on teams(owner_id);
create index if not exists matchups_team_id_idx on matchups(team_id);
create index if not exists matchups_opponent_team_id_idx on matchups(opponent_team_id);

-- Lecture publique (le site est en lecture seule) : autorise l'anon key
-- Supabase à lire ces tables/vue, sans écriture possible depuis le front.
alter table owners enable row level security;
alter table owner_platform_ids enable row level security;
alter table seasons enable row level security;
alter table teams enable row level security;
alter table matchups enable row level security;

create policy "public read owners" on owners for select using (true);
create policy "public read seasons" on seasons for select using (true);
create policy "public read teams" on teams for select using (true);
create policy "public read matchups" on matchups for select using (true);
-- owner_platform_ids : pas de policy select publique -> reste prive (contient
-- des identifiants de plateforme, pas utile côté public, pas de fuite inutile).

-- ============================================================
-- Suivi hebdomadaire du modèle — voir supabase/migrations/20260929_model_tracking.sql
-- ============================================================
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
  week int not null,
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
