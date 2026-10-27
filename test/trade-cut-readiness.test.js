import test from "node:test";
import assert from "node:assert/strict";
import { assessTradeCut } from "../public/assets/trade-cut-readiness.js";
import { scoreTradeRecommendation } from "../public/assets/trade-score.js";
const now = Date.parse("2026-10-25T18:00:00Z");
const player = { sleeperId: "p", name: "Bench", nflTeam: "DAL" };
const context = { asOf: new Date(now).toISOString(), season: 2026, movesDisabled: false, maxSubs: 3,
  games: [{ season: 2026, week: 7, home_team: "DAL", away_team: "PHI", kickoffAt: "2026-10-25T19:00:00Z" }] };
const check = extra => assessTradeCut(player, { week: 7, context, now, ...extra });
test("pregame is a review state, never proof that a cut is executable", () => {
  const result = check({});
  assert.equal(result.status, "PREGAME_REVIEW");
  assert.equal(result.canDropNow, null);
  assert.equal(result.autoSubs, "ASSIGNMENTS_UNVERIFIED");
});
test("kickoff boundary excludes by cautious policy without inventing a universal bench-drop rule", () => {
  const result = check({ context: { ...context, games: context.games.map(game => ({ ...game, kickoffAt: context.asOf })) } });
  assert.equal(result.status, "GAME_STARTED_REVIEW");
  assert.equal(result.excludedByPolicy, true);
  assert.equal(result.canDropNow, null);
});
test("stale/ambiguous evidence stays unknown and disabled moves exclude", () => {
  assert.equal(check({ now: now + 300001 }).status, "UNVERIFIED");
  assert.equal(check({ context: { ...context, games: [...context.games, ...context.games] } }).status, "UNVERIFIED");
  assert.equal(check({ context: { ...context, movesDisabled: true } }).status, "MOVES_DISABLED");
  assert.equal(check({ context: null }).status, "UNVERIFIED");
});
test("cut screening can remove candidates but roster overflow alone never declares the trade blocked", () => {
  const players = Array.from({ length: 16 }, (_, i) => ({ ...player, sleeperId: `p${i}`, name: `Bench${i}`, position: "WR", projectedPpg: 2 + i, expertRank: 40 }));
  const result = scoreTradeRecommendation({ myPlayers: players, myRoster: { reserve: [], starters: [] }, week: 7,
    cutContext: { ...context, movesDisabled: true }, now });
  const side = result.rosterConsequences.mine;
  assert.equal(side.cutsNeeded, 1);
  assert.equal(side.cutCandidates.length, 0);
  assert.ok(side.excludedCutCandidates.length > 0);
  assert.equal(side.capacityEffect, "REDUCE_BEFORE_LINEUP_EDITS");
  assert.equal(side.tradeBlockedByCapacity, false);
});
