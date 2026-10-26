import { calculatePowerRankings } from "./power-rankings.js?v=86d062a9e8";
import { calculateAllPlayRecords } from "./all-play.js?v=99514b7ee6";

export const teamSeasonKey = rosterId => `roster:${String(rosterId)}`;

/** Use the season team's published roster ID, never a nickname/canonical-name guess. */
export function buildTeamSeasonContext({ rows = [], rosterIds = [], currentWeek = null }) {
  const expected = [...new Set(rosterIds.map(String))];
  const known = new Set(expected);
  const invalid = rows.some(row => !row.isPlayoff && (currentWeek === null || Number(row.week) < currentWeek) &&
    (row.rosterId === null || row.rosterId === undefined || !known.has(String(row.rosterId))));
  if (invalid || !expected.length) return { currentWeek, matchupRows: [],
    powerRankings: { ready: false, reason: "identity_mapping_unavailable", rankings: [] },
    allPlay: { ready: false, reason: "identity_mapping_unavailable", records: [] } };
  const matchupRows = rows.map(row => ({ ...row, canonicalManager: row.manager, manager: teamSeasonKey(row.rosterId) }));
  const expectedManagers = expected.map(teamSeasonKey);
  return { currentWeek, matchupRows,
    powerRankings: calculatePowerRankings(matchupRows, { currentWeek, expectedManagers }),
    allPlay: calculateAllPlayRecords(matchupRows, { currentWeek, expectedManagers }) };
}

export function allPlayUnavailableMessage(result) {
  if (!result) return "Données de saison indisponibles pour calculer le record all-play. Réessaie plus tard.";
  return ({ insufficient_weeks: "Pas encore assez de semaines complètes pour calculer le record all-play.",
    incomplete_coverage: "Couverture des équipes incomplète : record all-play indisponible pour le moment.",
    identity_mapping_unavailable: "Rattachement des équipes aux rosters indisponible : record all-play non calculé." })[result.reason]
    || "Données all-play indisponibles pour le moment.";
}

/** Public canonical name bound to the same season roster, only when the evidence agrees. */
export function canonicalManagerForRoster(rows, rosterId) {
  const names = [...new Set((rows || []).filter(row => row.manager === teamSeasonKey(rosterId))
    .map(row => row.canonicalManager).filter(Boolean))];
  return names.length === 1 ? names[0] : null;
}
