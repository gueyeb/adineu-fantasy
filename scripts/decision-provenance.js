import { BYE_WEEKS_2026 } from '../public/assets/league-settings.js';
import { LAST_REGULAR_WEEK } from '../public/assets/waiver-model.js';

/** Keep source/week detail in JSON; text reports share one bounded coverage summary. */
export function summarizeDecisionProvenance({ roster = [], candidates = [] } = {}) {
  const summarize = rows => {
    const counts = {}, usageWeekCounts = {}, rosSources = {}, sources = new Set(), timestamps = [], gaps = [];
    let missingProvenance = 0, missingUsageProvenance = 0;
    for (const row of rows) {
      const weeks = row.provenance?.projections?.weeks;
      if (!weeks?.length) missingProvenance++;
      const usageWeeks = row.provenance?.usage?.weeks;
      if (!usageWeeks?.length) missingUsageProvenance++;
      const rosSource = row.provenance?.projections?.rosSource || 'UNKNOWN';
      rosSources[rosSource] = (rosSources[rosSource] || 0) + 1;
      for (const item of usageWeeks || []) {
        usageWeekCounts[item.status] = (usageWeekCounts[item.status] || 0) + 1;
        if (item.source) sources.add(item.source);
        if (item.fetchedAt) timestamps.push(item.fetchedAt);
      }
      for (const item of weeks || []) {
        counts[item.status] = (counts[item.status] || 0) + 1;
        if (item.source) sources.add(item.source);
        if (item.fetchedAt) timestamps.push(item.fetchedAt);
        if (['PLAYER_MISSING', 'LOAD_FAILED'].includes(item.status)) gaps.push({
          playerId: row.playerId, name: row.name || `Joueur #${row.playerId}`, week: item.week,
          cause: item.status, source: item.source, fetchedAt: item.fetchedAt ?? null
        });
      }
    }
    timestamps.sort();
    return { players: rows.length, missingProvenance, missingUsageProvenance, projectionWeekCounts: counts,
      usageWeekCounts, rosSources, gameCompletion: 'UNVERIFIED', routes: 'UNAVAILABLE',
      sourceCount: sources.size, fetchedAtRange: timestamps.length ? [timestamps[0], timestamps.at(-1)] : null, gaps };
  };
  return { roster: summarize(roster), candidates: summarize(candidates) };
}

export function formatProvenanceSummary(summary) {
  return ['roster', 'candidates'].map(scope => {
    const { gaps, ...coverage } = summary[scope];
    const players = [...new Set(gaps.map(row => row.name))];
    return `Source coverage ${scope}: ${JSON.stringify(coverage)}; projection gaps ${gaps.length}` +
      `${players.length ? ` (${players.slice(0, 12).join(', ')}${players.length > 12 ? `; +${players.length - 12} players` : ''})` : ''}; full dated provenance in JSON.`;
  });
}

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
