import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectedLineup, restOfSeasonEstimate, scoreTradeRecommendation, weeklyEstimate } from "../public/assets/trade-score.js";
import { calculatePlayerTradeProfile } from "../public/assets/trade-value.js";
import { findTradeProposals } from "../public/assets/trade-recommender.js";

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
  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [{ roster_id: 1, players: mine }, { roster_id: 2, players: theirs }] });
  const swap = proposals.find(proposal => proposal.give[0].name === give.name && proposal.receive[0].name === receive.name);
  assert.ok(swap);
  assert.equal(swap.recommendationScore.my_lineup_delta, 7);
  assert.equal(swap.category, "WIN_WIN");
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
  assert.ok(Number.isFinite(missing.my_lineup_delta), "falls back to an expert-rank estimate instead of nulling the whole team delta");
  assert.equal(missing.winWin, false);
  assert.equal(missing.confidence, "LOW");
});

test("a single unprojected roster player (bye/inactive/pre-publish) doesn't null the whole team delta", () => {
  const give = player("WR surplus", "WR", 15);
  const receive = player("RB surplus", "RB", 15);
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), give, player("WR bench", "WR", 14)];
  const theirs = [...core("T"), player("TRB1", "RB", 18), player("TRB2", "RB", 17), receive, player("TRB bench", "RB", 14), player("TWR1", "WR", 14), player("TWR2", "WR", 7)];
  // A starter unrelated to the trade (mine.WR1) has no live Sleeper projection yet.
  delete mine.find(p => p.name === "WR1").projectedPpg;
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive] });
  assert.ok(Number.isFinite(score.my_lineup_delta));
  assert.ok(Number.isFinite(score.their_lineup_delta));
});

test("premium market value cannot collapse on missing projection and one zero score", () => {
  const base = { name: "Premium RB", position: "RB", quality: { expertRank: 10 } };
  assert.equal(calculatePlayerTradeProfile({ ...base, weeklyScores: [0] }).tradeValue, calculatePlayerTradeProfile(base).tradeValue);
  assert.ok(calculatePlayerTradeProfile({ ...base, projectedPpg: 0, weeklyScores: [0] }).tradeValue > 50);
});

test("an Out/IR player scores 0 this week but keeps rest-of-season value (injury is modeled, not missing data)", () => {
  const star = { name: "Injured star", position: "RB", nflTeam: "NYJ", injuryStatus: "IR", quality: { expertRank: 5 } };
  assert.equal(weeklyEstimate(star), 0);
  const ros = restOfSeasonEstimate(4)(star);
  const healthy = restOfSeasonEstimate(4)({ ...star, injuryStatus: null });
  assert.ok(ros > 0 && ros < healthy, "IR discounts ~4 of the remaining games, never to zero");
  const give = player("WR surplus", "WR", 15);
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), give];
  const theirs = [...core("T"), star, player("TRB2", "RB", 17), player("TRB3", "RB", 16), player("TWR1", "WR", 10), player("TWR2", "WR", 7)];
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [star], week: 4 });
  assert.equal(score.horizon, "ROS");
  assert.ok(!score.warnings.some(w => /projection/.test(w)), "an injury explains the missing projection");
  assert.ok(score.notes.some(n => /IR/.test(n)));
  assert.equal(score.confidence, "MEDIUM");
  assert.ok(Number.isFinite(score.my_lineup_delta));
});

test("an empty starter slot counts as 0 instead of hiding every trade impact", () => {
  const give = player("WR surplus", "WR", 15);
  const receive = player("RB surplus", "RB", 15);
  const noDef = core("M").filter(p => p.position !== "DEF");
  const mine = [...noDef, player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), give, player("WR bench", "WR", 14)];
  const theirs = [...core("T"), player("TRB1", "RB", 18), player("TRB2", "RB", 17), receive, player("TRB bench", "RB", 14), player("TWR1", "WR", 14), player("TWR2", "WR", 7)];
  const lineup = buildProjectedLineup(mine);
  assert.deepEqual(lineup.emptySlots, ["DEF"]);
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive] });
  assert.equal(score.my_lineup_delta, 7);
  assert.equal(score.winWin, true);
});

test("losing your only QB is priced as a 0-point slot", () => {
  const qb = player("Only QB", "QB", 20);
  const wr = player("WR", "WR", 12);
  const mine = [...core("M").filter(p => p.position !== "QB"), qb, player("RB1", "RB", 14), player("RB2", "RB", 12), player("WR1", "WR", 18), player("WR2", "WR", 17)];
  const theirs = [...core("T"), wr, player("TRB1", "RB", 18), player("TRB2", "RB", 17), player("TWR1", "WR", 14), player("TWR2", "WR", 13)];
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [qb], receive: [wr] });
  assert.equal(score.my_lineup_delta, -8, "QB 20 -> empty 0, WR 12 fills the empty FLEX");
  assert.ok(score.notes.some(n => /Ta lineup perd son QB/.test(n)));
  assert.equal(score.tradeability, "Peu réaliste");
});

test("a 2-for-1 that overflows the partner roster names their likely cut instead of blocking", () => {
  const give = [player("Give A", "WR", 11), player("Give B", "RB", 10)];
  const receive = [player("Stud", "WR", 19)];
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 12), player("WR1", "WR", 18), player("WR2", "WR", 17), ...give];
  const theirs = [...core("T"), ...receive, player("TRB1", "RB", 18), player("TRB2", "RB", 17), player("TWR1", "WR", 14), player("TWR2", "WR", 13),
    ...Array.from({ length: 7 }, (_, i) => player(`Bench${i}`, "WR", 2 + i))];
  assert.equal(theirs.length, 16);
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give, receive });
  assert.ok(score.notes.some(n => /Il devra libérer une place : coupe probable Bench0/.test(n)));
  assert.ok(!score.warnings.some(w => /coupe/.test(w)));
});

test("roster overflow ignores the IR slot for healthy players", () => {
  const give = [player("Give A", "WR", 11), player("Give B", "RB", 10)];
  const receive = [player("Stud", "WR", 19)];
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 12), player("WR1", "WR", 18), player("WR2", "WR", 17), ...give];
  // 15 healthy players, empty IR: receiving 2-for-1 leaves 16 healthy -> a cut is required.
  const theirs = [...core("T"), ...receive, player("TRB1", "RB", 18), player("TRB2", "RB", 17), player("TWR1", "WR", 14), player("TWR2", "WR", 13),
    ...Array.from({ length: 6 }, (_, i) => player(`Bench${i}`, "WR", 2 + i))];
  assert.equal(theirs.length, 15);
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give, receive });
  assert.ok(score.notes.some(n => /Il devra libérer une place/.test(n)));
});
