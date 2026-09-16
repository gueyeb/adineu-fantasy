/**
 * Adineu Fantasy — Playoff Probabilities (Power Rankings page).
 *
 * Monte Carlo simulation of the REMAINING regular season, on top of results already locked in.
 * Reuses calculatePowerRankings for the baseline standings and the exact same activation gate
 * (MINIMUM_COMPLETED_WEEKS, full 12-team coverage, playoffs/live week excluded) — if Power
 * Rankings isn't ready, this isn't either, same reason. Playoff Race (playoff-race.js) stays
 * arithmetic and unchanged; this is a separate, clearly-labeled "Adineu estimate", never
 * presented as official Sleeper data. See docs/prd-playoff-probabilities.md for the full
 * rationale and the Sleeper API verification behind each data-source decision below.
 *
 * Tiebreak: wins -> points-for -> manager name (identical formula to playoff-race.js's
 * standingsOrder — Sleeper's own default, confirmed via playoff_seed_type in league settings).
 */

import { calculatePowerRankings } from "./power-rankings.js?v=1";
import { calculatePlayerFantasyPoints } from "./league-settings.js";

export const DEFAULT_PLAYOFF_SPOTS = 8;
export const DEFAULT_SIMULATIONS = 3000;
const MIN_STD_DEV = 3; // floor: a simulation is never fully deterministic, even for a low-variance team/week

// --- seeded PRNG (mulberry32) — deterministic given the same seed, zero dependencies ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Maps one Sleeper weekly player-projection stats object (snake_case) to the shape
 * calculatePlayerFantasyPoints expects, so projections get scored under Adineu's real rules
 * rather than Sleeper's generic PPR number. Verified field-by-field against live Sleeper
 * projections (skill positions, kicker, defense) on 2026-09-16 — see the mini-PRD.
 */
export function adaptSleeperProjectionStats(stats = {}) {
  return {
    passYds: stats.pass_yd,
    passTd: stats.pass_td,
    passInt: stats.pass_int,
    pass2pt: stats.pass_2pt,
    rushYds: stats.rush_yd,
    rushTd: stats.rush_td,
    rush2pt: stats.rush_2pt,
    receptions: stats.rec,
    recYds: stats.rec_yd,
    recTd: stats.rec_td,
    rec2pt: stats.rec_2pt,
    fumblesLost: stats.fum_lost,
    patMade: stats.xpm,
    fg0To39: (stats.fgm_0_19 || 0) + (stats.fgm_20_29 || 0) + (stats.fgm_30_39 || 0),
    fg40To49: stats.fgm_40_49,
    fg50To59: stats.fgm_50_59,
    fg60Plus: stats.fgm_60p,
    defSack: stats.sack,
    defInterception: stats.int,
    defFumbleRecovery: stats.fum_rec,
    defForcedFumble: stats.ff,
    defBlockedKick: stats.blk_kick,
    defTouchdown: (stats.def_td || 0) + (stats.def_fum_td || 0) + (stats.pass_int_td || 0),
    defPointsAllowed: stats.pts_allow
  };
}

