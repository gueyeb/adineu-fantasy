import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunitySignals, computeRosPpg, detectEvents, effectivePpg, evaluateMarket, evaluateRosterFit } from "../public/assets/waiver-model.js";

test("computeRosPpg averages future weeks and counts the bye as 0", () => {
  const projectionsByWeek = { 12: { p: { pts_ppr: 10 } }, 13: { p: { pts_ppr: 10 } }, 14: { p: { pts_ppr: 10 } } };
  // Unknown team = no bye in the window.
  assert.equal(computeRosPpg({ playerId: "p", nflTeam: "XXX", projectionsByWeek, week: 12 }), 10);
  assert.equal(computeRosPpg({ playerId: "none", nflTeam: "XXX", projectionsByWeek, week: 12 }), null);
  // One lone 20-pt week out of three loaded weeks is not a 20-pt season -> rank fallback.
  const sparse = { 12: { lone: { pts_ppr: 20 } }, 13: {}, 14: {} };
  assert.equal(computeRosPpg({ playerId: "lone", nflTeam: "XXX", projectionsByWeek: sparse, week: 12 }), null);
  // A week that failed to load (missing key) never shrinks the horizon of one player only.
  const failed = { 12: { p: { pts_ppr: 10 } }, 14: { p: { pts_ppr: 10 } } };
  assert.equal(computeRosPpg({ playerId: "p", nflTeam: "XXX", projectionsByWeek: failed, week: 12 }), 10);
});

test("market ranking gives a small transparent bonus to a buy-low usage signal", () => {
  const base = { position: "WR", effectivePpg: 10, usageSignal: null };
  const [buyLow, neutral] = evaluateMarket({ rows: [base, { ...base, usageSignal: "BUY_LOW" }], week: 4 });
  assert.equal(buyLow.usageSignal, "BUY_LOW");
  assert.equal(buyLow.marketScore - neutral.marketScore, 5);
});

test("a first recorded game is never a snap surge (no baseline)", () => {
  const signals = { last: { week: 1, snapShare: 0.9, opportunities: 5 }, prevSnapShare: null, prevOpportunities: null };
  assert.equal(detectEvents({ player: { id: "r", position: "WR" }, signals }).newsOverride, false);
});

test("committee: two close backups share an injured starter's role; a deep third gets nothing", () => {
  const starter = { id: "s", name: "Starter", position: "RB", injuryStatus: "IR", injuryBodyPart: "Knee - ACL", searchRank: 10 };
  const a = { id: "a", position: "RB", searchRank: 100 };
  const b = { id: "b", position: "RB", searchRank: 120 };
  const deep = { id: "d", position: "RB", searchRank: 400 };
  const teammates = [starter, a, b, deep];
  const eventA = detectEvents({ player: a, teammates, signals: {} });
  assert.equal(eventA.share, 0.5);
  assert.match(eventA.reasons[0], /rôle partagé/);
  assert.equal(detectEvents({ player: deep, teammates, signals: {} }).newsOverride, false);
});

test("buildOpportunitySignals reads snaps/opportunities from Sleeper stats, not league matchups (free agents included)", () => {
  const signals = buildOpportunitySignals("p", [
    { week: 2, stats: { p: { off_snp: 20, tm_off_snp: 70, rush_att: 3, rec_tgt: 1, pts_ppr: 3 } } },
    { week: 3, stats: { p: { off_snp: 60, tm_off_snp: 70, rush_att: 15, rec_tgt: 4, rush_rz_att: 2, pts_ppr: 15 } } }
  ]);
  assert.equal(signals.gamesPlayed, 2);
  assert.equal(signals.last.opportunities, 19);
  assert.equal(signals.last.redZone, 2);
  assert.equal(signals.recentPpg, 9);
});

test("detectEvents: an Out starter ahead is a short promotion; a season-ending IR is season-long", () => {
  const player = { id: "b", position: "RB", searchRank: 150 };
  const out = detectEvents({ player, teammates: [{ id: "s", name: "Starter", position: "RB", injuryStatus: "Out", injuryBodyPart: "Thigh", searchRank: 27 }], signals: {} });
  assert.deepEqual([out.flags, out.duration], [["PROMOTION"], "RENTAL_1W"]);
  const acl = detectEvents({ player, teammates: [{ id: "s", name: "Starter", position: "RB", injuryStatus: "IR", injuryBodyPart: "Knee - ACL", searchRank: 8 }], signals: {} });
  assert.equal(acl.duration, "SEASON_LONG");
  assert.ok(acl.newsOverride);
  const behind = detectEvents({ player, teammates: [{ id: "s", position: "RB", injuryStatus: "IR", searchRank: 400 }], signals: {} });
  assert.equal(behind.newsOverride, false, "an injured player BEHIND him changes nothing");
});

test("detectEvents: QB carries+targets never count as a usage surge", () => {
  const signals = { last: { week: 3, snapShare: 0.5, opportunities: 12 }, prevSnapShare: 0.5, prevOpportunities: 4 };
  assert.equal(detectEvents({ player: { id: "q", position: "QB" }, signals }).flags.length, 0);
  assert.deepEqual(detectEvents({ player: { id: "w", position: "WR" }, signals }).flags, ["USAGE_SURGE"]);
});

