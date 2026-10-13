-- Adineu Fantasy — synchronisation du Waiver War Room (docs/prd-waiver-war-room.md).
-- Additif et idempotent. Une ligne par saison / ligue / roster : la watchlist choisie par
-- l'utilisateur (date + motif) et l'historique des enchères relevées. Donnée privée du Coach :
-- RLS activé sans aucune policy, donc lecture et écriture réservées à la clé secrète du serveur.

create table if not exists coach_war_room (
  season int not null,
  league_id text not null,
  roster_id int not null,
  watchlist jsonb not null default '[]'::jsonb,
  bid_history jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (season, league_id, roster_id)
);

alter table coach_war_room enable row level security;
