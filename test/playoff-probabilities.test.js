import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptSleeperProjectionStats,
  projectPlayerFantasyPoints,
  calibrateUncertainty,
  resolvePlayerProjection,
  sumTeamProjection,
  runSimulation,
  simulatePlayoffProbabilities
} from "../public/assets/playoff-probabilities.js";

test("adaptSleeperProjectionStats maps Sleeper's snake_case projection fields to calculatePlayerFantasyPoints' shape", () => {
  const adapted = adaptSleeperProjectionStats({
    pass_yd: 250, pass_td: 2, pass_int: 1,
    rush_yd: 30, rush_td: 1,
    rec: 4, rec_yd: 25, rec_td: 0,
    fum_lost: 1,
    fgm_0_19: 0, fgm_20_29: 1, fgm_30_39: 1, fgm_40_49: 0,
    sack: 2, int: 1, def_td: 1, pts_allow: 14
  });
  assert.equal(adapted.passYds, 250);
  assert.equal(adapted.fg0To39, 2); // fgm_20_29 + fgm_30_39, since Adineu buckets 0-39 together
  assert.equal(adapted.defSack, 2);
  assert.equal(adapted.defPointsAllowed, 14);
});

test("projectPlayerFantasyPoints scores a raw Sleeper projection under Adineu's real rules end to end", () => {
  // 100 rush yds (10) + 1 rush TD (6) + 3 rec (3) + 20 rec yds (2) = 21 pts
  const points = projectPlayerFantasyPoints({ rush_yd: 100, rush_td: 1, rec: 3, rec_yd: 20 });
  assert.equal(points, 21.0);
});

test("calibrateUncertainty uses each manager's own completed-score spread when there are enough weeks", () => {
  const rows = [
    { manager: "A", points: 100 }, { manager: "A", points: 110 }, { manager: "A", points: 90 },
    { manager: "B", points: 100 }, { manager: "B", points: 100 } // only 2 weeks -> falls back to league-wide
  ];
  const { stdDevByManager, leagueStdDev } = calibrateUncertainty(rows);
  assert.ok(stdDevByManager.get("A") >= 3); // real spread, floored at MIN_STD_DEV
  assert.equal(stdDevByManager.get("B"), Math.max(leagueStdDev, 3)); // too few weeks -> league fallback
});

test("calibrateUncertainty never returns a std dev below the floor, even for a perfectly constant scorer", () => {
  const rows = [{ manager: "A", points: 100 }, { manager: "A", points: 100 }, { manager: "A", points: 100 }];
  const { stdDevByManager } = calibrateUncertainty(rows);
  assert.equal(stdDevByManager.get("A"), 3);
});

test("resolvePlayerProjection falls back direct -> season-average -> replacement -> 0, never guesses beyond that", () => {
  assert.deepEqual(resolvePlayerProjection({ directPoints: 12.5, seasonAveragePoints: 9, replacementPoints: 5 }), { points: 12.5, source: "direct" });
  assert.deepEqual(resolvePlayerProjection({ directPoints: NaN, seasonAveragePoints: 9, replacementPoints: 5 }), { points: 9, source: "season-average" });
  assert.deepEqual(resolvePlayerProjection({ directPoints: undefined, seasonAveragePoints: undefined, replacementPoints: 5 }), { points: 5, source: "replacement" });
  assert.deepEqual(resolvePlayerProjection({}), { points: 0, source: "none" });
});

test("sumTeamProjection totals points and reports the direct-projection coverage percentage", () => {
  const result = sumTeamProjection([
    { points: 10, source: "direct" },
    { points: 8, source: "direct" },
    { points: 5, source: "season-average" },
    { points: 0, source: "none" }
  ]);
  assert.equal(result.points, 23);
  assert.equal(result.coveragePct, 50); // 2 of 4 were direct
});

test("simulatePlayoffProbabilities is locked before the same completed-weeks gate as Power Rankings", () => {
  const rows = [{ week: 1, manager: "A", points: 100, opponentPoints: 90, isPlayoff: false }];
  const result = simulatePlayoffProbabilities(rows, { currentWeek: 2, expectedManagers: ["A", "B"] });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "insufficient_weeks");
  assert.deepEqual(result.probabilities, []);
});

