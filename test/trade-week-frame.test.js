import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatTradeWeekFrame, hasNoNflTeam, tradeWeekFrame } from "../public/assets/trade-timing.js";
import { buildProjectedLineup, restOfSeasonEstimate, restOfSeasonLineup, restOfSeasonLineupTotal, scoreTradeRecommendation, tradeReturnScenarios, weeklyEstimate } from "../public/assets/trade-score.js";
import { targetWeekTradeImpact } from "../public/assets/trade-target.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/trade-validation-2026-10-28.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-28T12:00:00Z");
// Review 1 day: ends 29/10 12:00 UTC. BUF plays Thursday 29/10 00:15 UTC (before), KC Sunday 01/11 (after).
const game = (week, home, away, kickoffAt) => ({ season: 2026, week, home_team: home, away_team: away, kickoffAt });
const games = [
  game(8, "BUF", "MIA", "2026-10-29T00:15:00Z"), game(9, "BUF", "NE", "2026-11-05T18:00:00Z"),
  game(8, "KC", "DEN", "2026-11-01T17:00:00Z"), game(9, "KC", "LV", "2026-11-08T18:00:00Z"),
  game(9, "SF", "SEA", "2026-11-08T21:00:00Z"), game(10, "SF", "LAR", "2026-11-15T21:00:00Z")
];
const context = (extra = {}) => ({ asOf: new Date(NOW - 60_000).toISOString(), season: 2026, reviewDays: 1, deadlineWeek: 12, disabled: false, dataThroughWeek: 7, games, ...extra });
const p = (id, position, nflTeam, extra = {}) => ({ sleeperId: id, name: id, position, nflTeam, ...extra });

test("week frame: data through, live, target and first affectable week stay four separate weeks", () => {
  const thursday = p("buf-wr", "WR", "BUF"), sunday = p("kc-wr", "WR", "KC"), bye = p("sf-wr", "WR", "SF");
  const frame = tradeWeekFrame({ players: [thursday, sunday, bye], currentWeek: 8, targetWeek: 10, context: context(), now: NOW });
  assert.equal(frame.status, "CONDITIONAL");
  assert.deepEqual([frame.dataThroughWeek, frame.liveWeek, frame.targetWeek, frame.firstAffectableWeek], [7, 8, 10, 8]);
  const row = id => frame.players.find(entry => entry.playerId === id);
  // His S8 game kicks off before the review ends: he still plays S8 for his old team.
  assert.deepEqual([row("buf-wr").firstAffectableWeek, row("buf-wr").reason], [9, "LIVE_WEEK_GAME_BEFORE_REVIEW_END"]);
  assert.deepEqual([row("kc-wr").firstAffectableWeek, row("kc-wr").reason], [8, null]);
  assert.deepEqual([row("sf-wr").firstAffectableWeek, row("sf-wr").reason], [9, "BYE_THIS_WEEK"]);
  assert.equal(frame.earliestReviewEndAt, "2026-10-29T12:00:00.000Z");
  // A review ending exactly at kickoff does not leave time to play that game for the new team.
  const atKickoff = tradeWeekFrame({ players: [sunday], currentWeek: 8, context: context({ reviewDays: 0, asOf: "2026-11-01T16:59:00Z" }), now: Date.parse("2026-11-01T17:00:00Z") });
  assert.equal(atKickoff.players[0].firstAffectableWeek, 9);
  const text = formatTradeWeekFrame(frame);
  assert.match(text, /Données jusqu’à S7 · semaine live S8 · cible S10 · première semaine affectable S8/);
  assert.match(text, /Reste à l’ancienne équipe avant : buf-wr S9, sf-wr S9/);
  assert.match(text, /Exécution non confirmée\.$/);
});

test("week frame: stale, missing, closed and incomplete evidence never invent an affectable week", () => {
  const player = p("kc-wr", "WR", "KC");
  const stale = tradeWeekFrame({ players: [player], currentWeek: 8, context: context({ asOf: new Date(NOW - 6 * 60_000).toISOString() }), now: NOW });
  assert.deepEqual([stale.status, stale.reasons, stale.firstAffectableWeek, stale.simulationBasis], ["UNVERIFIED", ["TIMING_EVIDENCE_STALE"], null, "LIVE_WEEK_ASSUMED_TIMING_UNVERIFIED"]);
  assert.equal(stale.dataThroughWeek, 7);
  assert.equal(tradeWeekFrame({ players: [player], currentWeek: 8, now: NOW }).reasons[0], "TIMING_EVIDENCE_MISSING");
  const closed = tradeWeekFrame({ players: [player], currentWeek: 13, context: context(), now: NOW });
  assert.deepEqual([closed.status, closed.reasons, closed.simulationBasis], ["BLOCKED", ["TRADES_CLOSED"], "NO_AFFECTABLE_WEEK"]);
  assert.match(formatTradeWeekFrame(closed), /Nouveaux trades fermés/);
  const missing = tradeWeekFrame({ players: [p("nyj-wr", "WR", "NYJ")], currentWeek: 8, context: context(), now: NOW });
  assert.deepEqual([missing.status, missing.reasons], ["UNVERIFIED", ["TRADE_SCHEDULE_INCOMPLETE"]]);
  assert.match(formatTradeWeekFrame(missing), /la simulation part de la semaine live par hypothèse/);
  assert.equal(formatTradeWeekFrame(null), "Semaines du trade non déterminées.");
});

