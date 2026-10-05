import { BYE_WEEKS_2026 } from '../public/assets/league-settings.js';
import { LAST_REGULAR_WEEK } from '../public/assets/waiver-model.js';

/** Coverage describes source fields, not confidence in role or projection accuracy. */
export function buildDecisionProvenance({ playerId, nflTeam, position, week, lastCompletedWeek, season, projectionsByWeek, statsByWeek, fetchedAtByPath = {}, rosSource }) {
  const projections = [];
  for (let w = week; w <= LAST_REGULAR_WEEK; w++) {
    const path = `/projections/nfl/regular/${season}/${w}`;
    const bye = BYE_WEEKS_2026[nflTeam] === w;
    projections.push({ week: w, status: bye ? 'KNOWN_BYE' : Number.isFinite(projectionsByWeek[w]?.[playerId]?.pts_ppr) ? 'AVAILABLE' : projectionsByWeek[w] ? 'PLAYER_MISSING' : 'LOAD_FAILED',
      source: `https://api.sleeper.app/v1${path}`, fetchedAt: fetchedAtByPath[path] ?? null, unit: 'PPR_POINTS' });
  }
  const first = Math.max(1, lastCompletedWeek - 2);
  const usage = [];
  for (let w = first; w <= lastCompletedWeek; w++) {
    const path = `/stats/nfl/regular/${season}/${w}`;
    const batch = statsByWeek.find(row => row.week === w);
    const row = batch?.stats?.[playerId];
    const played = row && (row.off_snp > 0 || row.gp > 0);
    usage.push({ week: w, status: !batch ? 'LOAD_FAILED' : !row ? 'PLAYER_MISSING' : played ? 'RECORDED_GAME_COMPLETION_UNVERIFIED' : 'NO_RECORDED_GAME',
      source: `https://api.sleeper.app/v1${path}`, fetchedAt: fetchedAtByPath[path] ?? null });
  }
  return { projections: { expectedWeeks: projections.length, availableWeeks: projections.filter(row => row.status === 'AVAILABLE').length,
    knownByeWeeks: projections.filter(row => row.status === 'KNOWN_BYE').length, weeks: projections, rosSource: rosSource ?? 'NONE',
    fallbackReason: rosSource === 'RANK_ESTIMATE' ? 'INSUFFICIENT_PLAYER_PROJECTIONS' : rosSource === 'NONE' ? 'NO_ROS_ESTIMATE' : null },
  usage: { dataThroughWeek: lastCompletedWeek, firstWeek: usage.length ? first : null, expectedWeeks: usage.length,
    sampleGames: usage.filter(row => row.status === 'RECORDED_GAME_COMPLETION_UNVERIFIED').length, weeks: usage,
    opportunityDefinition: position === 'QB' ? 'QB_VOLUME_MODEL_SEPARATE_FROM_CARRIES_PLUS_TARGETS' : 'RUSH_ATT_PLUS_REC_TGT',
    routes: null, completionVerified: false, confidence: 'NOT_CALIBRATED' },
  statusInterpretation: 'PLATFORM_STATUS_NOT_HEALTH_CERTIFICATE' };
}
