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
  assert.deepEqual(result, { ppg: 10.3, source: "SLEEPER_USAGE_BLEND", projectedWeeks: 4, usageWeeks: 2, loadedWeeks: 4 });
});

test("QBs blend far weeks 50/50 with their own xFP; positions without usage keep Sleeper only", () => {
  const projectionsByWeek = { 12: { p: { pts_ppr: 10 } }, 13: { p: { pts_ppr: 12 } }, 14: { p: { pts_ppr: 8 } } };
  const qb = usageAdjustedRosPpg({ playerId: "p", position: "QB", nflTeam: "FA", week: 12, xfp: 20, projectionsByWeek });
  // week 14 is the only far week: 0.5 × 8 + 0.5 × 20 = 14 -> mean of 10, 12, 14 = 12
  assert.deepEqual(qb, { ppg: 12, source: "SLEEPER_USAGE_BLEND", projectedWeeks: 3, usageWeeks: 1, loadedWeeks: 3 });
  const kicker = usageAdjustedRosPpg({ playerId: "p", position: "K", nflTeam: "FA", week: 12, xfp: 20, projectionsByWeek });
  assert.deepEqual(kicker, { ppg: 10, source: "SLEEPER_PROJECTIONS", projectedWeeks: 3, usageWeeks: 0, loadedWeeks: 3 });
});

test("a value built from xFP alone is labelled as such, never as a Sleeper projection", () => {
  const projectionsByWeek = { 4: {}, 5: {}, 6: {}, 7: {} };
  const result = usageAdjustedRosPpg({ playerId: "p1", position: "WR", nflTeam: "FA", week: 4, xfp: 9, projectionsByWeek });
  assert.equal(result.source, "USAGE_XFP_ONLY");
  assert.equal(result.projectedWeeks, 0);
});
