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

test("tradeReturnScenarios: injured asset valued week by week under three return hypotheses", async () => {
  const { tradeReturnScenarios, expectedReturnWeek } = await import("../public/assets/trade-score.js");
  const p = (id, position, nflTeam, extra = {}) => ({ sleeperId: id, name: id, position, nflTeam, ...extra });
  const mine = [p("myQB", "QB", "NYG"), p("WR1", "WR", "LAR"), p("WR2", "WR", "BUF"), p("star", "WR", "NE", { injuryStatus: "IR" }),
    p("RB1", "RB", "PIT"), p("RB2", "RB", "PIT"), p("TE", "TE", "ARI"), p("K", "K", "DAL"), p("DEF", "DEF", "IND")];
  const theirs = [p("QB1", "QB", "KC"), p("QB2", "QB", "SEA"), p("TWR1", "WR", "CHI"), p("TWR2", "WR", "DET"), p("TWR3", "WR", "MIA"),
    p("TRB1", "RB", "ATL"), p("TRB2", "RB", "ATL"), p("TTE", "TE", "LV"), p("TK", "K", "LV"), p("TDEF", "DEF", "LV")];
  const rates = { myQB: 12, WR1: 18, WR2: 12, star: 16, RB1: 13, RB2: 9, TE: 14, K: 8, DEF: 6, QB1: 19, QB2: 17, TWR1: 11, TWR2: 13, TWR3: 10, TRB1: 12, TRB2: 10, TTE: 9, TK: 8, TDEF: 6 };
  const projectionsByWeek = {};
  for (let w = 12; w <= 14; w++) projectionsByWeek[w] = Object.fromEntries(Object.entries(rates).map(([id, pts]) => [id, { pts_ppr: pts }]));
  delete projectionsByWeek[12].star; delete projectionsByWeek[13].star; // Sleeper projects the star again from W14 only
  projectionsByWeek[12].star = { pts_ppr: 16 }; // stale current-week projection while on IR: ignored
  assert.equal(expectedReturnWeek(mine[3], { week: 12, projectionsByWeek }), 14);
  const result = tradeReturnScenarios({ myPlayers: mine, theirPlayers: theirs, give: [mine[3]], receive: [theirs[0]], week: 12, projectionsByWeek });
  assert.deepEqual(result.weeks, { from: 12, to: 14 });
  const byId = Object.fromEntries(result.scenarios.map(row => [row.id, row]));
  assert.deepEqual(Object.keys(byId), ["IMMEDIATE", "PROGRESSIVE", "LONG"]);
  assert.equal(byId.IMMEDIATE.returnWeeks.star, 13);
  assert.equal(byId.PROGRESSIVE.returnWeeks.star, 14);
  // W12: QB1 19 replaces myQB 12 and the star is out either way.
  assert.equal(byId.LONG.byWeek[0].myDelta, 7);
  // Once the star is back he would have started over WR2 (12): the later his return, the better the trade for me.
  assert.ok(byId.IMMEDIATE.myTotal < byId.PROGRESSIVE.myTotal && byId.PROGRESSIVE.myTotal < byId.LONG.myTotal);
  assert.ok(byId.IMMEDIATE.theirTotal > byId.LONG.theirTotal);
  assert.deepEqual(result.range.mine, [byId.IMMEDIATE.myTotal, byId.LONG.myTotal]);
  // W13 has no star projection: filled by his healthy rate and reported, never silent.
  assert.deepEqual(result.evidence.projectionGaps, ["star S13"]);
  assert.equal(result.evidence.quality, "MEDIUM");
});

test("tradeReturnScenarios flags a starter slot at 0 on one side only (bye without backup)", async () => {
  const { tradeReturnScenarios } = await import("../public/assets/trade-score.js");
  const p = (id, position, nflTeam) => ({ sleeperId: id, name: id, position, nflTeam });
  const mine = [p("myQB", "QB", "NYG"), p("WR", "WR", "LAR"), p("WR2", "WR", "LAR")];
  const theirs = [p("QB1", "QB", "KC"), p("QB2", "QB", "SEA"), p("TWR", "WR", "KC")];
  const projectionsByWeek = { 8: { myQB: { pts_ppr: 12 }, WR: { pts_ppr: 10 }, WR2: { pts_ppr: 9 }, QB1: { pts_ppr: 18 }, QB2: { pts_ppr: 15 }, TWR: { pts_ppr: 8 } } };
  const result = tradeReturnScenarios({ myPlayers: mine, theirPlayers: theirs, give: [mine[1]], receive: [theirs[0], theirs[2]], week: 8, projectionsByWeek });
  assert.equal(result.scenarios[0].id, "HEALTHY");
  assert.deepEqual(result.evidence.emptySlotWeeks.filter(row => row.week === 8), [{ team: "mine", week: 8, slots: ["QB"] }]); // NYG bye week 8
  assert.equal(result.evidence.quality, "MEDIUM");
});

test("return assumptions never certify IR activation and ignore zero or negative future projections", async () => {
  const { returnWeekAssumption, tradeReturnScenarios } = await import("../public/assets/trade-score.js");
  const injured = { sleeperId: "ir", name: "IR player", position: "RB", nflTeam: "NYJ", injuryStatus: "IR" };
  const context = { week: 7, projectionsByWeek: { 8: { ir: { pts_ppr: 0 } }, 9: { ir: { pts_ppr: -1 } }, 10: { ir: { pts_ppr: 15 } } } };
  assert.deepEqual(returnWeekAssumption(injured, context), { week: 10, basis: "FUTURE_PROJECTION_ASSUMPTION", availability: "UNVERIFIED" });
  assert.deepEqual(returnWeekAssumption(injured, { week: 7 }), { week: 10, basis: "STATUS_DURATION_ASSUMPTION", availability: "UNVERIFIED" });
  const result = tradeReturnScenarios({ myPlayers: [injured], theirPlayers: [], give: [], receive: [], ...context });
  assert.equal(result.evidence.returnAssumptions[0].traded, false, "retained injured players carry the same explicit assumption");
  assert.equal(result.evidence.lineupAvailability, "UNVERIFIED");
  assert.equal(result.evidence.transactionTiming, "UNVERIFIED");
  assert.match(result.evidence.notes.join(" "), /pas une lineup alignable/);
});
