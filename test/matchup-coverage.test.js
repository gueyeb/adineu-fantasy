import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMatchupCoverage } from "../public/assets/matchup-coverage.js";

test("eight projected starters are 8/9 independently of loaded players", () => {
  const starters = Array.from({ length: 8 }, (_, i) => String(i + 1));
  const projections = Object.fromEntries(starters.map(id => [id, { pts_ppr: 10 }]));
  const result = summarizeMatchupCoverage({ starters, projections });
  assert.equal(result.coverage, "8/9");
  assert.equal(result.emptySlots, 1);
  assert.equal(result.mixedTotal, null);
});
test("final zero scores count as actual; live games never reuse their full pregame projection", () => {
  const args = { starters: ["done", "next"], requiredSlots: 2, projections: { next: { pts_ppr: 15 } }, actualPoints: { done: 0 }, gameStateOf: id => id === "done" ? "FINAL" : "PREGAME" };
  const result = summarizeMatchupCoverage(args);
  assert.equal(result.coverage, "2/2");
  assert.equal(result.lockedWithActual, 1);
  assert.equal(result.mixedTotal, 15);
  const live = summarizeMatchupCoverage({ ...args, actualPoints: { done: 7 }, gameStateOf: id => id === "done" ? "LIVE" : "PREGAME" });
  assert.equal(live.pointsAcquired, 7);
  assert.equal(live.projectionsRemaining, 15);
  assert.equal(live.mixedTotal, null);
});