test("weekly simulation moves each traded player at his own first affectable week", () => {
  const roster = (prefix, extra) => [p(`${prefix}-qb`, "QB", "KC"), p(`${prefix}-rb1`, "RB", "KC"), p(`${prefix}-rb2`, "RB", "KC"), p(`${prefix}-te`, "TE", "KC"), p(`${prefix}-k`, "K", "KC"), p(`${prefix}-def`, "DEF", "KC"), ...extra];
  const thursday = p("buf-wr", "WR", "BUF"), sunday = p("kc-wr", "WR", "KC");
  const mine = roster("m", [thursday, p("m-wr2", "WR", "KC")]);
  const theirs = roster("t", [sunday, p("t-wr2", "WR", "KC")]);
  const projectionsByWeek = {};
  for (let w = 8; w <= 14; w++) {
    projectionsByWeek[w] = Object.fromEntries([...mine, ...theirs].map(player => [player.sleeperId, { pts_ppr: 5 }]));
    projectionsByWeek[w]["buf-wr"] = { pts_ppr: 20 };
    projectionsByWeek[w]["kc-wr"] = { pts_ppr: 10 };
  }
  const args = { myPlayers: mine, theirPlayers: theirs, give: [thursday], receive: [sunday], week: 8, projectionsByWeek };
  const timed = tradeReturnScenarios({ ...args, timingContext: context(), now: NOW });
  assert.equal(timed.weekFrame.firstAffectableWeek, 8);
  const [s8, s9] = timed.scenarios[0].byWeek;
  // S8: Thursday's 20 pts stay with me and the Sunday player (10) already joins me: my WR2 goes 5 → 10
  // and the freed 5 fills my empty FLEX; the partner loses his 10 without receiving anyone yet.
  assert.deepEqual([s8.week, s8.myDelta, s8.theirDelta], [8, 10, -10]);
  // S9 on: the swap is complete (BUF bye S7 already passed).
  assert.deepEqual([s9.week, s9.myDelta, s9.theirDelta], [9, -10, 10]);
  // Without fresh timing the live week is assumed for everyone, and said so.
  const untimed = tradeReturnScenarios(args);
  assert.equal(untimed.scenarios[0].byWeek[0].myDelta, -10);
  assert.equal(untimed.weekFrame.simulationBasis, "LIVE_WEEK_ASSUMED_TIMING_UNVERIFIED");
  assert.match(untimed.evidence.notes[0], /départ supposé à la semaine live/);
  // Trades closed: no week to simulate, no gain shown.
  const closed = tradeReturnScenarios({ ...args, week: 13, timingContext: context(), now: NOW });
  assert.equal(closed.weeks, null);
  assert.equal(closed.scenarios[0].myTotal, 0);
});

test("season average: the bench covers a starter's bye instead of a 0 inside his average", () => {
  // QB1 20 pts per game with a bye ahead (NYJ S13), QB2 12 pts with no bye in the window.
  const qb1 = p("qb1", "QB", "NYJ", { projectedPpg: 20 }), qb2 = p("qb2", "QB", "KC", { projectedPpg: 12 });
  const week = 8, remaining = 7;
  const old = buildProjectedLineup([qb1, qb2], { estimate: restOfSeasonEstimate(week) }).total;
  assert.equal(old, Number((20 * 6 / 7).toFixed(1)));
  const aligned = restOfSeasonLineup([qb1, qb2], week);
  assert.equal(aligned.total, Number(((20 * 6 + 12) / remaining).toFixed(1)));
  assert.deepEqual(aligned.byeWeeks, [13]);
  assert.equal(aligned.basis, "RATE_PER_GAME_BYE_COVERED_BY_BENCH");
  assert.equal(aligned.slots.find(slot => slot.slot === "QB").projectedPpg, 20);
  // Fast search total = mean of per-week optimal lineups with that week's byes at 0, on real rosters.
  for (const roster of fixture.rosters) {
    const fast = restOfSeasonLineupTotal(roster.players, fixture.week);
    const weeks = Array.from({ length: 14 - fixture.week + 1 }, (_, i) => fixture.week + i);
    const reference = weeks.reduce((sum, w) => sum + buildProjectedLineup(roster.players, { estimate: player => BYE_WEEKS_2026[player.nflTeam] === w ? 0 : fast.rate(player) }).total, 0) / weeks.length;
    assert.ok(Math.abs(fast.total - reference) <= 0.05, `${roster.name}: ${fast.total} vs ${reference}`);
  }
  assert.equal(restOfSeasonLineupTotal([qb1, qb2], null).byeWeeks.length, 0);
});

