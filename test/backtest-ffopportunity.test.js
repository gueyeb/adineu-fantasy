import test from "node:test";
import assert from "node:assert/strict";
import { attachExpectedPoints, compare, heldOutBlend, parseExpectedPoints } from "../scripts/backtest-ffopportunity.js";

test("parseExpectedPoints keeps gsis, week and expected points of regular weeks", () => {
  const csv = "season,posteam,week,player_id,total_fantasy_points_exp\n2025,ARI,1,00-1,22.01\n2025,ARI,19,00-1,9\n2025,ARI,2,,5\n";
  assert.deepEqual(parseExpectedPoints(csv), [["00-1", 1, 22.01]]);
});

test("expected points average the decision's three past weeks and need two of them", () => {
  const expectedBySeason = { 2025: new Map([["g1|3", 10], ["g1|4", 14], ["g2|4", 8]]) };
  const rows = attachExpectedPoints([{ season: 2025, decision: 5, playerId: "a" }, { season: 2025, decision: 5, playerId: "b" }, { season: 2025, decision: 5, playerId: "c" }],
    { expectedBySeason, gsisOf: id => ({ a: "g1", b: "g2" })[id] ?? null });
  assert.deepEqual(rows.map(row => row.ffopp), [12, null, null]);
});

test("a blend weight is chosen on the other seasons only", () => {
  // Season 1 rewards the challenger, season 2 the projection: each held-out season gets the other's weight.
  const rows = [
    { season: 1, projection: 0, xfp: 10, far: 10 }, { season: 1, projection: 0, xfp: 10, far: 10 },
    { season: 2, projection: 10, xfp: 0, far: 10 }, { season: 2, projection: 10, xfp: 0, far: 10 }
  ];
  const result = heldOutBlend(rows, "xfp", "far");
  assert.deepEqual(result.weights, { 1: 0, 2: 1 });
  assert.equal(result.mae, 10);
  assert.deepEqual(compare([], "far"), { n: 0 });
});
