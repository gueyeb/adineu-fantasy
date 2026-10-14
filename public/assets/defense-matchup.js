/**
 * Adineu Fantasy — Défenses : matchup et streaming (docs/prd-defense-matchups.md).
 *
 * Separates a strong defense from an average one in an excellent matchup. Per defense and week:
 * - projected sack rate = 67 % opponent offense sack rate allowed + 33 % defense sack rate, over
 *   each team's last 8 games (method of the Hayden Winks / Yahoo chart);
 * - opponent implied points from the Vegas spread and total;
 * - opponent interception rate and fumbles lost;
 * - an expected fantasy score at the league's scoring, built from those three, shown NEXT to the
 *   Sleeper projection — never replacing it (uncalibrated until backtested).
 * Injury context (backup QB, absent pass rushers, OL listed out) is reported, not priced.
 * Pure functions, no I/O.
 */

export const WINDOW_GAMES = 8;
export const OPPONENT_WEIGHT = 0.67;
export const POINTS_SD = 10; // spread of a team's score around its implied total
const DROPBACK_FLOOR = 1;

const round = (value, digits = 1) => Number(value.toFixed(digits));
const order = row => row.season * 100 + row.week;

/** A team's last `games` regular-season games strictly before the target week. */
function window(teamWeeks, team, { season, week }, games = WINDOW_GAMES) {
  const cutoff = season * 100 + week;
  return teamWeeks.filter(row => row.team === team && order(row) < cutoff).sort((a, b) => order(b) - order(a)).slice(0, games);
}

const dropbacks = row => (row.attempts || 0) + (row.sacksSuffered || 0);

/**
 * Offense and defense rates of one team over its window.
 * @param {Array} teamWeeks rows { season, week, gameId, team, opponent, attempts, sacksSuffered,
 *   interceptions, fumblesLost, carries, defSacks, defTds, specialTeamsTds }
 */
export function teamRates(teamWeeks, team, target, games = WINDOW_GAMES) {
  const rows = window(teamWeeks, team, target, games);
  if (!rows.length) return null;
  const byGame = new Map(teamWeeks.map(row => [`${row.gameId}|${row.team}`, row]));
  const sum = (list, get) => list.reduce((total, row) => total + (get(row) || 0), 0);
  const offenseDropbacks = sum(rows, dropbacks);
  const opponents = rows.map(row => byGame.get(`${row.gameId}|${row.opponent}`)).filter(Boolean);
  const opponentDropbacks = sum(opponents, dropbacks);
  return {
    games: rows.length,
    sackRateAllowed: sum(rows, row => row.sacksSuffered) / Math.max(DROPBACK_FLOOR, offenseDropbacks),
    interceptionRate: sum(rows, row => row.interceptions) / Math.max(DROPBACK_FLOOR, offenseDropbacks),
    fumblesLostPerGame: sum(rows, row => row.fumblesLost) / rows.length,
    dropbacksPerGame: offenseDropbacks / rows.length,
    sackRate: opponents.length ? sum(rows, row => row.defSacks) / Math.max(DROPBACK_FLOOR, opponentDropbacks) : null,
    returnTdsPerGame: sum(rows, row => (row.defTds || 0) + (row.specialTeamsTds || 0)) / rows.length
  };
}

/** Points a team is expected to score from the line: spread_line is the home team's expected margin. */
export function impliedPoints(game, team) {
  if (!game || !Number.isFinite(game.spread) || !Number.isFinite(game.total)) return null;
  const home = game.home === team;
  if (!home && game.away !== team) return null;
  return round((game.total + (home ? game.spread : -game.spread)) / 2);
}

const POINTS_ALLOWED_BRACKETS = [
  [0, 0, "pts_allow_0"], [1, 6, "pts_allow_1_6"], [7, 13, "pts_allow_7_13"], [14, 20, "pts_allow_14_20"],
  [21, 27, "pts_allow_21_27"], [28, 34, "pts_allow_28_34"], [35, Infinity, "pts_allow_35p"]
];
const normalCdf = x => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));

/** Expected points-allowed score: the bracket values weighted by a normal around the implied total. */
export function expectedPointsAllowedScore(implied, scoring, sd = POINTS_SD) {
  if (!Number.isFinite(implied)) return null;
  let total = 0;
  for (const [low, high, key] of POINTS_ALLOWED_BRACKETS) {
    const upper = high === Infinity ? 1 : normalCdf((high + 0.5 - implied) / sd);
    const lower = low === 0 ? 0 : normalCdf((low - 0.5 - implied) / sd);
    total += Math.max(0, upper - lower) * (scoring?.[key] || 0);
  }
  return round(total, 2);
}

/**
 * One defense against one opponent in one week.
 * @param {Object} options.league league-wide averages { sackRate, implied } used for the quadrant
 */
