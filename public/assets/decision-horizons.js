import { GENERAL_SETTINGS_2026, BYE_WEEKS_2026 } from './league-settings.js?v=886f353394';
import { isCurrentEvidence } from './acquisition-availability.js?v=795bedcaa2';

export const LAST_FANTASY_WEEK = 17;
const absent = new Set(['Out', 'Doubtful', 'IR', 'PUP', 'Sus', 'NA']);
/** A dated, scoped injury event may confirm an absence, never an inferred return. */
export function availabilityWindow(player, { week, endWeek, evidence, asOf, season, leagueId, fromWeek = week }) {
  const weeks = Array.from({ length: Math.max(0, endWeek - fromWeek + 1) }, (_, i) => fromWeek + i);
  const confirmed = evidence?.type === 'INJURY' && isCurrentEvidence(evidence, { week, asOf, season, leagueId });
  const outThroughWeek = confirmed && Number.isInteger(evidence.outThroughWeek) && evidence.outThroughWeek >= week ? evidence.outThroughWeek : null;
  const seasonEnding = confirmed && evidence.seasonEndingConfirmed === true;
  const eligibleWeeks = seasonEnding ? [] : outThroughWeek !== null ? weeks.filter(w => w > outThroughWeek) : absent.has(player.injuryStatus) ? null : weeks;
  return { from: fromWeek, to: endWeek, outThroughWeek, seasonEndingConfirmed: seasonEnding,
    eligibleWeeks, fraction: eligibleWeeks === null || !weeks.length ? null : eligibleWeeks.length / weeks.length,
    basis: confirmed && (seasonEnding || outThroughWeek !== null) ? 'CONFIRMED_ABSENCE' : absent.has(player.injuryStatus) ? 'RETURN_UNCONFIRMED' : 'NO_PLATFORM_ALERT',
    source: confirmed ? evidence.source : null, returnConfirmed: false };
}

/** Distinct objectives; missing future projections never become zero or season averages. */
export function projectionHorizons({ player, week, projectionsByWeek, evidence, asOf, season, leagueId }) {
  const start = GENERAL_SETTINGS_2026.playoffWeekStart;
  const windows = [['QUALIFICATION', week, start - 1], ['PLAYOFFS', Math.max(week, start), LAST_FANTASY_WEEK],
    ...Array.from({ length: LAST_FANTASY_WEEK - start + 1 }, (_, i) => [`PLAYOFF_WEEK_${start + i}`, Math.max(week, start + i), start + i])];
  return Object.fromEntries(windows.map(([key, from, to]) => {
    const availability = availabilityWindow(player, { week, fromWeek: from, endWeek: to, evidence, asOf, season, leagueId });
    const weeks = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
    const rows = weeks.map(w => {
      const knownOut = availability.seasonEndingConfirmed || availability.outThroughWeek !== null && w <= availability.outThroughWeek || absent.has(player.injuryStatus) && w === week;
      const value = BYE_WEEKS_2026[player.nflTeam] === w || knownOut ? 0 : projectionsByWeek[w]?.[player.sleeperId]?.pts_ppr;
      return { week: w, points: Number.isFinite(value) ? value : null, availability: knownOut ? 'CONFIRMED_OR_CURRENT_ABSENCE' : absent.has(player.injuryStatus) ? 'RETURN_UNCONFIRMED' : 'NO_PLATFORM_ALERT' };
    });
    const covered = rows.length > 0 && rows.every(row => row.points !== null);
    return [key, { from, to, weeks: rows, covered, total: covered ? Number(rows.reduce((sum, row) => sum + row.points, 0).toFixed(1)) : null,
      missingWeeks: rows.filter(row => row.points === null).map(row => row.week), availability, objective: key === 'QUALIFICATION' ? 'QUALIFY' : 'WIN_PLAYOFFS', executableNow: false }];
  }));
}

/** Shared live/replay policy: confirmed absence overrides even a stale projection. */
export function decisionWeeklyProjection(player, w, { projectionsByWeek, week, eventsById = {}, asOf, season, leagueId }) {
  const window = availabilityWindow(player, { week, endWeek: Math.max(w, week), evidence: eventsById[player.sleeperId], asOf, season, leagueId });
  if (BYE_WEEKS_2026[player.nflTeam] === w || window.seasonEndingConfirmed || window.outThroughWeek !== null && w <= window.outThroughWeek || absent.has(player.injuryStatus) && w === week) return 0;
  const value = projectionsByWeek[w]?.[player.sleeperId]?.pts_ppr;
  return Number.isFinite(value) ? value : null;
}