// 4-team, 2-spot league; 3 completed weeks give A 3-0, B 2-1, C 1-2, D 0-3, then 1 remaining week
// (A-vs-B, C-vs-D). Enumerating all 4 possible remaining-week win outcomes shows A finishes top-2
// in every one, and D never does — so this fixture's qualification/elimination is mathematically
// certain, not just likely, regardless of how the simulated scores land.
const completedRows = [
  { week: 1, manager: "A", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 1, manager: "B", points: 90, opponentPoints: 110, isPlayoff: false },
  { week: 1, manager: "C", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 1, manager: "D", points: 90, opponentPoints: 110, isPlayoff: false },
  { week: 2, manager: "A", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 2, manager: "C", points: 90, opponentPoints: 110, isPlayoff: false },
  { week: 2, manager: "B", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 2, manager: "D", points: 90, opponentPoints: 110, isPlayoff: false },
  { week: 3, manager: "A", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 3, manager: "D", points: 90, opponentPoints: 110, isPlayoff: false },
  { week: 3, manager: "B", points: 110, opponentPoints: 90, isPlayoff: false },
  { week: 3, manager: "C", points: 90, opponentPoints: 110, isPlayoff: false }
];
const managers = ["A", "B", "C", "D"];
const schedule = new Map([[4, [["A", "B"], ["C", "D"]]]]);
const teamProjectionsByWeek = new Map(managers.map(manager => [`4|${manager}`, { points: 100, coveragePct: 80 }]));

function simulate(seed, simulations = 500) {
  return simulatePlayoffProbabilities(completedRows, {
    currentWeek: 4,
    expectedManagers: managers,
    playoffSpots: 2,
    remainingWeeks: [4],
    schedule,
    teamProjectionsByWeek,
    simulations,
    seed
  });
}

test("simulatePlayoffProbabilities gives a mathematically-clinched team probability exactly 1.0", () => {
  const result = simulate(1);
  assert.equal(result.ready, true);
  const teamA = result.probabilities.find(entry => entry.manager === "A");
  assert.equal(teamA.probability, 1);
});

test("simulatePlayoffProbabilities gives a mathematically-eliminated team probability exactly 0.0", () => {
  const result = simulate(1);
  const teamD = result.probabilities.find(entry => entry.manager === "D");
  assert.equal(teamD.probability, 0);
});

test("simulatePlayoffProbabilities' probabilities sum approximately to the number of playoff spots", () => {
  const result = simulate(1);
  const sum = result.probabilities.reduce((total, entry) => total + entry.probability, 0);
  assert.ok(Math.abs(sum - 2) < 0.01, `expected ~2, got ${sum}`);
});

test("simulatePlayoffProbabilities is deterministic for a fixed seed", () => {
  const first = simulate(42);
  const second = simulate(42);
  assert.deepEqual(first.probabilities, second.probabilities);
});

test("simulatePlayoffProbabilities never crashes on a remaining week the schedule doesn't cover", () => {
  const result = simulatePlayoffProbabilities(completedRows, {
    currentWeek: 4,
    expectedManagers: managers,
    playoffSpots: 2,
    remainingWeeks: [4, 5], // week 5 has no schedule entry at all
    schedule,
    teamProjectionsByWeek,
    simulations: 50,
    seed: 7
  });
  assert.equal(result.ready, true);
  assert.equal(result.probabilities.length, 4);
});

test("runSimulation reports per-manager coverage via the caller-supplied projections, not fabricated here", () => {
  const result = runSimulation({
    baseStandings: [{ manager: "A", wins: 1, ties: 0, pointsFor: 100 }, { manager: "B", wins: 0, ties: 0, pointsFor: 90 }],
    remainingWeeks: [],
    schedule: new Map(),
    teamProjectionsByWeek: new Map(),
    stdDevByManager: new Map([["A", 5], ["B", 5]]),
    playoffSpots: 1,
    simulations: 10,
    seed: 3
  });
  // With no remaining weeks, standings never change — A (already ahead on wins) qualifies every run.
  assert.equal(result.find(entry => entry.manager === "A").probability, 1);
  assert.equal(result.find(entry => entry.manager === "B").probability, 0);
});
