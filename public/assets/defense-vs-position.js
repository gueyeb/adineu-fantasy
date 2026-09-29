/**
 * Adineu Fantasy — Defense vs Position (DvP) and matchup difficulty (docs/benchmark-fantasylife.md, lot 3).
 *
 * Pure functions, no I/O. For every NFL defense and fantasy position: PPR points that position
 * scored against it per game (sum of all players of that position in the game), compared with the
 * league average. Early-season samples are tiny (3 games), so each defense is shrunk toward the
 * league mean with SHRINK_GAMES pseudo-games of average — a 60-point week alone can't make a
 * defense "the worst in the league".
 */

export const DVP_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const SHRINK_GAMES = 3;

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/** Opponent of every team for a week, from nflverse schedule rows ({week, away_team, home_team}). */
export function buildOpponents(games = []) {
  const byWeek = new Map();
  for (const game of games) {
    const week = Number(game.week);
    if (!byWeek.has(week)) byWeek.set(week, new Map());
    byWeek.get(week).set(game.away_team, game.home_team);
    byWeek.get(week).set(game.home_team, game.away_team);
  }
  return byWeek;
}

/**
 * @param statsByWeek [{week, stats}] Sleeper weekly stats (completed weeks)
 * @param teamOf (playerId, week) -> NFL team or null; positionOf (playerId) -> position
 * @param opponents Map week -> Map team -> opponent
 * @returns { byDefense: Map "DEF|POS" -> {games, allowedPerGame, adjusted, ratio, rank}, leagueAverage }
 */
export function buildDefenseVsPosition(statsByWeek, { teamOf, positionOf, opponents }) {
  const perGame = new Map(); // "week|DEF|POS" -> points allowed that game
  for (const { week, stats } of statsByWeek) {
    const weekOpponents = opponents.get(week);
    if (!weekOpponents) continue;
    for (const [playerId, row] of Object.entries(stats || {})) {
      const position = positionOf(playerId);
      if (!DVP_POSITIONS.includes(position)) continue;
      const team = position === "DEF" ? playerId : teamOf(playerId, week);
      const defense = team && weekOpponents.get(team);
      const points = Number(row.pts_ppr);
      if (!defense || !Number.isFinite(points)) continue;
      const key = `${week}|${defense}|${position}`;
      perGame.set(key, (perGame.get(key) || 0) + points);
    }
  }
  const games = new Map(); // "DEF|POS" -> [points per game]
  for (const [key, points] of perGame) {
    const [, defense, position] = key.split("|");
    const id = `${defense}|${position}`;
    if (!games.has(id)) games.set(id, []);
    games.get(id).push(points);
  }
  const leagueAverage = {};
  for (const position of DVP_POSITIONS) {
    leagueAverage[position] = mean([...games].filter(([id]) => id.endsWith(`|${position}`)).flatMap(([, list]) => list));
  }
  const byDefense = new Map();
  for (const [id, list] of games) {
    const position = id.split("|")[1];
    const average = leagueAverage[position];
    const adjusted = (list.reduce((sum, value) => sum + value, 0) + SHRINK_GAMES * average) / (list.length + SHRINK_GAMES);
    byDefense.set(id, { games: list.length, allowedPerGame: mean(list), adjusted, ratio: average > 0 ? adjusted / average : 1 });
  }
  // Rank 1 = allows the most points = easiest matchup for that position.
  for (const position of DVP_POSITIONS) {
    [...byDefense].filter(([id]) => id.endsWith(`|${position}`)).sort((a, b) => b[1].adjusted - a[1].adjusted)
      .forEach(([, entry], index) => { entry.rank = index + 1; });
  }
  return { byDefense, leagueAverage };
}

/** Matchup for one player this week: opponent, its DvP rank for the position, and a label. */
export function matchupFor({ team, position, week, opponents, dvp }) {
  const opponent = opponents.get(week)?.get(team) || null;
  if (!opponent) return { opponent: null, label: "BYE", rank: null, ratio: null };
  const entry = dvp.byDefense.get(`${opponent}|${position}`);
  if (!entry) return { opponent, label: "NEUTRE", rank: null, ratio: null };
  const label = entry.ratio >= 1.12 ? "FACILE" : entry.ratio <= 0.88 ? "DIFFICILE" : "NEUTRE";
  return { opponent, label, rank: entry.rank, ratio: Number(entry.ratio.toFixed(2)), allowedPerGame: Number(entry.allowedPerGame.toFixed(1)), games: entry.games };
}
