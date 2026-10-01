import test from "node:test";
import assert from "node:assert/strict";
import { boomBust, bucketFor, playerVolatility, recommendLineupMode } from "../public/assets/boom-bust.js";
import { buildBoomSafeLineups } from "../scripts/lineup-advisor.js";

// Ratio grid 0..2 in 21 steps: ratio(q) = 2q, i.e. actual uniform between 0 and 2x the projection.
const uniform = Array.from({ length: 21 }, (_, i) => Number((i * 0.1).toFixed(1)));
const calibration = { WR: [{ bucket: "5-8", ratios: null }, { bucket: "8-11", ratios: uniform }] };

test("boom/bust probabilities and floor/ceiling come from the calibrated ratio distribution", () => {
  const result = boomBust({ position: "WR", projection: 10, calibration });
  assert.equal(result.floor, 4);     // 20th percentile ratio 0.4
  assert.equal(result.ceiling, 16);  // 80th percentile ratio 1.6
  assert.equal(result.boomPct, 0);   // 20 pts needs ratio 2.0 = the max
  assert.equal(result.bustPct, 30);  // <= 6 pts = ratio 0.6 = 30th percentile
});

test("falls back to the nearest calibrated bucket, never invents for unknown positions or Out players", () => {
  assert.ok(boomBust({ position: "WR", projection: 6, calibration }), "5-8 bucket empty -> nearest 8-11");
  assert.equal(boomBust({ position: "LB", projection: 10, calibration }), null);
  assert.equal(boomBust({ position: "WR", projection: null, calibration }), null);
  assert.deepEqual(boomBust({ position: "WR", projection: 10, calibration, injuryStatus: "Out" }), { floor: 0, median: 0, ceiling: 0, boomPct: 0, bustPct: 100 });
  assert.equal(bucketFor(30), "22-99");
  assert.equal(bucketFor(0.5), "1-5", "a tiny projection uses the lowest bucket, not the 22+ one");
});

test("volatility widens or narrows the spread around the median, and is shrunk toward 1", () => {
  const wide = boomBust({ position: "WR", projection: 10, calibration, volatility: 1.5 });
  const narrow = boomBust({ position: "WR", projection: 10, calibration, volatility: 0.5 });
  assert.ok(wide.ceiling > 16 && narrow.ceiling < 16);
  assert.equal(playerVolatility([], 0.4), 1);
  const wild = playerVolatility([0, 3, 0, 3], 0.4); // 4 extreme games: shrunk and clamped
  assert.ok(wild > 1 && wild <= 1.6);
});

test("lineup mode follows the pregame win estimate", () => {
  assert.equal(recommendLineupMode(30), "BOOM");
  assert.equal(recommendLineupMode(50), "OPTIMAL");
  assert.equal(recommendLineupMode(75), "SAFE");
  assert.equal(recommendLineupMode(null), "OPTIMAL");
});

test("Boom picks ceilings and Safe picks floors at FLEX", () => {
  const p = (id, position, projection, floor, ceiling) => ({ sleeperId: id, name: id, position, projection, floor, ceiling });
  const players = [p("qb", "QB", 18, 12, 24), p("rb1", "RB", 15, 9, 22), p("rb2", "RB", 14, 8, 21), p("wr1", "WR", 15, 8, 23), p("wr2", "WR", 14, 7, 22), p("te", "TE", 10, 5, 15), p("k", "K", 8, 5, 12), p("def", "DEF", 7, 2, 12),
    p("steady", "RB", 11, 9, 13), p("explosive", "WR", 10.5, 2, 20)];
  const lineups = buildBoomSafeLineups(players, new Set(["qb", "rb1", "rb2", "wr1", "wr2", "te", "k", "def", "steady"]));
  const starters = lineup => new Set(lineup.slots.map(slot => slot.sleeperId));
  assert.ok(starters(lineups.optimal).has("steady") && !starters(lineups.optimal).has("explosive"));
  assert.ok(starters(lineups.safe).has("steady") && !starters(lineups.safe).has("explosive"), "steady floor 9 beats rb2 (8): it even takes RB2");
  assert.ok(starters(lineups.boom).has("explosive") && !starters(lineups.boom).has("steady"), "explosive ceiling 20 wins the FLEX");
  assert.equal(lineups.current.projection, 112);
});
