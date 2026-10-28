/**
 * Adineu Fantasy — réglages du Coach privé (docs/prd-coach-settings.md).
 * Une ligne Supabase par saison / ligue, lue et écrite avec la clé secrète uniquement (table sans
 * policy publique). Tout ce qui entre est renormalisé ; sans table ou sans Supabase, les valeurs
 * par défaut s'appliquent et l'écriture est refusée, sans jamais casser le Coach.
 */
import { LEAGUE_METADATA_2026 } from "../public/assets/league-settings.js";
import { SLEEPER_MANAGER_ALIASES, rosterOptionLabel } from "../public/assets/manager-identity.js";
import { listRosterIdentities } from "../public/assets/roster-view.js";
import { createSupabaseFromEnv } from "./model-tracking.js";

const TABLE = "coach_settings";
export const NEAR_KICKOFF_HOURS = { min: 0.5, max: 24, step: 0.5, default: 3 };
export const OWNER_NAME_MAX = 40;
export const DEFAULT_COACH_SETTINGS = Object.freeze({ teamRosterId: null, deltaByDefault: false, nearKickoffHours: NEAR_KICKOFF_HOURS.default });

/** Unknown keys are dropped; an invalid value falls back to its default rather than being guessed. */
export function normalizeCoachSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const roster = Number(source.teamRosterId);
  const hours = Number(source.nearKickoffHours);
  const steps = Math.round(hours / NEAR_KICKOFF_HOURS.step) * NEAR_KICKOFF_HOURS.step;
  return {
    teamRosterId: source.teamRosterId !== null && Number.isInteger(roster) && roster >= 1 && roster <= 32 ? roster : null,
    deltaByDefault: source.deltaByDefault === true,
    nearKickoffHours: Number.isFinite(hours) && steps >= NEAR_KICKOFF_HOURS.min && steps <= NEAR_KICKOFF_HOURS.max ? steps : NEAR_KICKOFF_HOURS.default
  };
}

/** Strict check for a PUT: every provided field must be valid, nothing is silently corrected. */
export function validateCoachSettingsPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "Réglages invalides" };
  const allowed = ["teamRosterId", "deltaByDefault", "nearKickoffHours"];
  const unknown = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unknown.length) return { error: `Réglage inconnu : ${unknown.join(", ")}` };
  if ("teamRosterId" in patch && patch.teamRosterId !== null && !(Number.isInteger(patch.teamRosterId) && patch.teamRosterId >= 1 && patch.teamRosterId <= 32)) return { error: "Équipe invalide" };
  if ("deltaByDefault" in patch && typeof patch.deltaByDefault !== "boolean") return { error: "Mode des bulletins invalide" };
  if ("nearKickoffHours" in patch) {
    const hours = patch.nearKickoffHours;
    const { min, max, step } = NEAR_KICKOFF_HOURS;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < min || hours > max || Math.abs(hours / step - Math.round(hours / step)) > 1e-9) {
      return { error: `Fenêtre avant coup d’envoi : ${min} à ${max} h, par pas de ${step} h` };
    }
  }
  return { patch };
}

/** Explicit `team` of a bearer call > saved setting (roster id) > COACH_TEAM > "t0z". */
export function resolveCoachTeam({ param = null, settings = DEFAULT_COACH_SETTINGS, env = process.env } = {}) {
  if (param) return { team: String(param), source: "PARAM" };
  if (settings?.teamRosterId) return { team: String(settings.teamRosterId), source: "SETTINGS" };
  if (env.COACH_TEAM) return { team: env.COACH_TEAM, source: "ENV" };
  return { team: "t0z", source: "DEFAULT" };
}

/** `delta=1` / `delta=0` win; otherwise the saved default. */
export function resolveDeltaMode(param, settings = DEFAULT_COACH_SETTINGS) {
  if (param === "1") return true;
  if (param === "0") return false;
  return settings?.deltaByDefault === true;
}

/** A display name as typed: trimmed, 1–40 characters, no control character. */
export function normalizeOwnerName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > OWNER_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

const fold = value => String(value ?? "").trim().toLocaleLowerCase("fr");

