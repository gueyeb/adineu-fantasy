import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessScenarioConsistency, describeScenarioConsistency, scoreTradeRecommendation, tradeReturnScenarios } from "../public/assets/trade-score.js";
import { applyScenarioCheck, findCounterOffers, findTradeProposals } from "../public/assets/trade-recommender.js";

// Excerpt of the 28/10/2026 S8 capture (three public rosters, their weekly Sleeper projections).
const fixture = JSON.parse(readFileSync(new URL("./fixtures/trade-validation-2026-10-28.json", import.meta.url), "utf8"));
const roster = name => fixture.rosters.find(row => row.name === name);
const named = (team, ...names) => names.map(name => roster(team).players.find(player => player.name === name));
const boukki = roster("Boukki"), sayan = roster("Super Sayan warriors"), estocade = roster("Estocade ⚔️😤💪🏾");
const scenario = (myTotal, theirTotal, id = "HEALTHY") => ({ id, myTotal, theirTotal });

test("consistency: agreeing readings, contradicted average gain, flipping return verdict, no scenarios", () => {
  assert.equal(assessScenarioConsistency({ myDelta: 1.8, theirDelta: 0.9, scenarios: [scenario(8.4, 4.5)] }).status, "CONSISTENT");
  const contradicted = assessScenarioConsistency({ myDelta: 2, theirDelta: 1.8, scenarios: [scenario(-15.9, 36.1)] });
  assert.equal(contradicted.status, "WEEKLY_CONTRADICTS_AVERAGE");
  assert.deepEqual(contradicted.reasons, ["MY_AVERAGE_CONTRADICTED_BY_WEEKLY"]);
  // A zero weekly total does not confirm a positive average either.
  assert.equal(assessScenarioConsistency({ myDelta: 0.5, theirDelta: 0.5, scenarios: [scenario(0, 1)] }).status, "WEEKLY_CONTRADICTS_AVERAGE");
  assert.equal(assessScenarioConsistency({ myDelta: -1, theirDelta: 1, scenarios: [scenario(3, 1)] }).reasons[0], "MY_AVERAGE_CONTRADICTED_BY_WEEKLY");
  // Lamar Jackson (Out) for Drake Maye, 28/10: -21.2 / -11 / +19.3 depending on the return week.
  const flips = assessScenarioConsistency({ myDelta: 2.1, theirDelta: 0, scenarios: [scenario(-21.2, 0.8, "IMMEDIATE"), scenario(-11, -1.1, "PROGRESSIVE"), scenario(19.3, -2.4, "LONG")] });
  assert.equal(flips.status, "INJURY_SENSITIVE");
  assert.deepEqual(flips.reasons, ["MY_VERDICT_DEPENDS_ON_RETURN", "THEIR_VERDICT_DEPENDS_ON_RETURN"]);
  assert.match(describeScenarioConsistency(flips)[0], /hypothèse de retour \(-21\.2 à 19\.3 pts\)/);
  const none = assessScenarioConsistency({ myDelta: 2, theirDelta: 1, scenarios: [] });
  assert.equal(none.status, "UNAVAILABLE");
  assert.deepEqual(describeScenarioConsistency(none), []);
});

test("real case 28/10: Puka Nacua for Tuten + McMillan — the bench-covered bye removes the contradiction; the check still catches one", () => {
  const args = { myPlayers: boukki.players, theirPlayers: sayan.players, give: named("Boukki", "Puka Nacua"), receive: named("Super Sayan warriors", "Bhayshul Tuten", "Tetairoa McMillan"), week: fixture.week };
  const average = scoreTradeRecommendation({ ...args, myRoster: boukki, theirRoster: sayan });
  const weekly = tradeReturnScenarios({ ...args, projectionsByWeek: fixture.projectionsByWeek });
  assert.ok(weekly.scenarios[0].myTotal < 0);
  // Puka's S11 bye used to sit as 0 in his starting slot (+2.0 pts/sem); the bench now covers it and
  // the average gain all but disappears. What is left (ROS rates vs weekly projections) stays checked.
  assert.ok(average.my_lineup_delta < 0.5, `average ${average.my_lineup_delta}`);
  // The 28/10 reading before alignment (+2.0) is still caught by the week-by-week check.
  const proposal = { partnerName: sayan.name, give: args.give, receive: args.receive, recommendationScore: { ...average, my_lineup_delta: 2 }, selection: { group: "NEGOTIATE", reasons: [] } };
  const checked = applyScenarioCheck(proposal, { myPlayers: boukki.players, theirPlayers: sayan.players, currentWeek: fixture.week, projectionsByWeek: fixture.projectionsByWeek });
  assert.equal(checked.selection.group, "EXPLORATION");
  assert.equal(checked.scenarioCheck.status, "WEEKLY_CONTRADICTS_AVERAGE");
  assert.match(checked.selection.reasons.at(-1), /simulation semaine par semaine -\d+(\.\d)? pts : gain non confirmé/);
  // Values and scores are never rewritten by the check.
  assert.equal(checked.recommendationScore, proposal.recommendationScore);
  // Without weekly projections only the week frame is added.
  const { weekFrame, ...unchanged } = applyScenarioCheck(proposal, { myPlayers: boukki.players, theirPlayers: sayan.players, currentWeek: fixture.week, projectionsByWeek: {} });
  assert.deepEqual(unchanged, proposal);
  assert.equal(weekFrame.status, "UNVERIFIED");
  assert.equal(applyScenarioCheck({ ...proposal, selection: { group: "EXPLORATION", reasons: ["x"] } }, { currentWeek: fixture.week, projectionsByWeek: fixture.projectionsByWeek }).scenarioCheck, undefined);
});

