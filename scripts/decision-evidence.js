import { readFile } from "node:fs/promises";

/** Operator-maintained, server-side JSON. Never accept a file path from an HTTP request. */
export async function loadDecisionEvidence({ path = process.env.DECISION_EVIDENCE_FILE, leagueId, season, week } = {}) {
  if (!path) return { availabilityById: {}, rolesById: {}, eventsById: {}, rosterPreferences: [], issues: ["DECISION_EVIDENCE_NOT_CONFIGURED"] };
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.version !== 1 || String(data.leagueId) !== String(leagueId) || String(data.season) !== String(season) || data.targetWeek !== week) {
      return { availabilityById: {}, rolesById: {}, eventsById: {}, rosterPreferences: [], issues: ["DECISION_EVIDENCE_SCOPE_MISMATCH"] };
    }
    const normalize = rows => Object.fromEntries(Object.entries(rows || {}).filter(([id, row]) => id.length <= 80 && row && typeof row === "object" && !Array.isArray(row)).map(([id, row]) => [id, { ...row, leagueId: data.leagueId, season: data.season, targetWeek: data.targetWeek }]));
    return { availabilityById: normalize(data.availabilityById), rolesById: normalize(data.rolesById), eventsById: normalize(data.eventsById), rosterPreferences: Array.isArray(data.rosterPreferences) ? data.rosterPreferences : [], issues: [] };
  } catch {
    return { availabilityById: {}, rolesById: {}, eventsById: {}, rosterPreferences: [], issues: ["DECISION_EVIDENCE_UNREADABLE"] };
  }
}

/** nflverse gametime is Eastern, even for international games; Intl handles EST/EDT. */
export function easternKickoffIso(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !/^\d{2}:\d{2}$/.test(time || "")) return null;
  const localAsUtc = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(localAsUtc)) return null;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });
  const offset = formatter.formatToParts(new Date(localAsUtc)).find(part => part.type === "timeZoneName")?.value;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(localAsUtc - minutes * 60_000).toISOString();
}
