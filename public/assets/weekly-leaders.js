/**
 * Adineu Fantasy — Leaders de la semaine (docs/prd-weekly-leaders.md).
 *
 * Top 10 par poste d'une semaine : points au barème exact de la ligue, projection d'avant-match
 * rescorée au même barème, détenteur actuel ou agent libre, usage. Pure functions, no I/O.
 */

export const LEADER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const LEADERS_LIMIT = 10;
export const FREE_AGENTS_LIMIT = 3;

const round = (value, digits = 2) => Number(value.toFixed(digits));

/**
 * League points of one Sleeper stat line (actual or projected): every stat × the league's
 * `scoring_settings`. Reproduces the points Sleeper publishes for the league, unlike `pts_ppr`.
 */
export function leaguePoints(row, scoring) {
  if (!row || !scoring) return null;
  let total = 0;
  for (const [key, value] of Object.entries(scoring)) {
    const amount = Number(row[key]);
    if (value && Number.isFinite(amount)) total += amount * value;
  }
  // Sleeper projects long field goals as `fgm_50p` only: score them at the 50–59 rate.
  if (row.fgm_50_59 === undefined && row.fgm_60p === undefined && !scoring.fgm_50p && Number.isFinite(Number(row.fgm_50p))) {
    total += Number(row.fgm_50p) * (scoring.fgm_50_59 || 0);
  }
  return round(total);
}

/**
 * @param {Object} options
 * @param {Object} options.stats Sleeper `/stats` of the week, by player id
 * @param {Object} [options.projections] Sleeper `/projections` of the same week
 * @param {Object} options.scoring league `scoring_settings`
 * @param {Function} options.playerOf id -> { name, position, nflTeam, injuryStatus } | undefined
 * @param {Map} [options.owners] id -> { rosterId, teamName } (current rosters)
 * @param {Map} [options.lineups] id -> { rosterId, started } (lineups of that week)
 * @param {Map} [options.usage] id -> { usageScore, signal }
 */
export function buildWeeklyLeaders({
  stats = {}, projections = {}, scoring, playerOf, owners = new Map(), lineups = new Map(), usage = new Map(),
  positions = LEADER_POSITIONS, limit = LEADERS_LIMIT, freeAgentsLimit = FREE_AGENTS_LIMIT
}) {
  const byPosition = new Map(positions.map(position => [position, []]));
  for (const [playerId, row] of Object.entries(stats || {})) {
    if (playerId.startsWith("TEAM_") || !(Number(row?.gp) > 0)) continue;
    const player = playerOf(playerId);
    const pool = byPosition.get(player?.position);
    if (!pool) continue;
    const points = leaguePoints(row, scoring);
    const projected = projections?.[playerId] ? leaguePoints(projections[playerId], scoring) : null;
    const owner = owners.get(playerId) || null;
    const lineup = lineups.get(playerId);
    const signals = usage.get(playerId);
    pool.push({
      playerId, name: player.name, position: player.position, nflTeam: player.nflTeam ?? null,
      injuryStatus: player.injuryStatus ?? null,
      points, projected, delta: projected === null ? null : round(points - projected),
      owner: owner?.teamName ?? null, ownerRosterId: owner?.rosterId ?? null, freeAgent: !owner,
      // Benched only means something for the manager who still holds him.
      benched: owner && lineup && String(lineup.rosterId) === String(owner.rosterId) ? !lineup.started : null,
      usageScore: signals?.usageScore ?? null, usageSignal: signals?.signal ?? null
    });
  }

  const result = {};
  let played = 0;
  for (const position of positions) {
    const ranked = byPosition.get(position)
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
      .map((row, index) => ({ rank: index + 1, ...row }));
    played += ranked.length;
    result[position] = {
      leaders: ranked.slice(0, limit),
      freeAgents: ranked.filter(row => row.freeAgent && row.points > 0).slice(0, freeAgentsLimit)
    };
  }
  const top = positions.flatMap(position => result[position].leaders);
  return {
    positions: result,
    summary: {
      played,
      freeAgentsInTop: top.filter(row => row.freeAgent).length,
      benchedInTop: top.filter(row => row.benched === true).length
    }
  };
}
