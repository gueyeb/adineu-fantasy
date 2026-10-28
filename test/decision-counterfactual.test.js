import test from "node:test";
import assert from "node:assert/strict";
import { COUNTERFACTUAL_BASIS, currentCounterfactuals, describeCounterfactual, evaluateSkippedRecommendation, formatCounterfactualLine, planChoiceRows, skippedEntry, summarizeCounterfactuals } from "../public/assets/decision-log.js";
import { assembleDecisionLog } from "../scripts/decision-log.js";

// Two starting slots: the best two scores of the week.
const topTwo = (ids, points) => ids.map(id => points[id]).filter(Number.isFinite).sort((a, b) => b - a).slice(0, 2).reduce((sum, value) => sum + value, 0);
const rosters = {
  5: { playerIds: ["s1", "s2", "b1"], playersPoints: { s1: 12, s2: 10, b1: 3 } },
  6: { playerIds: ["s1", "s2", "b1"], playersPoints: { s1: 15, s2: 4, b1: 2 } },
  7: { playerIds: ["s1", "s2", "x"], playersPoints: { s1: 9, s2: 8, x: 20 } }
};
const points = { "x|5": 6, "x|6": 11, "x|7": 20 };
const options = { rosterOf: week => rosters[week] ?? null, pointsOf: (id, week) => points[`${id}|${week}`] ?? 0, optimalOf: topTwo, lastCompletedWeek: 7 };
const skipped = { week: 5, playerId: "x", name: "Xavier", position: "WR", action: "CLAIM_IF_CHEAP", suggestedBid: 8, source: "WEEKLY_JOB" };

test("a skipped recommendation is scored by lineup gain in hindsight, bench weeks count 0, later add stops the gain", () => {
  const outcome = evaluateSkippedRecommendation(skipped, options);
  assert.equal(outcome.basis, COUNTERFACTUAL_BASIS);
  assert.deepEqual(outcome.weekly.map(item => [item.week, item.points, item.gain, item.onRoster]), [[5, 6, 0, false], [6, 11, 7, false], [7, 20, 0, true]]);
  assert.deepEqual([outcome.status, outcome.fromWeek, outcome.throughWeek, outcome.playerPoints, outcome.lineupGain, outcome.weeksInLineup], ["PARTIAL", 5, 7, 37, 7, 1]);
  assert.deepEqual(outcome.assumptions, ["CUT_NOT_RECORDED"], "without a recorded cut the gain is an upper bound");
});

test("the plan's cut is removed while still on the roster, which can make the gain negative", () => {
  const outcome = evaluateSkippedRecommendation({ ...skipped, cutPlayerId: "s1" }, { ...options, pointsOf: () => 1, lastCompletedWeek: 6 });
  assert.deepEqual(outcome.weekly.map(item => item.gain), [-9, -13]);
  assert.equal(outcome.cutModeled, true);
  assert.deepEqual(outcome.assumptions, []);
});

test("never guessed: pending, missing position, roster or stats are explicit", () => {
  assert.equal(evaluateSkippedRecommendation({ ...skipped, week: 8 }, options).status, "PENDING");
  assert.deepEqual(evaluateSkippedRecommendation({ ...skipped, position: null }, options), { status: "NOT_SCORABLE", basis: COUNTERFACTUAL_BASIS, reason: "POSITION_UNKNOWN", week: null });
  assert.equal(evaluateSkippedRecommendation({ ...skipped, week: 4 }, options).reason, "ROSTER_WEEK_MISSING");
  const noStats = evaluateSkippedRecommendation(skipped, { ...options, pointsOf: (id, week) => week === 6 ? null : 1 });
  assert.deepEqual([noStats.status, noStats.reason, noStats.week], ["NOT_SCORABLE", "STATS_UNAVAILABLE", 6]);
});

