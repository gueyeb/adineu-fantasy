import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAppServer } from "../server.js";

// Invoke the HTTP request handler directly: no listening socket or external network.
async function request(options, authorization) {
  const server = createAppServer(options);
  const req = new EventEmitter();
  Object.assign(req, { url: "/api/coach/prelock?team=t0z", method: "POST", headers: { authorization } });
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; }, writeHead: status => { res.statusCode = status; },
    end: body => { res.body = JSON.parse(body); } };
  await server.listeners("request")[0](req, res);
  return res;
}
test("prelock job auth, default configuration and injected report", async () => {
  let calls = 0;
  const options = { modelJobToken: "job-secret", runPrelockJob: async args => {
    calls++;
    assert.deepEqual(args, { team: "t0z" });
    return { week: 6, checkedAt: "2026-10-18T15:45:00Z", locked: [], alerts: [], swaps: [], ok: true, message: "✅ Lineup OK" };
  } };
  assert.equal((await request({ ...options, modelJobToken: "" })).statusCode, 503);
  assert.equal((await request(options, "Bearer wrong")).statusCode, 401);
  assert.equal(calls, 0);
  const response = await request(options, "Bearer job-secret");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, "✅ Lineup OK");
  assert.equal(calls, 1);
});

test("prelock loader requests fresh statuses/projections and forwards actual week", async () => {
  const { getPrelockCheck } = await import("../scripts/prelock-check.js");
  const report = await getPrelockCheck({ team: "t0z", now: "2026-10-18T15:45:00Z",
    getContext: async ({ team }) => { assert.equal(team, "t0z"); return { season: 2026, week: 6, myTeam: { teamName: "Boukki", owner: "t0z", starters: [], bench: [] } }; },
    getStatuses: async options => { assert.equal(options.forceRefresh, true); return new Map(); },
    getProjections: async options => { assert.equal(options.week, 6); assert.equal(options.maxAgeMs, 0); return {}; },
    loadSchedule: async () => [{ week: 6, home_team: "BUF", away_team: "NYJ", kickoffAt: "2026-10-18T17:00:00Z" }],
    loadFreeAgents: async () => ({ byPosition: {} }) });
  assert.equal(report.week, 6);
  assert.match(report.message, /Contrôle avant verrouillage — S6 — Boukki \(Babacar, @t0z\)/);
});
