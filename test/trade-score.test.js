import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectedLineup, scoreTradeRecommendation } from "../public/assets/trade-score.js";
import { calculatePlayerTradeProfile } from "../public/assets/trade-value.js";

const player = (name, position, projectedPpg, rank = 40) => ({ name, position, projectedPpg, quality: { expertRank: rank } });
const core = prefix => [player(`${prefix}QB`, "QB", 20), player(`${prefix}TE`, "TE", 10), player(`${prefix}K`, "K", 8), player(`${prefix}DEF`, "DEF", 8)];

test("bilateral lineup deltas use replacements and FLEX, not package point sums", () => {
  const give = player("WR surplus", "WR", 15);
  const receive = player("RB surplus", "RB", 15);
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), give, player("WR bench", "WR", 14)];
  const theirs = [...core("T"), player("TRB1", "RB", 18), player("TRB2", "RB", 17), receive, player("TRB bench", "RB", 14), player("TWR1", "WR", 14), player("TWR2", "WR", 7)];
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive] });
  assert.equal(score.my_lineup_delta, 7);
  assert.equal(score.their_lineup_delta, 7);
  assert.equal(score.winWin, true);
  assert.equal(score.tradeability, "Naturelle");
  assert.equal(new Set(buildProjectedLineup(mine).slots.map(slot => slot.sleeperId)).size, 9);
});

test("negative impact and missing projection cannot be advertised as win-win", () => {
  const give = player("WR", "WR", 20);
  const receive = player("RB", "RB", 5);
  const mine = [...core("M"), player("M1", "RB", 14), player("M2", "RB", 12), give, player("M3", "WR", 17), player("M4", "WR", 10)];
  const theirs = [...core("T"), player("T1", "RB", 14), player("T5", "RB", 6), receive, player("T2", "WR", 14), player("T3", "WR", 12), player("T4", "WR", 10)];
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive] });
  assert.ok(score.my_lineup_delta < 0);
  assert.equal(score.winWin, false);
  assert.equal(score.tradeability, "Peu réaliste");
  delete receive.projectedPpg;
  const missing = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive] });
  assert.equal(missing.my_lineup_delta, null);
  assert.equal(missing.winWin, false);
  assert.equal(missing.confidence, "LOW");
});

test("premium market value cannot collapse on missing projection and one zero score", () => {
  const base = { name: "Premium RB", position: "RB", quality: { expertRank: 10 } };
  assert.equal(calculatePlayerTradeProfile({ ...base, weeklyScores: [0] }).tradeValue, calculatePlayerTradeProfile(base).tradeValue);
  assert.ok(calculatePlayerTradeProfile({ ...base, projectedPpg: 0, weeklyScores: [0] }).tradeValue > 50);
});