export function evaluateDefenseMatchup({ defense, game, teamWeeks, scoring, target, projection = null, notes = [] }) {
  const opponent = game.home === defense ? game.away : game.home;
  const own = teamRates(teamWeeks, defense, target);
  const opp = teamRates(teamWeeks, opponent, target);
  const implied = impliedPoints(game, opponent);
  const projectedSackRate = own?.sackRate !== null && own && opp ? OPPONENT_WEIGHT * opp.sackRateAllowed + (1 - OPPONENT_WEIGHT) * own.sackRate : null;
  const expectedDropbacks = opp?.dropbacksPerGame ?? null;
  const sacks = projectedSackRate !== null && expectedDropbacks !== null ? projectedSackRate * expectedDropbacks : null;
  const interceptions = opp && expectedDropbacks !== null ? opp.interceptionRate * expectedDropbacks : null;
  const fumbles = opp ? opp.fumblesLostPerGame : null;
  const pointsAllowedScore = expectedPointsAllowedScore(implied, scoring);
  const returnTds = own ? own.returnTdsPerGame : null;
  const parts = { sacks, interceptions, fumbles, pointsAllowedScore, returnTds };
  const complete = Object.values(parts).every(Number.isFinite);
  const expected = complete
    ? round(sacks * (scoring?.sack || 0) + interceptions * (scoring?.int || 0) + fumbles * (scoring?.fum_rec || 0) + pointsAllowedScore + returnTds * (scoring?.def_td || 0))
    : null;
  const minGames = Math.min(own?.games ?? 0, opp?.games ?? 0);
  return {
    defense, opponent, week: target.week, home: game.home === defense, kickoff: game.kickoff ?? null,
    impliedOpponentPoints: implied,
    projectedSackRate: projectedSackRate === null ? null : round(projectedSackRate * 100, 1),
    opponentSackRateAllowed: opp ? round(opp.sackRateAllowed * 100, 1) : null,
    defenseSackRate: own?.sackRate !== null && own ? round(own.sackRate * 100, 1) : null,
    opponentInterceptionRate: opp ? round(opp.interceptionRate * 100, 1) : null,
    opponentFumblesLostPerGame: opp ? round(opp.fumblesLostPerGame, 2) : null,
    expected: { sacks: sacks === null ? null : round(sacks, 2), interceptions: interceptions === null ? null : round(interceptions, 2),
      fumbles: fumbles === null ? null : round(fumbles, 2), pointsAllowedScore, returnTds: returnTds === null ? null : round(returnTds, 2), total: expected },
    sleeperProjection: Number.isFinite(projection) ? round(projection) : null,
    reliability: implied === null || minGames < 3 ? "LOW" : minGames < 6 ? "MEDIUM" : "HIGH",
    windowGames: { defense: own?.games ?? 0, opponent: opp?.games ?? 0 },
    notes
  };
}

/** Quadrant of the chart: pressure (sack rate) against the opponent's implied points. */
export function quadrantFor(row, { sackRate, implied }) {
  if (row.projectedSackRate === null || row.impliedOpponentPoints === null) return "UNKNOWN";
  const pressure = row.projectedSackRate >= sackRate;
  const lowScoring = row.impliedOpponentPoints <= implied;
  return pressure && lowScoring ? "STRONG_MATCHUP" : lowScoring ? "SOFT_OPPONENT" : pressure ? "PASS_RUSH_ONLY" : "AVOID";
}

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Every defense of `week` (and the following weeks up to `horizonWeeks`), with the streaming
 * horizon: the sum of expected scores over the weeks the defense plays.
 * @param {Function} [options.notesFor] (defense, opponent) -> string[] injury context
 * @param {Object} [options.projectionsByWeek] week -> { TEAM: points } Sleeper projections
 */
export function buildDefenseMatchups({ teamWeeks, games, scoring, season, week, horizonWeeks = 2, projectionsByWeek = {}, notesFor = () => [] }) {
  const weeks = Array.from({ length: horizonWeeks }, (_, index) => week + index);
  const byWeek = new Map(weeks.map(w => {
    const rows = games.filter(game => game.season === season && game.week === w).flatMap(game => [game.home, game.away].map(defense =>
      evaluateDefenseMatchup({ defense, game, teamWeeks, scoring, target: { season, week: w }, projection: projectionsByWeek[w]?.[defense] ?? null,
        notes: w === week ? notesFor(defense, game.home === defense ? game.away : game.home) : [] })));
    const league = { sackRate: median(rows.map(row => row.projectedSackRate)), implied: median(rows.map(row => row.impliedOpponentPoints)) };
    return [w, rows.map(row => ({ ...row, quadrant: quadrantFor(row, league) }))];
  }));
  const current = byWeek.get(week) || [];
  const defenses = current.map(row => {
    const next = weeks.slice(1).map(w => byWeek.get(w)?.find(entry => entry.defense === row.defense) ?? null);
    const scored = [row, ...next].filter(entry => Number.isFinite(entry?.expected.total));
    return {
      ...row,
      next: next.map((entry, index) => entry ? { week: entry.week, opponent: entry.opponent, expected: entry.expected.total, impliedOpponentPoints: entry.impliedOpponentPoints, quadrant: entry.quadrant }
        : { week: weeks[index + 1], opponent: null, expected: null, impliedOpponentPoints: null, quadrant: "BYE" }),
      horizonExpected: scored.length ? round(scored.reduce((sum, entry) => sum + entry.expected.total, 0)) : null,
      horizonWeeksPlayed: [row, ...next].filter(Boolean).length
    };
  }).sort((a, b) => (b.expected.total ?? -Infinity) - (a.expected.total ?? -Infinity) || a.defense.localeCompare(b.defense));
  const reference = { sackRate: median(current.map(row => row.projectedSackRate)), impliedOpponentPoints: median(current.map(row => row.impliedOpponentPoints)) };
  return { season, week, weeks, reference, defenses };
}
