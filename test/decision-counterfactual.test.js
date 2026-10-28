import test from "node:test";
import assert from "node:assert/strict";
import { COUNTERFACTUAL_BASIS, counterfactualType, currentCounterfactuals, cutEntry, declinedCuts, describeCounterfactual, evaluateDeclinedCut, evaluateSkippedRecommendation, evaluateTradeOption, formatCounterfactualLine, formatPoints, planChoiceRows, skippedEntry, skippedTradeOptions, summarizeCounterfactuals, tradeEntry, tradeOptionRecord } from "../public/assets/decision-log.js";
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
  assert.deepEqual(summarizeCounterfactuals([row, other]), { skipped: 2, evaluated: 1, lineupGain: 7, notScorable: 1, pending: 0, byType: { ADD: 1, CUT: 0, TRADE: 0 } });
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

test("a planned cut the team kept is scored only when the plan's add was placed with another drop", () => {
  const recs = { 5: [{ playerId: "x", name: "Xavier", action: "CLAIM_IF_CHEAP", cutPlayerId: "s2", cutName: "Sam", source: "WEEKLY_JOB" }] };
  const claimed = [{ kind: "CLAIM_WON", week: 5, added: [{ id: "x" }], dropped: [{ id: "b9", name: "Ben", position: "WR" }] }];
  assert.deepEqual(declinedCuts([], recs), [], "add not placed: its own counterfactual already removes the cut");
  assert.deepEqual(declinedCuts([...claimed, { kind: "DROP", week: 5, added: [], dropped: [{ id: "s2" }] }], recs), [], "cut done in another move");
  const [row] = declinedCuts(claimed, recs);
  assert.deepEqual([row.playerId, row.addPlayerId, row.keptInstead.map(p => p.id)], ["s2", "x", ["b9"]]);
  // Following the plan: Sam (s2) out, Ben (b9) kept. Top-two lineup.
  const weeks = { 5: { playerIds: ["s1", "s2", "x"], playersPoints: { s1: 12, s2: 10, x: 3 } }, 6: { playerIds: ["s1", "x"], playersPoints: { s1: 9, x: 8 } } };
  const cutOptions = { rosterOf: week => weeks[week] ?? null, pointsOf: (id, week) => ({ "b9|5": 14 })[`${id}|${week}`] ?? 0, optimalOf: topTwo, lastCompletedWeek: 6 };
  const outcome = evaluateDeclinedCut(row, cutOptions);
  assert.deepEqual(outcome.weekly.map(item => [item.week, item.gain, item.onRoster]), [[5, 4, true], [6, 0, false]], "Ben 14 replaces Sam 10; Sam already gone in S6");
  assert.deepEqual([outcome.status, outcome.lineupGain, outcome.playerPoints, outcome.keptPoints, outcome.assumptions], ["PARTIAL", 4, 10, 14, []]);
  const stored = cutEntry(row, outcome, { season: 2026, rosterId: 1 });
  assert.equal(stored.id, "2026:1:skipped-cut:5:s2");
  assert.equal(counterfactualType(stored), "CUT");
  assert.equal(describeCounterfactual(outcome, "CUT"), "S5–S6 : +4 pts en lineup optimale (10 pts du joueur gardé, 14 pts des joueurs coupés à sa place) · partiel");
  const noDrop = evaluateDeclinedCut({ ...row, keptInstead: [] }, { ...cutOptions, lastCompletedWeek: 5 });
  assert.deepEqual([noDrop.lineupGain, noDrop.assumptions], [-7, ["FREED_SPOT_UNVALUED"]], "a freed spot is never valued");
  assert.equal(evaluateDeclinedCut(row, { ...cutOptions, pointsOf: () => null }).reason, "STATS_UNAVAILABLE");
});

