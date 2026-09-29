import test from "node:test";
import assert from "node:assert/strict";
import { calculateLuck, calculateRankHistory } from "../public/assets/standings-luck.js";

// 4 managers, 2 completed weeks + a live week 3. Week scores: A 100/90, B 95/120, C 60/80, D 70/50.
// Pairings: wk1 A-B (A wins), C-D (D wins); wk2 A-C (A wins), B-D (B wins).
const game = (week, manager, points, opponentPoints, extra = {}) => ({ week, manager, points, opponentPoints, ...extra });
const rows = [
  game(1, "A", 100, 95), game(1, "B", 95, 100), game(1, "C", 60, 70), game(1, "D", 70, 60),
  game(2, "A", 90, 80), game(2, "C", 80, 90), game(2, "B", 120, 50), game(2, "D", 50, 120),
  game(3, "A", 10, 5), game(3, "B", 5, 10), game(3, "C", 1, 2), game(3, "D", 2, 1)
];
const options = { currentWeek: 3, expectedManagers: ["A", "B", "C", "D"] };

test("luck stays locked before two completed weeks, like All-Play", () => {
  assert.equal(calculateLuck(rows, { ...options, currentWeek: 2 }).ready, false);
});

test("luck = actual wins - all-play expected wins, live week excluded", () => {
  const result = calculateLuck(rows, options);
  assert.equal(result.ready, true);
  const byManager = Object.fromEntries(result.records.map(record => [record.manager, record]));
  // A: all-play wk1 3-0, wk2 2-1 -> 5/6 * 2 = 1.67 expected, 2 actual -> +0.33
  assert.equal(byManager.A.actualWins, 2);
  assert.equal(byManager.A.luck, 0.33);
  // D: all-play wk1 1-2 (beats C), wk2 0-3 -> 1/6*2 = 0.33 expected, 1 actual -> +0.67 (lucky)
  assert.equal(byManager.D.luck, 0.67);
  // C: all-play wk1 0-3, wk2 1-2 -> 0.33 expected, 0 actual -> unlucky
  assert.equal(byManager.C.luck, -0.33);
  assert.equal(result.records.reduce((sum, record) => sum + record.luck, 0).toFixed(2), "0.00");
});

test("rank history ranks by wins then points-for after each completed week", () => {
  const history = calculateRankHistory(rows, options);
  assert.deepEqual(history.weeks, [1, 2]);
  const ranks = Object.fromEntries(history.series.map(entry => [entry.manager, entry.ranks]));
  assert.deepEqual(ranks.A, [1, 1]);
  assert.deepEqual(ranks.B, [3, 2]); // wk1 order: A, D (1 win each), then B, C
  assert.deepEqual(ranks.D, [2, 3]);
  assert.deepEqual(ranks.C, [4, 4]);
});

test("rank history ignores a week that isn't published for every manager", () => {
  const partial = [...rows.filter(row => row.week === 1), game(2, "A", 90, 80)];
  assert.deepEqual(calculateRankHistory(partial, { currentWeek: null, expectedManagers: ["A", "B", "C", "D"] }).weeks, [1]);
});