test("a rival who took the player above the suggested bid is flagged, not hidden", () => {
  const outcome = evaluateSkippedRecommendation(skipped, { ...options, takenBy: { rosterId: 4, type: "waiver", bid: 15 } });
  assert.equal(outcome.likelyOutbid, true);
  assert.match(describeCounterfactual(outcome), /^S5–S7 : \+7 pts en lineup optimale \(1 sem\. titulaire, 37 pts marqués\) · partiel, coupe non enregistrée, pris par un rival à 15 \$$/);
  assert.equal(evaluateSkippedRecommendation(skipped, { ...options, takenBy: { rosterId: 4, type: "waiver", bid: 5 } }).likelyOutbid, false);
});

test("stored rows, current filter, plan rows, summary and the Tuesday line", () => {
  const row = skippedEntry(skipped, evaluateSkippedRecommendation(skipped, options), { season: 2026, rosterId: 1 });
  assert.equal(row.id, "2026:1:skipped:5:x");
  const other = skippedEntry({ ...skipped, week: 6, playerId: "y", name: "Yann" }, { status: "NOT_SCORABLE", reason: "STATS_UNAVAILABLE", week: 6 }, { season: 2026, rosterId: 1 });
  assert.deepEqual(currentCounterfactuals([row, other], [{ kind: "FREE_ADD", week: 6, added: [{ id: "y" }] }]).map(item => item.id), [row.id], "added since the last sync");
  const plan = { id: "2026:1:plan:5", week: 5, recommendations: [{ playerId: "x", name: "Xavier", action: "CLAIM_IF_CHEAP" }] };
  assert.equal(planChoiceRows([plan], [], [row])[0].counterfactual.lineupGain, 7);
  assert.equal(planChoiceRows([plan], [{ kind: "CLAIM_LOST", week: 5, added: [{ id: "x" }] }], [row])[0].counterfactual, null, "a lost claim is a real attempt");
  assert.deepEqual(summarizeCounterfactuals([row, other]), { skipped: 2, evaluated: 1, lineupGain: 7, notScorable: 1, pending: 0 });
  assert.equal(formatCounterfactualLine([row, other]), "Recos non suivies (estimation Adineu, lineup optimale a posteriori) : Xavier S5 +7 pts — total +7 pts sur 1.");
  assert.equal(formatCounterfactualLine([other]), null);
});

test("assembleDecisionLog scores skipped plan picks on the team's real matchup rosters with league points", () => {
  const schedule = [{ week: 1, kickoffAt: "2026-09-15T00:15:00Z" }, { week: 2, kickoffAt: "2026-09-22T00:15:00Z" }];
  const players = { q: { name: "Quinn", position: "QB" }, r: { name: "Rex", position: "RB" }, w: { name: "Will", position: "WR" } };
  const result = assembleDecisionLog({ transactions: [], schedule, rosterId: 1, season: "2026", lastCompletedWeek: 2, playerOf: id => players[id] ?? null,
    scoring: { rec_yd: 0.1 }, statsByWeek: { 2: { w: { rec_yd: 90 } } },
    matchupsByWeek: { 2: [{ roster_id: 1, points: 20, starters: ["q", "r"], players: ["q", "r"], players_points: { q: 15, r: 5 } }] },
    recommendationsByWeek: { 2: [{ playerId: "w", name: "Will", action: "ADD_NOW", suggestedBid: 0, source: "WEEKLY_JOB" }] } });
  const [row] = result.counterfactuals;
  assert.equal(row.kind, "SKIPPED_RECOMMENDATION");
  assert.deepEqual([row.outcome.status, row.outcome.lineupGain, row.added[0].position], ["PARTIAL", 9, "WR"], "empty WR slot: his 9 league points enter the lineup");
  assert.equal(result.entries.some(entry => entry.kind === "SKIPPED_RECOMMENDATION"), false, "counterfactuals are not moves");
  const unloaded = assembleDecisionLog({ transactions: [], schedule, rosterId: 1, season: "2026", lastCompletedWeek: 2, playerOf: id => players[id] ?? null, scoring: {}, statsByWeek: {},
    matchupsByWeek: { 2: [{ roster_id: 1, points: 0, players: ["q"], players_points: { q: 0 } }] }, recommendationsByWeek: { 2: [{ playerId: "w", action: "ADD_NOW" }] } });
  assert.equal(unloaded.counterfactuals[0].outcome.reason, "STATS_UNAVAILABLE", "a week whose stats did not load is not zero");
});
