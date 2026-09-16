import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("web coach session serves only Boukki and logout revokes access without breaking bearer auth", async t => {
  const requestedTeams = [];
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    getContext: async ({ team }) => {
      requestedTeams.push(team);
      return { week: 2, myTeam: { teamName: "Boukki", owner: "t0z", starters: [], bench: [] } };
    },
    getInjuryStatuses: async () => new Map(),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    analyze: async () => ({ results: [{ proposals: [] }] })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/coach-session`, { method: "POST", headers: { origin: base }, body: JSON.stringify({ password: "test-only" }) });
  const cookie = login.headers.get("set-cookie");
  const coach = await fetch(`${base}/api/coach?team=another`, { headers: { cookie } });
  assert.equal(coach.status, 200);
  assert.equal((await coach.json()).owner, "t0z");
  assert.deepEqual(requestedTeams, ["t0z"]);
  await fetch(`${base}/api/coach-session?logout=1`, { method: "POST", headers: { origin: base, cookie } });
  assert.equal((await fetch(`${base}/api/coach`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/coach`, { headers: { authorization: "Bearer test-api" } })).status, 200);
});
