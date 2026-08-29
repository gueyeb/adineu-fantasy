import test from "node:test";
import assert from "node:assert/strict";

import { calculatePowerRankings } from "../public/assets/power-rankings.js";

const managers = Array.from({ length: 12 }, (_, index) => `Manager ${index + 1}`);

function matchupRows(weeks = 2) {
  return Array.from({ length: weeks }, (_, weekIndex) => managers.map((manager, managerIndex) => ({
    week: weekIndex + 1,
    manager,
    team: `Team ${managerIndex + 1}`,
    points: 150 - managerIndex * 3 + weekIndex,
    opponentPoints: 95 + managerIndex,
    isPlayoff: false
  }))).flat();
}

test("keeps rankings locked with no completed matchup", () => {
  const result = calculatePowerRankings([], { expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "insufficient_weeks");
  assert.equal(result.completedWeekCount, 0);
});

test("keeps rankings locked after only one completed week", () => {
  const result = calculatePowerRankings(matchupRows(1), { expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.completedWeekCount, 1);
});

test("publishes after two complete weeks and ranks the dominant team first", () => {
  const result = calculatePowerRankings(matchupRows(), { expectedManagers: managers });
  assert.equal(result.ready, true);
  assert.equal(result.rankings.length, 12);
  assert.equal(result.rankings[0].manager, "Manager 1");
  assert.equal(result.rankings[0].rank, 1);
});

test("excludes the live week and playoff rows", () => {
  const rows = [
    ...matchupRows(2),
    ...matchupRows(1).map(row => ({ ...row, week: 3, points: 999 })),
    ...matchupRows(1).map(row => ({ ...row, week: 16, points: 999, isPlayoff: true }))
  ];
  const result = calculatePowerRankings(rows, { currentWeek: 3, expectedManagers: managers });
  assert.deepEqual(result.completedWeeks, [1, 2]);
  assert.equal(result.rankings[0].pointsPerGame, 150.5);
});

test("preserves ties instead of inventing an ordering", () => {
  const rows = Array.from({ length: 2 }, (_, weekIndex) => managers.map(manager => ({
    week: weekIndex + 1,
    manager,
    team: manager,
    points: 100,
    opponentPoints: 90,
    isPlayoff: false
  }))).flat();
  const result = calculatePowerRankings(rows, { expectedManagers: managers });
  assert.equal(new Set(result.rankings.map(row => row.powerScore)).size, 1);
  assert.equal(new Set(result.rankings.map(row => row.rank)).size, 1);
});

test("requires complete manager coverage before publishing", () => {
  const rows = matchupRows().filter(row => row.manager !== "Manager 12" || row.week === 1);
  const result = calculatePowerRankings(rows, { expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "incomplete_coverage");
  assert.equal(result.teamsReady, 11);
});
