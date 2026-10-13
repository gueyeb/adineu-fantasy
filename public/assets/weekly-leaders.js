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

/**
 * Season view: total league points per position over the completed weeks, games played, average
 * and number of weekly top-10 finishes.
 * @param {Array<{week:number, stats:Object}>} options.statsByWeek
 */
export function buildSeasonLeaders({ statsByWeek = [], scoring, playerOf, owners = new Map(), positions = LEADER_POSITIONS, limit = LEADERS_LIMIT }) {
  const totals = new Map();
  for (const { stats } of statsByWeek) {
    const weekly = new Map(positions.map(position => [position, []]));
    for (const [playerId, row] of Object.entries(stats || {})) {
      if (playerId.startsWith("TEAM_") || !(Number(row?.gp) > 0)) continue;
      const player = playerOf(playerId);
      if (!weekly.has(player?.position)) continue;
      weekly.get(player.position).push({ playerId, player, points: leaguePoints(row, scoring) });
    }
    for (const rows of weekly.values()) {
      rows.sort((a, b) => b.points - a.points);
      rows.forEach(({ playerId, player, points }, index) => {
        const entry = totals.get(playerId) || { playerId, player, points: 0, games: 0, topTenWeeks: 0 };
        entry.points += points;
        entry.games += 1;
        if (index < LEADERS_LIMIT) entry.topTenWeeks += 1;
        totals.set(playerId, entry);
      });
    }
  }
  const result = {};
  for (const position of positions) {
    result[position] = {
      leaders: [...totals.values()].filter(entry => entry.player.position === position)
        .sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name))
        .slice(0, limit)
        .map((entry, index) => {
          const owner = owners.get(entry.playerId) || null;
          return {
            rank: index + 1, playerId: entry.playerId, name: entry.player.name, position, nflTeam: entry.player.nflTeam ?? null,
            injuryStatus: entry.player.injuryStatus ?? null,
            points: round(entry.points), games: entry.games, average: round(entry.points / entry.games, 1), topTenWeeks: entry.topTenWeeks,
            owner: owner?.teamName ?? null, ownerRosterId: owner?.rosterId ?? null, freeAgent: !owner
          };
        })
    };
  }
  return { positions: result, summary: { played: totals.size } };
}

/**
 * Best in-season pickups: league points scored since the add by players acquired on waivers or
 * as free agents and still on that roster. A player added twice by the same roster counts from
 * his latest add; a pickup since dropped or traded is left out.
 * @param {Array} options.transactions raw Sleeper transaction rows (all legs)
 */
export function buildBestPickups({ transactions = [], statsByWeek = [], scoring, playerOf, owners = new Map(), limit = LEADERS_LIMIT }) {
  const latest = new Map();
  for (const row of transactions) {
    if (row?.status !== "complete" || !["waiver", "free_agent"].includes(row.type)) continue;
    for (const [playerId, rosterId] of Object.entries(row.adds || {})) {
      const owner = owners.get(playerId);
      if (!owner || String(owner.rosterId) !== String(rosterId)) continue;
      const previous = latest.get(playerId);
      if (!previous || Number(row.created) > previous.created) {
        latest.set(playerId, { created: Number(row.created), week: Number(row.leg), faab: row.type === "waiver" ? Number(row.settings?.waiver_bid) || 0 : null, owner });
      }
    }
  }
  const pickups = [];
  for (const [playerId, add] of latest) {
    const player = playerOf(playerId);
    if (!player) continue;
    let points = 0;
    let games = 0;
    for (const { week, stats } of statsByWeek) {
      const row = stats?.[playerId];
      if (week < add.week || !(Number(row?.gp) > 0)) continue;
      points += leaguePoints(row, scoring);
      games += 1;
    }
    if (!games) continue;
    pickups.push({
      playerId, name: player.name, position: player.position, nflTeam: player.nflTeam ?? null,
      owner: add.owner.teamName, addedWeek: add.week, faab: add.faab,
      points: round(points), games, average: round(points / games, 1)
    });
  }
  return pickups.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, limit).map((row, index) => ({ rank: index + 1, ...row }));
}