test("real case 28/10: Pitts + Stevenson for Luther Burden stays negotiable when both readings agree", () => {
  const rosters = [boukki, sayan, estocade];
  const all = findTradeProposals({ targetRosterId: estocade.roster_id, rosters, currentWeek: fixture.week, view: "ALL", limit: null, projectionsByWeek: fixture.projectionsByWeek });
  const pitts = all.find(proposal => proposal.give.map(player => player.name).sort().join("+") === "Kyle Pitts Sr.+Rhamondre Stevenson" && proposal.receive[0].name === "Luther Burden III");
  assert.ok(pitts);
  assert.equal(pitts.scenarioCheck.status, "CONSISTENT");
  assert.equal(pitts.selection.group, "NEGOTIATE");
  // Every surfaced offer was checked week by week, and none keeps a contradicted gain.
  for (const proposal of all.filter(row => row.selection.group !== "EXPLORATION")) assert.ok(["CONSISTENT", "INJURY_SENSITIVE"].includes(proposal.scenarioCheck?.status));
  const puka = findTradeProposals({ targetRosterId: boukki.roster_id, rosters, currentWeek: fixture.week, view: "ALL", limit: null, projectionsByWeek: fixture.projectionsByWeek })
    .find(proposal => proposal.give.map(player => player.name).join() === "Puka Nacua" && proposal.receive.map(player => player.name).sort().join("+") === "Bhayshul Tuten+Tetairoa McMillan");
  // Once the bye is covered the residual average gain no longer survives selection.
  assert.ok(puka === undefined || puka.selection.group === "EXPLORATION");
});

test("counter-offers apply the same week-by-week check", () => {
  const [puka] = named("Boukki", "Puka Nacua");
  const proposal = { partnerRosterId: sayan.roster_id, partnerName: sayan.name, give: [puka], receive: named("Super Sayan warriors", "Bhayshul Tuten", "Tetairoa McMillan") };
  const offers = findCounterOffers({ proposal, myPlayers: boukki.players, theirPlayers: sayan.players, currentWeek: fixture.week, myRoster: boukki, theirRoster: sayan, projectionsByWeek: fixture.projectionsByWeek });
  for (const offer of offers) assert.notEqual(offer.scenarioCheck?.status, "WEEKLY_CONTRADICTS_AVERAGE");
});

test("offer text prints the contradiction next to the season average", async () => {
  const { formatTradeOffer } = await import("../scripts/analyze-trades.js");
  const give = named("Boukki", "Puka Nacua"), receive = named("Super Sayan warriors", "Bhayshul Tuten", "Tetairoa McMillan");
  const args = { myPlayers: boukki.players, theirPlayers: sayan.players, give, receive, week: fixture.week };
  const average = scoreTradeRecommendation(args);
  const scenarios = tradeReturnScenarios({ ...args, projectionsByWeek: fixture.projectionsByWeek });
  // The 28/10 reading before the bench covered byes (+2.0): the text must still flag it.
  const consistency = assessScenarioConsistency({ myDelta: 2, theirDelta: average.their_lineup_delta, scenarios: scenarios.scenarios });
  const brief = player => ({ name: player.name, injuryStatus: player.injuryStatus || null });
  const text = formatTradeOffer({ week: fixture.week, mine: { team: boukki.name, gives: give.map(brief) }, theirs: { team: sayan.name, gives: receive.map(brief) },
    seasonAverage: { myDeltaPerWeek: 2, theirDeltaPerWeek: average.their_lineup_delta, notes: [] }, market: { give: 1, receive: 1 }, scenarios,
    consistency: { ...consistency, messages: describeScenarioConsistency(consistency, { mine: boukki.name, theirs: sayan.name }) } });
  assert.match(text, /⚠ Moyenne \+\d+(\.\d)? pts\/sem pour Boukki, mais simulation semaine par semaine -\d+(\.\d)? pts : gain non confirmé\./);
});
