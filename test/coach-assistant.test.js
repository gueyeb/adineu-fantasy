import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachPlan, formatCoachPlan } from "../scripts/coach-assistant.js";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("coach plan combines lineup, waiver and trade actions for one week", () => {
  const plan = buildCoachPlan({
    context: { week: 2, myTeam: { teamName: "Boukki", owner: "t0z" } },
    lineup: { alerts: [{ slot: "RB", reason: "Out" }] },
    waivers: { lastCompletedWeek: 1, byPosition: { RB: [{ name: "Runner", position: "RB", waiver: { score: 13, category: "PRIORITÉ", faabPct: [8, 15] } }] } },
    trades: { results: [{ proposals: [{ partnerName: "Rival", title: "Upgrade RB" }] }] }
  });
  assert.equal(plan.week, 2);
  assert.deepEqual(plan.priorities.map(item => item.type), ["LINEUP", "WAIVERS", "TRADE"]);
  assert.match(formatCoachPlan(plan), /FAAB 8–15%/);
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
    getContext: async () => ({ week: 2, myTeam: { teamName: "Boukki", owner: "t0z", starters: [], bench: [] } }),
    getInjuryStatuses: async () => new Map(),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    analyze: async () => ({ results: [{ proposals: [] }] })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/coach?team=t0z`, {
    headers: { authorization: "Bearer private-test-token" }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).week, 2);
});