test("effectivePpg trusts a promotion more than an unexplained one-game spike", () => {
  const args = { rosPpg: 6, weekProjection: 6, recentPpg: 8, lastRolePoints: 16, week: 4 };
  assert.equal(effectivePpg({ ...args, duration: null }).effective, 6);
  assert.equal(effectivePpg({ ...args, duration: "SEASON_LONG" }).effective, 13.5);
  assert.equal(effectivePpg({ ...args, duration: "BREAKOUT" }).effective, 11);
  assert.ok(effectivePpg({ ...args, duration: "RENTAL_1W" }).effective < 8);
  assert.ok(effectivePpg({ ...args, duration: "SEASON_LONG", share: 0.5 }).effective < 13.5, "a committee shares the role");
});

test("market vs fit: a strong market add can be worth 0 $ to a roster where he never starts (Sadiq/McBride case)", () => {
  const fa = (id, position, effectivePpg) => ({ sleeperId: id, name: id, position, effectivePpg });
  const rows = [fa("TE breakout", "TE", 13), ...["a", "b", "c", "d", "e", "f"].map((id, i) => fa(id, "TE", 7 - i * 0.2))];
  const market = evaluateMarket({ rows, week: 4 });
  const te = market.find(row => row.sleeperId === "TE breakout");
  const capped = evaluateMarket({ rows: [fa("Mega", "WR", 60), ...["a", "b", "c", "d", "e", "f"].map(id => fa(id, "WR", 5))], week: 4 })[0];
  assert.ok(capped.faabMarket[1] <= 1000 && capped.faabPct[1] <= 100, "never above the league budget");
  assert.ok(te.faabMarket[1] > 0 && te.marketScore > 50);
  const core = [["QB", 20], ["RB", 15], ["RB", 14], ["WR", 16], ["WR", 15], ["WR", 14], ["K", 8], ["DEF", 7]].map(([position, pace], i) => ({ sleeperId: `m${i}`, name: `m${i}`, position, pace }));
  const withElite = [...core, { sleeperId: "elite", name: "Elite TE", position: "TE", pace: 17 }];
  const paceOf = player => player.pace ?? player.effectivePpg;
  assert.equal(evaluateRosterFit({ marketRow: te, myPlayers: withElite, paceOf, week: 4, faabRemaining: 900 }).faabMaxForMe, 0);
  const withWeak = [...core, { sleeperId: "weak", name: "Weak TE", position: "TE", pace: 6 }];
  const fit = evaluateRosterFit({ marketRow: te, myPlayers: withWeak, paceOf, week: 4, faabRemaining: 50 });
  assert.equal(fit.slot, "TE");
  assert.ok(fit.fitScore > 50);
  assert.ok(fit.faabMaxForMe <= 50, "capped by remaining FAAB");
});

test("roster fit prices the likely bench cut and reports net gain instead of treating the roster spot as free", () => {
  const candidate = { sleeperId: "new", name: "New WR", position: "WR", effectivePpg: 12, surplusPoints: 50, faabMarket: [30, 50] };
  const starters = [
    ["QB", 20], ["RB", 15], ["RB", 14], ["WR", 16], ["WR", 13], ["TE", 10], ["WR", 11], ["K", 8], ["DEF", 7]
  ].map(([position, pace], index) => ({ sleeperId: `s${index}`, name: `s${index}`, position, pace }));
  const bench = [
    { sleeperId: "valuable", name: "Valuable bench RB", position: "RB", pace: 10 },
    { sleeperId: "cut", name: "Likely cut WR", position: "WR", pace: 8 }
  ];
  const paceOf = player => player.pace ?? player.effectivePpg;
  const fit = evaluateRosterFit({
    marketRow: candidate,
    myPlayers: [...starters, ...bench],
    paceOf,
    week: 4,
    faabRemaining: 100,
    protectedIds: new Set(starters.map(player => player.sleeperId)),
    replacementByPosition: { QB: 15, RB: 7, WR: 7, TE: 7, K: 7, DEF: 6 }
  });

  assert.equal(fit.dropCandidate.sleeperId, "cut");
  assert.equal(fit.dropCostPerWeek, 1);
  assert.equal(fit.gainPerWeek, 1);
  assert.equal(fit.netGainPerWeek, 0);
  assert.equal(fit.faabMaxForMe, 0);
});

test("a backup with a stale deep rank but ≥ 50 % of the snaps still inherits the role (Gordon case)", () => {
  const starter = { id: "s", name: "Starter", position: "RB", injuryStatus: "IR", injuryBodyPart: "Knee - ACL", searchRank: 8 };
  const rival = { id: "r", position: "RB", searchRank: 150 };
  const gordon = { id: "g", position: "RB", searchRank: 466 };
  const signals = { last: { week: 3, snapShare: 0.84, opportunities: 20 }, prevSnapShare: 0.15, prevOpportunities: 2 };
  const event = detectEvents({ player: gordon, teammates: [starter, rival, gordon], signals });
  assert.ok(event.flags.includes("PROMOTION"));
  assert.equal(event.duration, "SEASON_LONG");
  assert.equal(event.share, 1);
});
