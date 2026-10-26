import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTradeIntent, targetWeekTradeImpact, tradeIntentStorageKey, compareTargetWeekImpacts } from "../public/assets/trade-target.js";
const p = (name, position, nflTeam = "NYJ", extra = {}) => ({ sleeperId: name, name, position, nflTeam, ...extra });

test("dated intent expires without silently renewing, validates input and isolates rosters", () => {
  assert.deepEqual(normalizeTradeIntent({ preferredPosition: "RB", targetWeek: 8 }, 7), { preferredPosition: "RB", targetWeek: 8, expired: false });
  assert.deepEqual(normalizeTradeIntent({ preferredPosition: "RB", targetWeek: 7 }, 8), { preferredPosition: null, targetWeek: null, expired: true });
  assert.equal(normalizeTradeIntent({ preferredPosition: "K", targetWeek: "8" }, 7).targetWeek, null);
  assert.notEqual(tradeIntentStorageKey({ season: 2026, leagueId: "L", rosterId: 1 }), tradeIntentStorageKey({ season: 2026, leagueId: "L", rosterId: 2 }));
});

test("target-week impact uses published projections, FLEX and bye zero, never ROS fallback", () => {
  const give = p("give", "WR", "NYJ", { rosPpg: 100 });
  const receive = p("receive", "RB");
  const mine = [give, p("wr2", "WR"), p("wr3", "WR"), p("wr4", "WR"), p("rb1", "RB"), p("rb2", "RB")];
  const theirs = [receive, p("trb1", "RB"), p("trb2", "RB"), p("trb3", "RB"), p("twr1", "WR"), p("twr2", "WR")];
  const rates = { give: 15, wr2: 14, wr3: 13, wr4: 12, rb1: 12, rb2: 3, receive: 15, trb1: 14, trb2: 13, trb3: 12, twr1: 12, twr2: 3 };
  const projectionsByWeek = { 8: Object.fromEntries(Object.entries(rates).map(([id, pts_ppr]) => [id, { pts_ppr }])) };
  const args = { myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive], targetWeek: 8, currentWeek: 7, projectionsByWeek };
  assert.deepEqual([targetWeekTradeImpact(args).myDelta, targetWeekTradeImpact(args).theirDelta], [9, 9]);
  assert.equal(targetWeekTradeImpact({ ...args, projectionsByWeek: {} }).myDelta, null);
  delete projectionsByWeek[8].wr3;
  assert.equal(targetWeekTradeImpact(args).myDelta, null, "even bench projection gaps suppress numerical claims");
  const bye = p("bye", "WR", "NYG"); // confirmed W8 bye
  assert.equal(targetWeekTradeImpact({ myPlayers: [bye], theirPlayers: [], give: [], receive: [], targetWeek: 8, currentWeek: 7, projectionsByWeek: { 8: {} } }).myDelta, 0);
});

test("current Out is zero; future return uncertainty and past target suppress estimates", () => {
  const out = p("out", "RB", "NYJ", { injuryStatus: "Out" });
  const args = { myPlayers: [out], theirPlayers: [], give: [], receive: [], currentWeek: 7, projectionsByWeek: { 7: {}, 8: { out: { pts_ppr: 15 } } } };
  assert.equal(targetWeekTradeImpact({ ...args, targetWeek: 7 }).status, "PROJECTED");
  assert.equal(targetWeekTradeImpact({ ...args, targetWeek: 8 }).myDelta, null);
  assert.equal(targetWeekTradeImpact({ ...args, targetWeek: 6 }).status, "UNAVAILABLE");
});


test("target ranking keeps missing impact distinct from zero and negative estimates", () => {
  const impacts = [{ myDelta: null }, { myDelta: -1 }, { myDelta: 3 }, { myDelta: 0 }, { myDelta: 7 }];
  assert.deepEqual(impacts.sort(compareTargetWeekImpacts).map(row => row.myDelta), [7, 3, 0, -1, null]);
});


test("target estimates reject missing ownership and unknown NFL teams", () => {
  const unknown = p("unknown", "RB", null);
  const base = { targetWeek: 8, currentWeek: 7, projectionsByWeek: { 8: { unknown: { pts_ppr: 12 } } } };
  assert.equal(targetWeekTradeImpact({ ...base, myPlayers: [unknown] }).status, "UNAVAILABLE");
  assert.deepEqual(targetWeekTradeImpact({ ...base, give: [unknown] }).reasons, ["TRADE_OWNERSHIP_CONFLICT"]);
});
