import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachPlan, formatCoachPlan, normalizeCoachPreferences } from "../scripts/coach-assistant.js";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("coach plan combines lineup, waiver and trade actions for one week", () => {
  const plan = buildCoachPlan({
    decisionContext: {
      week: 2, dataThroughWeek: 1,
      league: { teams: 12 },
      myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", record: { wins: 1, losses: 0, ties: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } },
      strategyState: { playoffUrgency: "LOW", faabPosture: "MODERATE", benchFlexibility: "LOW" },
      lineup: { alerts: [{ slot: "RB", reason: "Out" }], optimal: { gain: 3.2, changes: [{ slot: "RB", in: { name: "Bench RB" }, out: { name: "Injured RB" }, gain: 3.2 }] } },
      waiverActions: { ADD_NOW: [{ sleeperId: "fa", name: "Runner", position: "RB", decisionClass: "STARTER_UPGRADE", recommendedAction: "ADD_NOW", netGain: 2, maxForTeam: 105, dropCandidate: { name: "Bench WR" }, interpretation: "Upgrade" }], CLAIM_IF_CHEAP: [], WATCH: [] },
      teamDiagnosis: { dropCandidates: [{ name: "Bench WR", totalCostPerWeek: 0.4 }] },
      modelCoverage: { degraded: false }
    },
    trades: { results: [{ proposals: [{ partnerName: "Rival", title: "Upgrade RB" }] }] }
  });
  assert.equal(plan.week, 2);
  assert.deepEqual(plan.priorities.map(item => item.type), ["LINEUP", "WAIVERS", "TRADE"]);
  assert.match(formatCoachPlan(plan), /gain net 2 pt\/sem · coupe Bench WR · max 105 \$/);
  assert.match(formatCoachPlan(plan), /Bench RB à la place de Injured RB/);
});

test("coach preferences accept only known statuses and bounded player keys", () => {
  assert.deepEqual(normalizeCoachPreferences({ p1: "KEEP", p2: "DELETE", ["x".repeat(81)]: "SHOP" }), { p1: "KEEP" });
});

test("coach API is hidden without its private bearer token", async t => {
  const server = createAppServer({ coachToken: "private-test-token" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/coach?team=t0z`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("coach API serves the private n8n workflow with the correct token", async t => {
  const server = createAppServer({
    coachToken: "private-test-token",
    getContext: async () => ({
      week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
      myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } }
    }),
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async options => ({ lastCompletedWeek: 1, byPosition: {}, receivedTeam: options.team }),
    getMatchupContext: async () => null,
    analyze: async () => ({ results: [{ proposals: [] }] })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/coach?team=t0z`, {
    headers: { authorization: "Bearer private-test-token" }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.week, 2);
  assert.equal(body.teamState.faab.remaining, 497);
});
