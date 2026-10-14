import test from "node:test";
import assert from "node:assert/strict";
import { ratesBeforeWeek, scoreTrades } from "../scripts/backtest-trade-value.js";

test("rates use only games before the trade week, plus the next week's projection", () => {
  const statsByWeek = { 1: { a: { gp: 1, pts_ppr: 10 }, b: { gp: 0, pts_ppr: 0 } }, 2: { a: { gp: 1, pts_ppr: 20 } }, 3: { a: { gp: 1, pts_ppr: 99 } } };
  const rows = ratesBeforeWeek({ statsByWeek, projection: { a: { pts_ppr: 11 }, c: { pts_ppr: 5 }, x: { pts_ppr: 3 } }, week: 3, positionOf: id => ({ a: "RB", b: "RB", c: "WR" })[id] ?? null });
  const byId = Object.fromEntries(rows.map(row => [row.playerId, row]));
  assert.deepEqual([byId.a.ppg, byId.a.projected, byId.a.mean, byId.a.points], [15, 11, 13, 30]);
  assert.deepEqual([byId.c.ppg, byId.c.projected, byId.c.mean], [null, 5, 5]);
  assert.equal(byId.b, undefined, "no game played and no projection");
  assert.equal(byId.x, undefined, "unknown position");
});

test("only decided trades are scored; unpriced players and ties are set aside", () => {
  const trade = (winner, values, outcome = "WON") => ({ key: { winner }, outcome: { verdict: outcome, winner }, sides: [
    { manager: "A", received: [{ v: values[0] }] }, { manager: "B", received: [{ v: values[1] }] }] });
  const score = scoreTrades([trade("A", [30, 10]), trade("B", [30, 20]), trade("A", [5, 5]), trade("A", [null, 3]), trade(null, [9, 1], "EVEN")], { valueOf: player => player.v });
  assert.deepEqual([score.decided, score.priced, score.agreement, score.clearCalls, score.clearCallAgreement], [3, 2, 0.5, 2, 0.5]);
});