test("a rostered player with no NFL team counts 0 with a stated assumption instead of blocking", () => {
  const unsigned = p("hill", "WR", null, { quality: { expertRank: 40 } });
  assert.equal(hasNoNflTeam(unsigned), true);
  assert.equal(hasNoNflTeam({ name: "no team field" }), false);
  assert.equal(weeklyEstimate(unsigned), 0);
  assert.equal(restOfSeasonEstimate(8)(unsigned), 0);
  const mine = [p("a", "WR", "KC"), unsigned], theirs = [p("b", "WR", "KC")];
  const projectionsByWeek = { 8: { a: { pts_ppr: 10 }, b: { pts_ppr: 12 } } };
  const target = targetWeekTradeImpact({ myPlayers: mine, theirPlayers: theirs, give: [mine[0]], receive: [theirs[0]], targetWeek: 8, currentWeek: 8, projectionsByWeek });
  assert.equal(target.status, "PROJECTED");
  assert.deepEqual(target.assumptions, ["NO_NFL_TEAM_COUNTED_AS_ZERO:hill"]);
  // An unknown team (missing field) still blocks: absence of data is not an unsigned player.
  const unknown = { sleeperId: "x", name: "x", position: "WR" };
  assert.ok(targetWeekTradeImpact({ myPlayers: [mine[0], unknown], theirPlayers: theirs, give: [mine[0]], receive: [theirs[0]], targetWeek: 8, currentWeek: 8, projectionsByWeek }).reasons.includes("TARGET_TEAM_UNVERIFIED:x"));
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: [mine[0]], receive: [theirs[0]], week: 8 });
  assert.ok(!score.warnings.some(warning => warning.startsWith("hill")));
  assert.ok(score.notes.some(note => /hill : sans équipe NFL selon Sleeper, compté 0/.test(note)));
  const weekly = tradeReturnScenarios({ myPlayers: mine, theirPlayers: theirs, give: [mine[0]], receive: [theirs[0]], week: 8, projectionsByWeek });
  assert.deepEqual(weekly.evidence.noNflTeam, [{ name: "hill", assumption: "NO_NFL_TEAM_COUNTED_AS_ZERO" }]);
  assert.ok(!weekly.evidence.projectionGaps.some(gap => gap.startsWith("hill")));
  const frame = tradeWeekFrame({ players: [unsigned, p("kc-wr", "WR", "KC")], currentWeek: 8, context: context(), now: NOW });
  assert.deepEqual([frame.status, frame.reasons, frame.firstAffectableWeek], ["CONDITIONAL", ["NO_NFL_TEAM_COUNTED_AS_ZERO"], 8]);
  assert.match(formatTradeWeekFrame(frame), /Sans équipe NFL, compté 0 : hill/);
});

test("offer text and JSON carry the four weeks", async () => {
  const { formatTradeOffer } = await import("../scripts/analyze-trades.js");
  const boukki = fixture.rosters.find(row => row.name === "Boukki"), estocade = fixture.rosters.find(row => row.name.startsWith("Estocade"));
  const give = boukki.players.filter(player => player.name === "Luther Burden III");
  const receive = estocade.players.filter(player => ["Kyle Pitts Sr.", "Rhamondre Stevenson"].includes(player.name));
  const scenarios = tradeReturnScenarios({ myPlayers: boukki.players, theirPlayers: estocade.players, give, receive, week: fixture.week, projectionsByWeek: fixture.projectionsByWeek });
  const brief = player => ({ name: player.name, injuryStatus: null });
  const text = formatTradeOffer({ week: fixture.week, weekFrame: scenarios.weekFrame, mine: { team: "Boukki", gives: give.map(brief) }, theirs: { team: "Estocade", gives: receive.map(brief) },
    seasonAverage: { myDeltaPerWeek: 1.6, theirDeltaPerWeek: 1.8, notes: [] }, market: { give: 1, receive: 1 }, scenarios, consistency: { messages: [] } });
  assert.match(text, /^Semaines : Données jusqu’à n\/d · semaine live S8 · cible aucune · première semaine affectable n\/d\. Fenêtre non vérifiée/m);
});
