import test from "node:test";
import assert from "node:assert/strict";
import { assessTradeTiming, formatTradeTiming } from "../public/assets/trade-timing.js";
import { targetWeekTradeImpact } from "../public/assets/trade-target.js";
const now = Date.parse("2026-10-25T15:00:00Z");
const player = { sleeperId: "p", name: "Receiver", nflTeam: "DAL", position: "WR" };
const context = { asOf: new Date(now).toISOString(), season: 2026, reviewDays: 1, deadlineWeek: 12, disabled: false,
  games: [{ season: 2026, week: 7, home_team: "DAL", away_team: "PHI", kickoffAt: "2026-10-26T00:00:00Z" },
    { season: 2026, week: 8, home_team: "DAL", away_team: "NYJ", kickoffAt: "2026-11-01T18:00:00Z" }] };
const run = extra => assessTradeTiming({ players: [player], currentWeek: 7, targetWeek: 7, context, now, ...extra });
test("review crossing kickoff blocks target and finds a conditional later candidate", () => {
  const timing = run({});
  assert.equal(timing.status, "BLOCKED");
  assert.equal(timing.earliestPossibleWeek, 8);
  assert.match(formatTradeTiming(timing), /première candidate S8/);
  assert.equal(run({ context: { ...context, reviewDays: 0 } }).status, "CONDITIONAL");
  assert.equal(run({ now: Date.parse(context.games[0].kickoffAt), context: { ...context, asOf: context.games[0].kickoffAt, reviewDays: 0 } }).status, "BLOCKED");
});
test("stale, missing, duplicate and invalid evidence never certifies execution", () => {
  assert.equal(run({ now: now + 300001 }).status, "UNVERIFIED");
  assert.equal(run({ context: null }).status, "UNVERIFIED");
  assert.equal(run({ context: { ...context, reviewDays: null } }).status, "UNVERIFIED");
  assert.equal(run({ context: { ...context, games: [...context.games, context.games[0]] } }).status, "UNVERIFIED");
  assert.equal(run({ context: { ...context, disabled: true } }).status, "BLOCKED");
  assert.equal(run({ currentWeek: 13, targetWeek: 13 }).status, "BLOCKED");
});
test("locked roster comparison suppresses the whole pregame gain even if exchanged assets are later", () => {
  const early = { sleeperId: "e", name: "Early", nflTeam: "CHI", position: "WR" };
  const timingContext = { ...context, reviewDays: 0, games: [...context.games, { season: 2026, week: 7, home_team: "CHI", away_team: "NE", kickoffAt: "2026-10-25T12:00:00Z" }] };
  const args = { myPlayers: [early], theirPlayers: [player], give: [], receive: [player], currentWeek: 7, targetWeek: 7, now, timingContext,
    projectionsByWeek: { 7: { e: { pts_ppr: 10 }, p: { pts_ppr: 20 } } } };
  const result = targetWeekTradeImpact(args);
  assert.equal(result.myDelta, null);
  assert.deepEqual(result.reasons, ["TARGET_LINEUP_WINDOW_PASSED"]);
  assert.equal(result.timing.status, "CONDITIONAL");
  assert.equal(result.lineupTiming.status, "BLOCKED");
});

test("disabled deadline zero does not close trading; missing closure evidence stays unverified", () => {
  assert.notEqual(run({ context: { ...context, deadlineWeek: 0 } }).reasons[0], "TRADES_CLOSED");
  assert.equal(run({ context: { ...context, deadlineWeek: null } }).status, "UNVERIFIED");
  assert.equal(run({ context: { ...context, disabled: null } }).status, "UNVERIFIED");
});
