-- Adineu Fantasy — journal des décisions réelles (docs/prd-model-challenge.md, chantier 5).
-- Additif et idempotent. Une ligne par mouvement réel d'une équipe (claim gagné/perdu, ajout
-- libre, coupe, trade), par lineup de semaine terminée, et par plan du modèle enregistré le mardi
-- (kind MODEL_PLAN). Le motif (reason) est saisi par l'opérateur ; la synchro Sleeper ne l'envoie
-- jamais, donc ne l'écrase jamais. Donnée privée du Coach : RLS activé sans policy, clé secrète seule.

create table if not exists decision_log (
  id text primary key,
  season int not null,
  roster_id int not null,
  week int,
  kind text not null,
  occurred_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  outcome jsonb,
  model jsonb,
  reason text,
  reason_at timestamptz,
  source text not null,
  updated_at timestamptz not null default now()
);

create index if not exists decision_log_roster_idx on decision_log(season, roster_id, week);

alter table decision_log enable row level security;