test("the Coach trade option is recorded per plan, scored for the followed team only, and old plans stay not scorable", () => {
  assert.equal(tradeOptionRecord(null).status, "NONE");
  assert.equal(tradeOptionRecord({ title: "T", give: [{ name: "No id" }], receive: [{ sleeperId: "r1" }] }).status, "UNIDENTIFIED");
  const option = tradeOptionRecord({ partnerRosterId: 4, partnerName: "Kuro (Mat)", title: "Upgrade", give: [{ sleeperId: "s2", name: "Sam", position: "WR" }], receive: [{ sleeperId: "r1", name: "Rob", position: "WR" }] }, "2026-10-27T09:30:00Z");
  assert.deepEqual([option.status, option.give[0].id, option.receive[0].id], ["PROPOSED", "s2", "r1"]);
  const rows = skippedTradeOptions([], { 5: option, 6: { status: "NONE" }, 4: null });
  assert.deepEqual(rows.map(row => row.week), [4, 5], "NONE adds nothing; a plan before the recording stays");
  assert.deepEqual(skippedTradeOptions([{ kind: "TRADE", week: 6, added: [{ id: "r1" }] }], { 5: option }), [], "trade done within the window");
  const old = evaluateTradeOption(rows[0], { lastCompletedWeek: 7 });
  assert.deepEqual([old.status, old.reason], ["NOT_SCORABLE", "TRADE_OPTION_NOT_RECORDED"]);
  const outcome = evaluateTradeOption(rows[1], { rosterOf: week => rosters[week] ?? null, pointsOf: () => 15, optimalOf: topTwo, lastCompletedWeek: 5 });
  assert.deepEqual([outcome.lineupGain, outcome.playerPoints, outcome.assumptions], [5, 15, ["PARTNER_ACCEPTANCE_ASSUMED"]], "Rob 15 replaces Sam (s2) 10");
  assert.match(describeCounterfactual(outcome, "TRADE"), /acceptation du partenaire supposée/);
  const stored = tradeEntry(rows[1], outcome, { season: 2026, rosterId: 1 });
  assert.equal(stored.id, "2026:1:skipped-trade:5");
  assert.equal(formatCounterfactualLine([stored]), "Recos non suivies (estimation Adineu, lineup optimale a posteriori) : trade Sam contre Rob S5 +5 pts — total +5 pts sur 1.");
});

test("points below 2 are singular in every counterfactual text", () => {
  assert.deepEqual([formatPoints(0), formatPoints(1), formatPoints(1.5), formatPoints(2), formatPoints(20.18)], ["0 pt", "1 pt", "1,5 pt", "2 pts", "20,18 pts"]);
  const row = skippedEntry(skipped, { ...evaluateSkippedRecommendation(skipped, options), lineupGain: 1 }, { season: 2026, rosterId: 1 });
  assert.match(formatCounterfactualLine([row]), /Xavier S5 \+1 pt — total \+1 pt sur 1\.$/);
  assert.equal(describeCounterfactual({ status: "COMPLETE", fromWeek: 5, throughWeek: 8, lineupGain: 0, weeksInLineup: 0, playerPoints: 1, cutModeled: true }),
    "S5–S8 : 0 pt en lineup optimale (0 sem. titulaire, 1 pt marqué)");
});

test("assembleDecisionLog adds trade options next to skipped adds", () => {
  const schedule = [{ week: 2, kickoffAt: "2026-09-22T00:15:00Z" }];
  const players = { q: { name: "Quinn", position: "QB" }, r: { name: "Rex", position: "RB" }, w: { name: "Will", position: "WR" }, z: { name: "Zed", position: "WR" } };
  const result = assembleDecisionLog({ transactions: [], schedule, rosterId: 1, season: "2026", lastCompletedWeek: 2, playerOf: id => players[id] ?? null,
    scoring: { rec_yd: 0.1 }, statsByWeek: { 2: { z: { rec_yd: 120 } } },
    matchupsByWeek: { 2: [{ roster_id: 1, points: 20, players: ["q", "r", "w"], players_points: { q: 15, r: 5, w: 2 } }] },
    recommendationsByWeek: {}, tradeOptionsByWeek: { 2: { status: "PROPOSED", partnerRosterId: 3, partnerName: "P", title: "T", give: [{ id: "w", name: "Will" }], receive: [{ id: "z", name: "Zed" }] }, 1: null } });
  const byId = Object.fromEntries(result.counterfactuals.map(row => [row.id, row.outcome]));
  assert.equal(byId["2026:1:skipped-trade:1"].reason, "TRADE_OPTION_NOT_RECORDED");
  assert.deepEqual([byId["2026:1:skipped-trade:2"].status, byId["2026:1:skipped-trade:2"].lineupGain], ["PARTIAL", 10], "Zed's 12 league points replace Will's 2 at WR");
});
