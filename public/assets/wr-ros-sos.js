/** Pure positional schedule explorer. Input contract and delivery scope: docs/prd-fantasy-sos-explorer.md. */
import { SHRINK_GAMES } from './defense-vs-position.js?v=aa50fb77c1';
import { GENERAL_SETTINGS_2026 } from './league-settings.js?v=f6d1bf5212';

export const SOS_METHODOLOGY_VERSION = 'WR_TEMPORAL_V1';
export const SOS_POSITIONS = ['WR', 'RB'];
export function sosMethodology(position = 'WR') {
  if (!SOS_POSITIONS.includes(position)) throw Error('Unsupported SOS position');
  return `${position}_TEMPORAL_V1`;
}
export const sosPosition = bundle => bundle.methodologyVersion === 'RB_TEMPORAL_V1' ? 'RB' : 'WR';
export const SOS_HORIZONS = ['PAST', 'NEXT_3', 'FANTASY_ROS', 'FANTASY_PLAYOFFS', 'NFL_ROS'];
// Explicit canonical mapping. Never infer identities from display names.
export const SOS_TEAM_CODES = Object.freeze(Object.fromEntries([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
].map(team => [team, Object.freeze({ nflverse: team === 'LAR' ? 'LA' : team, sleeper: team, dvp: team })])));
const teams = Object.keys(SOS_TEAM_CODES).sort();
export function normalizeSosTeam(code, source = 'sleeper') {
  if (!['nflverse', 'sleeper', 'dvp'].includes(source)) throw new Error('Unsupported team source');
  const team = teams.find(team => SOS_TEAM_CODES[team][source] === code);
  if (!team) throw new Error(`Unknown ${source} team: ${code}`);
  return team;
}
const round = value => Number(value.toFixed(2));
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * DvP envelope: { scoring, source, fetchedAt, completedWeeks, byDefense: Map }.
 * Entries reuse buildDefenseVsPosition numeric output, plus valid:true only after
 * observation completeness and historical player-team identity have been verified.
 * Schedule envelope: {source,fetchedAt,complete,games}; complete is an upstream
 * attestation, never inferred from the number of rows passed to this function.
 */
