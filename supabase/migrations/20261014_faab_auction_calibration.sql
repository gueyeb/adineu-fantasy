-- Adineu Fantasy — calibrations du modèle d'enchères FAAB (docs/prd-model-challenge.md, chantier 1).
-- Additif et idempotent. Une ligne par calibration écrite par le job du mardi (POST /api/model/weekly) ;
-- le serveur lit la plus récente de la saison, sinon public/data/faab-auction-calibration.json.
-- Historique conservé pour suivre la validation semaine après semaine. RLS activé sans policy : clé secrète seule.

create table if not exists faab_auction_calibrations (
  id bigint generated always as identity primary key,
  season int not null,
  last_leg int not null,
  generated_at timestamptz not null default now(),
  calibration jsonb not null
);

create index if not exists faab_auction_calibrations_season_idx on faab_auction_calibrations(season, generated_at desc);

alter table faab_auction_calibrations enable row level security;
