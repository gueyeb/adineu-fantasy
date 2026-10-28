-- Adineu Fantasy — réglages du Coach privé (docs/prd-coach-settings.md).
-- Additif et idempotent. Donnée privée : RLS activé sans aucune policy, donc lecture et
-- écriture réservées à la clé secrète du serveur. Non appliquée automatiquement.

create table if not exists coach_settings (
  season int not null,
  league_id text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (season, league_id)
);

alter table coach_settings enable row level security;

-- Trace de chaque renommage d'un propriétaire canonique (owners.display_name).
create table if not exists owner_display_name_changes (
  id bigint generated always as identity primary key,
  owner_id uuid not null references owners(id),
  previous_name text not null,
  new_name text not null,
  changed_at timestamptz not null default now()
);

alter table owner_display_name_changes enable row level security;

-- Renommage atomique : l'ancien nom doit être celui lu par l'interface (pas d'écrasement
-- concurrent), le nouveau nom est unique sans tenir compte de la casse, et l'audit est écrit
-- dans la même transaction que le nom.
create or replace function rename_owner_display_name(p_owner uuid, p_expected text, p_next text)
returns table (owner_id uuid, previous_name text, new_name text, changed_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current text;
  v_next text := btrim(p_next);
begin
  if v_next is null or char_length(v_next) < 1 or char_length(v_next) > 40 or v_next ~ '[[:cntrl:]]' then
    raise exception 'NOM_INVALIDE';
  end if;
  select o.display_name into v_current from owners o where o.id = p_owner for update;
  if not found then
    raise exception 'PROPRIETAIRE_INCONNU';
  end if;
  if v_current is distinct from p_expected then
    raise exception 'NOM_MODIFIE_ENTRE_TEMPS';
  end if;
  if exists (select 1 from owners o where lower(o.display_name) = lower(v_next) and o.id <> p_owner) then
    raise exception 'NOM_DEJA_UTILISE';
  end if;
  if v_current = v_next then
    raise exception 'NOM_INCHANGE';
  end if;
  update owners set display_name = v_next where id = p_owner;
  return query
    insert into owner_display_name_changes as c (owner_id, previous_name, new_name)
    values (p_owner, v_current, v_next)
    returning c.owner_id, c.previous_name, c.new_name, c.changed_at;
end;
$$;

revoke all on function rename_owner_display_name(uuid, text, text) from public;
revoke all on function rename_owner_display_name(uuid, text, text) from anon, authenticated;
grant execute on function rename_owner_display_name(uuid, text, text) to service_role;