export function calculatePositionSos({ position = 'WR', season = 2026, week, lastCompletedWeek, asOf, schedule, dvp,
  horizon = 'FANTASY_ROS', shrinkGames = SHRINK_GAMES } = {}) {
  const methodologyVersion = sosMethodology(position);
  const allowedKey = position === 'WR' ? 'opponentWrPprAllowed' : 'opponentRbPprAllowed';
  const gamesKey = position === 'WR' ? 'opponentWrGames' : 'opponentRbGames';
  if (horizon === 'ROS') horizon = 'FANTASY_ROS';
  if (!SOS_HORIZONS.includes(horizon)) throw new Error('Unsupported SOS horizon');
  if (season !== 2026) throw new Error('Unsupported league settings season');
  if (!Number.isInteger(week) || week < 1 || week > 19 || !Number.isInteger(lastCompletedWeek)
    || lastCompletedWeek < 0 || lastCompletedWeek >= week || lastCompletedWeek > 18) throw new Error('Invalid week bounds');
  if (!validTime(asOf) || !Number.isFinite(shrinkGames) || shrinkGames < 0) throw new Error('Invalid SOS snapshot');
  const cutoff = Date.parse(asOf);
  for (const source of [schedule, dvp]) {
    if (!source?.source || !validTime(source.fetchedAt) || Date.parse(source.fetchedAt) > cutoff) throw new Error('Invalid source provenance');
  }
  if (dvp.scoring !== 'FULL_PPR' || !Array.isArray(dvp.completedWeeks)
    || dvp.completedWeeks.some(w => !Number.isInteger(w) || w < 1 || w > lastCompletedWeek)
    || new Set(dvp.completedWeeks).size !== dvp.completedWeeks.length) throw new Error('Invalid DvP scoring or cutoff');
  if (!(dvp.byDefense instanceof Map) || !Array.isArray(schedule.games) || typeof schedule.complete !== 'boolean') throw new Error('Invalid source contract');
  const seen = new Set();
  const slots = new Set();
  const games = schedule.games.map(game => {
    const { gameId, away_team: away, home_team: home } = game;
    if (game.season !== season || !Number.isInteger(game.week) || game.week < 1 || game.week > 18
      || !gameId || typeof gameId !== 'string' || seen.has(gameId) || away === home
      || !teams.includes(away) || !teams.includes(home) || !validTime(game.kickoffAt)
      || typeof game.completed !== 'boolean') throw new Error('Invalid schedule game');
    seen.add(gameId);
    for (const team of [away, home]) {
      const slot = `${team}|${game.week}`;
      if (slots.has(slot)) throw new Error('Duplicate team/week');
      slots.add(slot);
    }
    if ((game.completed && Date.parse(game.kickoffAt) > cutoff)
      || (game.week <= lastCompletedWeek && !game.completed)) throw new Error('Inconsistent completion cutoff');
    return game;
  });
  const valid = new Map();
  for (const [key, entry] of dvp.byDefense) {
    const [team, entryPosition] = key.split('|');
    if (entryPosition !== position) continue;
    normalizeSosTeam(team, 'dvp');
    if (entry?.valid === true && Number.isInteger(entry.games) && entry.games > 0
      && entry.games <= dvp.completedWeeks.length && typeof entry.allowedPerGame === 'number'
      && Number.isFinite(entry.allowedPerGame)) valid.set(team, entry);
  }
  const count = [...valid.values()].reduce((sum, entry) => sum + entry.games, 0);
  const mu = count ? [...valid.values()].reduce((sum, entry) => sum + entry.games * entry.allowedPerGame, 0) / count : null;
  const adjusted = new Map([...valid].map(([team, entry]) => [team, (entry.games * entry.allowedPerGame + shrinkGames * mu) / (entry.games + shrinkGames)]));
  const endWeek = horizon === 'FANTASY_ROS' ? GENERAL_SETTINGS_2026.regularSeasonWeeks
    : horizon === 'FANTASY_PLAYOFFS' ? 17 : horizon === 'PAST' ? lastCompletedWeek : 18;
  const startWeek = horizon === 'PAST' ? 1 : horizon === 'FANTASY_PLAYOFFS'
    ? Math.max(week, GENERAL_SETTINGS_2026.playoffWeekStart) : week;
  const window = { horizon, startWeek, endWeek, asOf, snapshotId: null, viewMode: 'CURRENT' };
  const rows = teams.map(team => {
    const teamGames = games.filter(game => game.away_team === team || game.home_team === team);
    let selected = teamGames.filter(game => game.week >= startWeek && game.week <= endWeek
      && (horizon === 'PAST' ? game.completed : !game.completed && Date.parse(game.kickoffAt) > cutoff))
      .sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
    if (horizon === 'NEXT_3') selected = selected.slice(0, 3);
    const opponents = selected.map(game => {
      const opponent = game.away_team === team ? game.home_team : game.away_team;
      const entry = valid.get(opponent);
      return { week: game.week, gameId: game.gameId, opponent, kickoff: game.kickoffAt,
        [allowedKey]: entry?.allowedPerGame ?? null, [gamesKey]: entry?.games ?? 0,
        adjustedDifficulty: adjusted.get(opponent) ?? null, status: entry ? 'COVERED' : 'MISSING_DVP' };
    });
    const covered = opponents.filter(row => row.status === 'COVERED');
    const total = opponents.length;
    const complete = schedule.complete && covered.length === total;
    const score = covered.length ? round(covered.reduce((sum, row) => sum + row.adjustedDifficulty, 0) / covered.length) : null;
    const detailEnd = horizon === 'NEXT_3' && selected.length ? Math.max(...selected.map(g => g.week)) : endWeek;
    const byeWeeks = schedule.complete ? Array.from({ length: Math.max(0, detailEnd - startWeek + 1) }, (_, i) => i + startWeek)
      .filter(w => !teamGames.some(game => game.week === w)) : [];
    return { team, position, window: { ...window }, gamesInWindow: total, coveredGames: covered.length,
      coveragePct: total ? round(covered.length / total * 100) : schedule.complete ? 100 : 0,
      coverageStatus: complete ? 'COMPLETE' : covered.length ? 'PARTIAL' : 'UNAVAILABLE',
      scheduleComplete: schedule.complete, reason: !schedule.complete ? 'SCHEDULE_INCOMPLETE' : !total
        ? horizon === 'PAST' ? 'NO_COMPLETED_GAMES' : 'NO_REMAINING_GAMES' : !covered.length ? 'DVP_UNAVAILABLE' : !complete ? 'DVP_PARTIAL' : null,
      sosScore: score, rank: null,
      difficulty: complete && score !== null && mu > 0 ? score / mu >= 1.12 ? 'FAVORABLE' : score / mu <= 0.88 ? 'DIFFICULT' : 'NEUTRAL' : null,
      opponents, byeWeeks };
  });
  const ranked = rows.filter(row => row.coverageStatus === 'COMPLETE' && row.sosScore !== null)
    .sort((a, b) => b.sosScore - a.sosScore || a.team.localeCompare(b.team));
  ranked.forEach((row, index) => { row.rank = index && row.sosScore === ranked[index - 1].sosScore ? ranked[index - 1].rank : index + 1; });
  return { asOf, season, scoring: 'FULL_PPR', window, methodologyVersion,
    shrinkGames, leagueAverage: mu, rankedTeams: ranked.length,
    sources: { schedule: { source: schedule.source, fetchedAt: schedule.fetchedAt },
      dvp: { source: dvp.source, fetchedAt: dvp.fetchedAt, completedWeeks: [...dvp.completedWeeks] } },
    teams: rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.team.localeCompare(b.team)),
    warnings: [...(!schedule.complete ? ['SCHEDULE_INCOMPLETE'] : []), ...(ranked.length < 32 ? [`PARTIAL_RANKING:${ranked.length}/32`] : [])] };
}

// Preserve the original WR output contract for archived replay.
export const calculateWrSos = inputs => calculatePositionSos({ ...inputs, position: 'WR' });