/** Adapts + scores one Sleeper weekly player-projection object under Adineu's real rules in one call. */
export function projectPlayerFantasyPoints(sleeperProjectionStats) {
  return calculatePlayerFantasyPoints(adaptSleeperProjectionStats(sleeperProjectionStats));
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Per-manager score uncertainty, calibrated from THIS season's own completed weekly scores —
 * never an arbitrary hand-picked number. A manager with too few completed weeks (<3) for a
 * stable estimate falls back to the league-wide spread. Always floored at MIN_STD_DEV so a
 * simulation is never pathologically deterministic.
 */
export function calibrateUncertainty(completedRows) {
  const byManager = new Map();
  for (const row of completedRows || []) {
    if (!row.manager || !Number.isFinite(Number(row.points))) continue;
    if (!byManager.has(row.manager)) byManager.set(row.manager, []);
    byManager.get(row.manager).push(Number(row.points));
  }
  const allScores = (completedRows || []).map(row => Number(row.points)).filter(Number.isFinite);
  const leagueStdDev = Math.max(standardDeviation(allScores) || MIN_STD_DEV, MIN_STD_DEV);

  const stdDevByManager = new Map();
  for (const [manager, scores] of byManager) {
    const stdDev = scores.length >= 3 ? standardDeviation(scores) : null;
    stdDevByManager.set(manager, Math.max(stdDev ?? leagueStdDev, MIN_STD_DEV));
  }
  return { stdDevByManager, leagueStdDev };
}

/**
 * Resolves one player's projected points for one week through a fallback chain: (a) this week's
 * direct Sleeper projection, (b) this player's own season-average actual score, (c) a
 * position-level replacement value. `source` says which was used, so callers can surface a
 * coverage percentage rather than presenting every projection as equally solid.
 */
export function resolvePlayerProjection({ directPoints, seasonAveragePoints, replacementPoints }) {
  if (Number.isFinite(directPoints)) return { points: directPoints, source: "direct" };
  if (Number.isFinite(seasonAveragePoints)) return { points: seasonAveragePoints, source: "season-average" };
  if (Number.isFinite(replacementPoints)) return { points: replacementPoints, source: "replacement" };
  return { points: 0, source: "none" };
}

/** Sums a team's resolved starter projections into one weekly mean + the share that was a direct projection. */
export function sumTeamProjection(playerResolutions) {
  if (!playerResolutions || playerResolutions.length === 0) return { points: 0, coveragePct: 0 };
  const points = playerResolutions.reduce((sum, item) => sum + item.points, 0);
  const directCount = playerResolutions.filter(item => item.source === "direct").length;
  return { points, coveragePct: Math.round((directCount / playerResolutions.length) * 1000) / 10 };
}

function standingsOrder(a, b) {
  return b.wins - a.wins || b.pointsFor - a.pointsFor || a.manager.localeCompare(b.manager, "fr");
}

/**
 * Runs the Monte Carlo simulation given fully-prepared inputs (baseline standings already
 * locked in, remaining schedule, per-team weekly projections, calibrated uncertainty). Pure —
 * no fetching, no gate logic; that's simulatePlayoffProbabilities's job below.
 */
export function runSimulation({ baseStandings, remainingWeeks, schedule, teamProjectionsByWeek, stdDevByManager, playoffSpots, simulations, seed }) {
  const rng = mulberry32(seed);
  const managers = baseStandings.map(team => team.manager);
  const qualifiedCount = new Map(managers.map(manager => [manager, 0]));

  for (let run = 0; run < simulations; run += 1) {
    const standings = new Map(baseStandings.map(team => [team.manager, { ...team }]));

    for (const week of remainingWeeks) {
      const pairs = schedule.get(week) || [];
      for (const [managerA, managerB] of pairs) {
        const teamA = standings.get(managerA);
        const teamB = standings.get(managerB);
        if (!teamA || !teamB) continue;

        const projA = teamProjectionsByWeek.get(`${week}|${managerA}`);
        const projB = teamProjectionsByWeek.get(`${week}|${managerB}`);
        const scoreA = (projA?.points || 0) + gaussian(rng) * (stdDevByManager.get(managerA) || MIN_STD_DEV);
        const scoreB = (projB?.points || 0) + gaussian(rng) * (stdDevByManager.get(managerB) || MIN_STD_DEV);

        teamA.pointsFor += scoreA;
        teamB.pointsFor += scoreB;
        if (scoreA > scoreB) teamA.wins += 1;
        else if (scoreB > scoreA) teamB.wins += 1;
        else { teamA.ties += 1; teamB.ties += 1; }
      }
    }

    const ranked = [...standings.values()].sort(standingsOrder);
    for (let index = 0; index < Math.min(playoffSpots, ranked.length); index += 1) {
      qualifiedCount.set(ranked[index].manager, qualifiedCount.get(ranked[index].manager) + 1);
    }
  }

  return managers.map(manager => ({
    manager,
    probability: Number((qualifiedCount.get(manager) / simulations).toFixed(4))
  }));
}

/**
 * Top-level entry point: same gate as calculatePowerRankings, then the Monte Carlo simulation.
 * `rows` is the same matchup-row format as calculatePowerRankings (completed weeks locked in).
 * `remainingWeeks`/`schedule`/`teamProjectionsByWeek` describe what's left to simulate — built by
 * the caller from Sleeper's schedule + projections + current rosters (see docs/prd-playoff-probabilities.md).
 */
export function simulatePlayoffProbabilities(rows, options = {}) {
  const {
    playoffSpots = DEFAULT_PLAYOFF_SPOTS,
    simulations = DEFAULT_SIMULATIONS,
    seed = 1,
    remainingWeeks = [],
    schedule = new Map(),
    teamProjectionsByWeek = new Map(),
    modelDate = null,
    ...powerOptions
  } = options;

  const power = calculatePowerRankings(rows, powerOptions);
  if (!power.ready) {
    return {
      ready: false,
      reason: power.reason,
      completedWeekCount: power.completedWeekCount,
      simulations: 0,
      seed,
      modelDate,
      probabilities: []
    };
  }

  const baseStandings = power.rankings.map(team => ({
    manager: team.manager,
    wins: team.wins,
    ties: team.ties,
    pointsFor: team.pointsFor
  }));

  const completedRows = (rows || []).filter(row => !row.isPlayoff
    && row.manager
    && Number.isFinite(Number(row.week))
    && Number.isFinite(Number(row.points))
    && (powerOptions.currentWeek == null || Number(row.week) < powerOptions.currentWeek));
  const { stdDevByManager } = calibrateUncertainty(completedRows);

  const coverageByManager = new Map();
  for (const [key, projection] of teamProjectionsByWeek) {
    const manager = key.split("|")[1];
    if (!coverageByManager.has(manager)) coverageByManager.set(manager, []);
    coverageByManager.get(manager).push(projection.coveragePct ?? 0);
  }

  const results = runSimulation({
    baseStandings,
    remainingWeeks,
    schedule,
    teamProjectionsByWeek,
    stdDevByManager,
    playoffSpots,
    simulations,
    seed
  });

  return {
    ready: true,
    reason: "ready",
    completedWeekCount: power.completedWeekCount,
    simulations,
    seed,
    playoffSpots,
    modelDate,
    probabilities: results.map(entry => {
      const coverageValues = coverageByManager.get(entry.manager) || [];
      const coveragePct = coverageValues.length
        ? Math.round((coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length) * 10) / 10
        : null;
      return { ...entry, coveragePct };
    }).sort((a, b) => b.probability - a.probability || a.manager.localeCompare(b.manager, "fr"))
  };
}
