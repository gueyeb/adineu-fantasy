/** Source adapter: historical teams and scoring, never today's player-team assignment. */
import { createHash } from 'node:crypto';
import { getSchedule } from './league-context.js';
import { buildDefenseVsPosition, buildOpponents } from '../public/assets/defense-vs-position.js';
import { calculatePlayerFantasyPoints } from '../public/assets/league-settings.js';
import { normalizeSosTeam } from '../public/assets/wr-ros-sos.js';
import { NFLVERSE_PLAYER_STATS_URL, parseNflverseCsv } from './nflverse-player-stats.js';
export { NFLVERSE_PLAYER_STATS_URL } from './nflverse-player-stats.js';
export const parseSosCsv = parseNflverseCsv;
export const hashSos = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const fields = { passing_yards: 'passYds', passing_tds: 'passTd', passing_interceptions: 'passInt', passing_2pt_conversions: 'pass2pt',
  rushing_yards: 'rushYds', rushing_tds: 'rushTd', rushing_2pt_conversions: 'rush2pt', receptions: 'receptions', receiving_yards: 'recYds',
  receiving_tds: 'recTd', receiving_2pt_conversions: 'rec2pt' };

const SOS_OPPONENT = (game, team) => SOS_TEAM_SOURCE(game.away_team === team ? game.home_team : game.away_team);
const SOS_TEAM_SOURCE = team => team === 'LAR' ? 'LA' : team;

export function buildSosDvp({ rows, games, lastCompletedWeek, fetchedAt, source }) {
  const totals = new Map(); const invalid = new Set(); const seen = new Set();
  for (const row of rows) {
    if (row.season_type !== 'REG' || row.position !== 'WR' || Number(row.week) > lastCompletedWeek) continue;
    const week = Number(row.week);
    if (!Number.isInteger(week) || week < 1) continue;
    let team;
    try { team = normalizeSosTeam(row.team, 'nflverse'); } catch { throw Error('Unknown historical WR team'); }
    const key = `${week}|${team}`;
    const identity = `${row.player_id}|${week}`;
    if (!row.player_id || seen.has(identity)) { invalid.add(key); continue; }
    seen.add(identity);
    const scheduled = games.find(game => game.week === week && (game.away_team === team || game.home_team === team));
    if (!scheduled || row.game_id !== scheduled.gameId || row.opponent_team !== SOS_OPPONENT(scheduled, team)) { invalid.add(key); continue; }
    const stats = {}; let valid = true;
    for (const [column, name] of Object.entries(fields)) {
      if (row[column] === undefined || row[column] === '' || !Number.isFinite(Number(row[column]))) valid = false;
      else stats[name] = Number(row[column]);
    }
    for (const column of ['fumbles_lost_total', 'fumble_recovery_tds']) {
      if (row[column] === undefined || row[column] === '' || !Number.isFinite(Number(row[column]))) valid = false;
    }
    stats.fumblesLost = Number(row.fumbles_lost_total);
    if (!valid) { invalid.add(key); continue; }
    totals.set(key, (totals.get(key) ?? 0) + calculatePlayerFantasyPoints(stats) + Number(row.fumble_recovery_tds) * 6);
  }
  const statsByWeek = []; const observations = [];
  for (let week = 1; week <= lastCompletedWeek; week++) {
    const stats = {};
    for (const game of games.filter(g => g.week === week && g.completed)) {
      for (const team of [game.away_team, game.home_team]) {
        const key = `${week}|${team}`;
        if (invalid.has(key) || !totals.has(key)) continue;
        stats[team] = { pts_ppr: totals.get(key) };
        observations.push({ gameId: game.gameId, week, defense: team === game.away_team ? game.home_team : game.away_team,
          offensiveTeam: team, actualAllowedPpr: totals.get(key), kickoff: game.kickoffAt });
      }
    }
    if (Object.keys(stats).length) statsByWeek.push({ week, stats });
  }
  const dvp = buildDefenseVsPosition(statsByWeek, { teamOf: id => id, positionOf: () => 'WR', opponents: buildOpponents(games) });
  for (const entry of dvp.byDefense.values()) entry.valid = true;
  return { scoring: 'FULL_PPR', source, fetchedAt, completedWeeks: statsByWeek.map(w => w.week), byDefense: dvp.byDefense,
    observations, inputHash: hashSos(rows) };
}

export async function loadSosSources({ fetchImpl = fetch, now = () => new Date(), season = 2026 } = {}) {
  const games = await getSchedule({ season: String(season), fetchImpl, maxAgeMs: 15 * 60_000 });
  // getSchedule is shared/cached; capture the adapter's observation time and hash.
  const fetchedAt = games[0]?.sourceFetchedAt || now().toISOString();
  if (!games.length) throw Error('SCHEDULE_UNAVAILABLE');
  const teams = new Set(games.flatMap(g => [g.away_team, g.home_team]));
  const complete = games.length === 272 && teams.size === 32 && [...teams].every(team => games.filter(g => g.away_team === team || g.home_team === team).length === 17);
  let lastCompletedWeek = 0;
  for (let w = 1; w <= 18; w++) {
    const weekGames = games.filter(g => g.week === w);
    if (!weekGames.length || !weekGames.every(g => g.completed && Date.parse(g.kickoffAt) < Date.parse(fetchedAt))) break;
    lastCompletedWeek = w;
  }
  const source = NFLVERSE_PLAYER_STATS_URL(season);
  let dvp; const warnings = [];
  try {
    const response = await fetchImpl(source, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw Error('DVP_SOURCE_UNAVAILABLE');
    const rows = parseSosCsv(await response.text()).filter(row => Number(row.season) === season);
    dvp = buildSosDvp({ rows, games, lastCompletedWeek, fetchedAt: now().toISOString(), source });
  } catch { warnings.push('DVP_SOURCE_UNAVAILABLE'); dvp = { source, fetchedAt: now().toISOString(), scoring: 'FULL_PPR', completedWeeks: [], byDefense: new Map(), observations: [], inputHash: hashSos([]) }; }
  return { season, week: Math.min(19, lastCompletedWeek + 1), lastCompletedWeek,
    asOf: now().toISOString(), schedule: { games, complete, source: games[0].source, fetchedAt, inputHash: hashSos(games) }, dvp, warnings };
}
