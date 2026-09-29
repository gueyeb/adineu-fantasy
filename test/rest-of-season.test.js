import { test } from "node:test";
import assert from "node:assert/strict";
import { usageAdjustedRosPpg } from "../public/assets/rest-of-season.js";

test("keeps the next two Sleeper weeks and blends later weeks 80/20 with xFP (backtested weight)", () => {
  const result = usageAdjustedRosPpg({
    playerId: "p1", position: "WR", nflTeam: "FA", week: 4, xfp: 20,
    projectionsByWeek: {
      4: { p1: { pts_ppr: 10 } }, 5: { p1: { pts_ppr: 12 } },
      6: { p1: { pts_ppr: 8 } }, 7: { p1: { pts_ppr: 6 } }
    }
  });
  // weeks 6-7: 0.8 × projection + 0.2 × xFP -> 10.4 and 8.8; mean of 10, 12, 10.4, 8.8 = 10.3
  assert.deepEqual(result, { ppg: 10.3, source: "SLEEPER_USAGE_BLEND", usageWeeks: 2, loadedWeeks: 4 });
});

test("does not apply skill-position xFP to quarterbacks", () => {
  const result = usageAdjustedRosPpg({
    playerId: "qb", position: "QB", nflTeam: "FA", week: 12, xfp: 40,
    projectionsByWeek: { 12: { qb: { pts_ppr: 10 } }, 13: { qb: { pts_ppr: 12 } }, 14: { qb: { pts_ppr: 8 } } }
  });
  assert.deepEqual(result, { ppg: 10, source: "SLEEPER_PROJECTIONS", usageWeeks: 0, loadedWeeks: 3 });
});
