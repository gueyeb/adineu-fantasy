import test from "node:test";
import assert from "node:assert/strict";
import { playerStatus, preferenceAdjustment } from "../public/assets/trade-preferences.js";
import { findTradeProposals, findCounterOffers } from "../public/assets/trade-recommender.js";

const player = (name, position, projectedPpg) => ({ name, position, projectedPpg, quality: { expertRank: 40 } });
const core = prefix => [player(`${prefix}QB`, "QB", 20), player(`${prefix}TE`, "TE", 10), player(`${prefix}K`, "K", 8), player(`${prefix}DEF`, "DEF", 8)];
const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), player("Give", "WR", 15), player("Alternative", "WR", 14)];
const theirs = [...core("T"), player("TRB1", "RB", 18), player("TRB2", "RB", 17), player("Receive", "RB", 15), player("TRBbench", "RB", 14), player("TWR1", "WR", 14), player("TWR2", "WR", 7)];
const rosters = [{ roster_id: 1, players: mine }, { roster_id: 2, players: theirs }];

test("preferences validate statuses and prioritize without changing production", () => {
  assert.equal(playerStatus(mine[0], { MQB: "invalid" }), "LISTEN");
  assert.equal(preferenceAdjustment([mine[0]], { MQB: "SHOP" }), 8);
  assert.equal(preferenceAdjustment([mine[0]], { MQB: "KEEP" }), -20);
  assert.equal(preferenceAdjustment([mine[0]], { MQB: "UNTOUCHABLE" }), null);
  const normal = findTradeProposals({ targetRosterId: 1, rosters });
  const locked = findTradeProposals({ targetRosterId: 1, rosters, playerPreferences: { Give: "UNTOUCHABLE" } });
  assert.ok(normal.some(p => p.give.some(g => g.name === "Give")));
  assert.ok(locked.every(p => p.give.every(g => g.name !== "Give")));
  const remaining = locked.find(p => p.give.length === 1 && p.give[0].name === "Alternative" && p.receive[0].name === "Receive");
  assert.ok(remaining);
  assert.equal(remaining.recommendationScore.lineups.mine.before.slots.some(slot => slot.name === "Give"), true);
});

test("counteroffers are owned, distinct, bounded and bilaterally scored", () => {
  const proposal = { give: [mine[8]], receive: [theirs[6]], category: "WIN_WIN" };
  const offers = findCounterOffers({ proposal, myPlayers: mine, theirPlayers: theirs });
  assert.ok(offers.length > 0 && offers.length <= 3);
  for (const offer of offers) {
    assert.ok(offer.recommendationScore.my_lineup_delta > 0);
    assert.ok(offer.recommendationScore.their_lineup_delta >= 0);
    assert.notDeepEqual(offer.give, proposal.give);
  }
  const locked = Object.fromEntries(mine.map(p => [p.name, "UNTOUCHABLE"]));
  assert.deepEqual(findCounterOffers({ proposal, myPlayers: mine, theirPlayers: theirs, playerPreferences: locked }), []);
  assert.deepEqual(findCounterOffers({ proposal: { ...proposal, receive: [player("Unknown", "RB", 20)] }, myPlayers: mine, theirPlayers: theirs }), []);
});

test("untouchable players never crowd out the exhaustive lineup search", () => {
  const p = (name, position, projectedPpg, rank) => ({ sleeperId: name, name, position, projectedPpg, quality: { expertRank: rank } });
  const core = x => [p(`${x}QB`, "QB", 18, 60), p(`${x}TE`, "TE", 9, 90), p(`${x}K`, "K", 8, 150), p(`${x}DEF`, "DEF", 8, 150)];
  const mine = [...core("M"), p("MRB1", "RB", 16, 20), p("MRB2", "RB", 15, 24), p("MRB3", "RB", 14, 30), p("MRB4", "RB", 13, 36), p("MWR1", "WR", 16, 22), p("MWR2", "WR", 6, 110)];
  const theirs = [...core("T"), p("TWR1", "WR", 16, 21), p("TWR2", "WR", 15, 25), p("TWR3", "WR", 14, 31), p("TWR4", "WR", 13, 35), p("TRB1", "RB", 16, 23), p("TRB2", "RB", 6, 115)];
  const playerPreferences = { MRB3: "UNTOUCHABLE" };
  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [{ roster_id: 1, players: mine }, { roster_id: 2, players: theirs }], currentWeek: 4, playerPreferences });
  assert.ok(proposals.length > 0);
  assert.ok(proposals.every(proposal => !proposal.give.some(player => player.name === "MRB3")));
});