/** Current season's rosters for the team picker: roster id + public label, no account ids. */
export async function listLeagueTeams({ fetchImpl = fetch, leagueId = LEAGUE_METADATA_2026.leagueId } = {}) {
  const get = path => fetchImpl(`https://api.sleeper.app/v1${path}`, { signal: AbortSignal.timeout(10_000) })
    .then(response => { if (!response.ok) throw new Error(`Sleeper HTTP ${response.status}`); return response.json(); });
  const [rosters, users] = await Promise.all([get(`/league/${leagueId}/rosters`), get(`/league/${leagueId}/users`)]);
  return listRosterIdentities(rosters, users).map(entry => {
    const user = users.find(row => row.user_id === entry.roster.owner_id);
    return { rosterId: Number(entry.roster.roster_id), label: rosterOptionLabel({ account: user?.display_name ?? null, teamName: user?.metadata?.team_name ?? null }) };
  }).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/** Owners for the settings panel: names, platform accounts (no private ids) and confirmed aliases. */
export function buildOwnerRows(owners = [], links = []) {
  const aliasesByManager = new Map();
  for (const [account, manager] of Object.entries(SLEEPER_MANAGER_ALIASES)) {
    if (!aliasesByManager.has(fold(manager))) aliasesByManager.set(fold(manager), []);
    aliasesByManager.get(fold(manager)).push(account);
  }
  return owners.map(owner => ({
    id: owner.id,
    displayName: owner.display_name,
    accounts: links.filter(link => link.owner_id === owner.id)
      .map(link => ({ platform: link.platform, name: link.platform_display_name ?? null }))
      .sort((a, b) => a.platform.localeCompare(b.platform)),
    confirmedAliases: aliasesByManager.get(fold(owner.display_name)) ?? []
  })).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

const RENAME_ERRORS = { NOM_INVALIDE: 400, PROPRIETAIRE_INCONNU: 404, NOM_MODIFIE_ENTRE_TEMPS: 409, NOM_DEJA_UTILISE: 409, NOM_INCHANGE: 400 };

export class CoachSettingsError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export function createCoachSettingsStore({ getSupabase = createSupabaseFromEnv, season = LEAGUE_METADATA_2026.season, leagueId = LEAGUE_METADATA_2026.leagueId, cacheMs = 30_000, now = () => Date.now() } = {}) {
  let client = null;
  let cached = null;
  const supabase = async () => (client ||= await getSupabase());
  const key = { season, league_id: String(leagueId) };
  return {
    /** Never throws: a missing table or Supabase falls back to the defaults, labeled. */
    async load({ fresh = false } = {}) {
      if (!fresh && cached && now() - cached.at < cacheMs) return cached.value;
      let value;
      try {
        const { data, error } = await (await supabase()).from(TABLE).select("settings, updated_at").match(key).maybeSingle();
        if (error) throw new Error(error.message);
        value = data ? { settings: normalizeCoachSettings(data.settings), source: "SAVED", updatedAt: data.updated_at }
          : { settings: { ...DEFAULT_COACH_SETTINGS }, source: "DEFAULT", updatedAt: null };
      } catch {
        value = { settings: { ...DEFAULT_COACH_SETTINGS }, source: "UNAVAILABLE", updatedAt: null };
      }
      cached = { at: now(), value };
      return value;
    },
    async save(patch) {
      const current = await this.load({ fresh: true });
      if (current.source === "UNAVAILABLE") throw new CoachSettingsError("SETTINGS_UNAVAILABLE", 503);
      const settings = normalizeCoachSettings({ ...current.settings, ...patch });
      const row = { ...key, settings, updated_at: new Date(now()).toISOString() };
      const { error } = await (await supabase()).from(TABLE).upsert(row, { onConflict: "season,league_id" });
      if (error) throw new CoachSettingsError("SETTINGS_UNAVAILABLE", 503);
      cached = { at: now(), value: { settings, source: "SAVED", updatedAt: row.updated_at } };
      return cached.value;
    },
    async listOwners() {
      const db = await supabase();
      const [owners, links] = await Promise.all([
        db.from("owners").select("id, display_name"),
        db.from("owner_platform_ids").select("owner_id, platform, platform_display_name")
      ]);
      if (owners.error || links.error) throw new CoachSettingsError("OWNERS_UNAVAILABLE", 503);
      return buildOwnerRows(owners.data, links.data);
    },
    /** Atomic rename + audit through the migration's function; refused when it is missing. */
    async renameOwner(ownerId, { expected, next }) {
      const name = normalizeOwnerName(next);
      if (!name) throw new CoachSettingsError("NOM_INVALIDE", 400);
      if (typeof expected !== "string") throw new CoachSettingsError("NOM_MODIFIE_ENTRE_TEMPS", 409);
      const { data, error } = await (await supabase()).rpc("rename_owner_display_name", { p_owner: ownerId, p_expected: expected, p_next: name });
      if (error) {
        const code = Object.keys(RENAME_ERRORS).find(candidate => String(error.message).includes(candidate));
        throw code ? new CoachSettingsError(code, RENAME_ERRORS[code]) : new CoachSettingsError("OWNER_RENAME_UNAVAILABLE", 503);
      }
      const change = Array.isArray(data) ? data[0] : data;
      return { ownerId: change.owner_id, previousName: change.previous_name, newName: change.new_name, changedAt: change.changed_at };
    }
  };
}

/** Same store contract, in memory: tests and local runs without Supabase. */
export function createMemoryCoachSettingsStore({ owners = [], links = [], settings = null } = {}) {
  let saved = settings ? normalizeCoachSettings(settings) : null;
  const audit = [];
  return {
    audit,
    async load() { return saved ? { settings: saved, source: "SAVED", updatedAt: null } : { settings: { ...DEFAULT_COACH_SETTINGS }, source: "DEFAULT", updatedAt: null }; },
    async save(patch) { saved = normalizeCoachSettings({ ...(saved ?? DEFAULT_COACH_SETTINGS), ...patch }); return { settings: saved, source: "SAVED", updatedAt: null }; },
    async listOwners() { return buildOwnerRows(owners, links); },
    async renameOwner(ownerId, { expected, next }) {
      const name = normalizeOwnerName(next);
      if (!name) throw new CoachSettingsError("NOM_INVALIDE", 400);
      const owner = owners.find(row => row.id === ownerId);
      if (!owner) throw new CoachSettingsError("PROPRIETAIRE_INCONNU", 404);
      if (owner.display_name !== expected) throw new CoachSettingsError("NOM_MODIFIE_ENTRE_TEMPS", 409);
      if (owners.some(row => row.id !== ownerId && fold(row.display_name) === fold(name))) throw new CoachSettingsError("NOM_DEJA_UTILISE", 409);
      if (owner.display_name === name) throw new CoachSettingsError("NOM_INCHANGE", 400);
      const change = { ownerId, previousName: owner.display_name, newName: name, changedAt: new Date().toISOString() };
      owner.display_name = name;
      audit.push(change);
      return change;
    }
  };
}
