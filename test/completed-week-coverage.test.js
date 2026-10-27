import test from "node:test";
import assert from "node:assert/strict";
import { calculateAllPlayRecords } from "../public/assets/all-play.js";
import { calculatePowerRankings } from "../public/assets/power-rankings.js";
const managers = ["A", "B"];
const base = [1, 2].flatMap(week => managers.map(manager => ({ week, manager, points: 100, opponentPoints: 100 })));
for (const calculate of [calculateAllPlayRecords, calculatePowerRankings]) {
  test(`${calculate.name}: all-zero unsynchronized week cannot invent ties after rollover`, () => {
    const rows = [...base, ...managers.map(manager => ({ week: 3, manager, points: 0, opponentPoints: 0 }))];
    const report = calculate(rows, { expectedManagers: managers, currentWeek: 4 });
    assert.equal(report.ready, false);
    assert.equal(report.reason, "score_completion_unverified");
    assert.equal(report.completedWeekCount, 2);
    assert.equal(calculate(rows.map(row => ({ ...row, completed: true })), { expectedManagers: managers, currentWeek: 4 }).ready, true);
  });
  test(`${calculate.name}: individual zeroes, real ties survive; missing and duplicate rows block`, () => {
    const rows = [...base, { week: 3, manager: "A", points: 0, opponentPoints: 100 }, { week: 3, manager: "B", points: 100, opponentPoints: 0 }];
    assert.equal(calculate(rows, { expectedManagers: managers, currentWeek: 4 }).ready, true);
    assert.equal(calculate(rows.slice(0, -1), { expectedManagers: managers, currentWeek: 4 }).ready, false);
    assert.equal(calculate([...rows, rows[0]], { expectedManagers: managers, currentWeek: 4 }).ready, false);
    assert.equal(calculate(rows.map(row => row.week === 3 ? { ...row, points: null } : row), { expectedManagers: managers, currentWeek: 4 }).ready, false);
    assert.equal(calculate(base, { expectedManagers: managers, currentWeek: 4 }).ready, false);
  });
}
