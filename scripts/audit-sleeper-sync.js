#!/usr/bin/env node
/** Public GET-only comparison. Never invokes the sync function or reads server credentials. */
import { pathToFileURL } from "node:url";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../public/assets/public-data-source.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
const leagueId = "1392715510830878721";
const score = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const officialScore = row => row.custom_points !== null && row.custom_points !== undefined ? score(row.custom_points) : score(row.points);

export function compareSyncWeek({ week, sourceRows = [], storedRows = [], rosterIds = [] }) {
  const issues = [];
  const expected = new Set(rosterIds.map(String));
  const values = (rows, idOf, scoreOf, side) => {
    const map = new Map();
    for (const row of rows) {
      const id = String(idOf(row));
      if (!expected.has(id)) issues.push({ type: "UNKNOWN_ROSTER", side });
      if (map.has(id)) issues.push({ type: "DUPLICATE_ROSTER", side, rosterId: id });
      map.set(id, scoreOf(row));
    }
    for (const id of expected) if (!map.has(id)) issues.push({ type: "MISSING_ROSTER", side, rosterId: id });
    return map;
  };
  const source = values(sourceRows, row => row.roster_id, officialScore, "Sleeper");
  const stored = values(storedRows, row => row.team?.external_roster_id, row => score(row.points), "stored");
  for (const id of expected) {
    if (!source.has(id) || !stored.has(id)) continue;
    if (source.get(id) === null || stored.get(id) === null) issues.push({ type: "MISSING_SCORE", rosterId: id });
    else if (Math.abs(source.get(id) - stored.get(id)) > 0.00001) issues.push({ type: "SCORE_MISMATCH", rosterId: id, sleeper: source.get(id), stored: stored.get(id) });
  }
  if (source.size && [...source.values()].every(value => value === 0)) issues.push({ type: "SOURCE_ALL_ZERO_UNCONFIRMED" });
  const dates = storedRows.map(row => row.updated_at).filter(value => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { week, status: issues.length ? "REVIEW" : "MATCH", sourceRows: sourceRows.length, storedRows: storedRows.length,
    oldestStoredUpdateAt: dates[0] || null, newestStoredUpdateAt: dates.at(-1) || null, issues };
}

export async function auditSleeperSync({ fetchImpl = fetch, season = 2026, asOf = new Date().toISOString() } = {}) {
  const sources = [];
  async function get(url, headers) {
    const response = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Audit source returned HTTP ${response.status}`);
    sources.push({ url, fetchedAt: new Date().toISOString() });
    return response.json();
  }
  const api = "https://api.sleeper.app/v1";
  const [league, state, rosters] = await Promise.all([get(`${api}/league/${leagueId}`), get(`${api}/state/nfl`), get(`${api}/league/${leagueId}/rosters`)]);
  if (Number(league.season) !== season || Number(state.season) !== season || state.season_type !== "regular" || league.status !== "in_season") throw new Error("Audit limited to the active regular season; season/state mismatch");
  const currentWeek = resolveOperationalWeek(state);
  const rosterIds = rosters.map(row => String(row.roster_id));
  if (new Set(rosterIds).size !== league.total_rosters || rosterIds.length !== league.total_rosters) throw new Error("Roster coverage unavailable");
  const query = new URLSearchParams({ select: "week,points,updated_at,is_playoff,team:teams!matchups_team_id_fkey(external_roster_id,season:seasons!inner(year,platform))", "team.season.year": `eq.${season}`, "team.season.platform": "eq.sleeper" });
  const stored = await get(`${SUPABASE_URL}/rest/v1/matchups?${query}`, { apikey: SUPABASE_PUBLISHABLE_KEY });
  const weeks = [];
  for (let week = Number(league.settings?.start_week || 1); week < Math.min(currentWeek, Number(league.settings?.playoff_week_start || 15)); week++) {
    const sourceRows = await get(`${api}/league/${leagueId}/matchups/${week}`);
    weeks.push(compareSyncWeek({ week, rosterIds, sourceRows, storedRows: stored.filter(row => Number(row.week) === week && !row.is_playoff) }));
  }
  return { asOf, completedAt: new Date().toISOString(), season, currentWeek, status: weeks.length ? weeks.every(row => row.status === "MATCH") ? "MATCH" : "REVIEW" : "NO_COMPLETED_WEEKS", weeks, sources,
    note: "Scores compared at separate read instants. MATCH does not certify game completion, scheduling or future freshness. No database writes." };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditSleeperSync().then(report => { console.log(JSON.stringify(report, null, 2)); if (report.status === "REVIEW") process.exitCode = 2; })
    .catch(() => { console.error("Sync audit unavailable: source read or coverage failed. No writes performed."); process.exitCode = 1; });
}
