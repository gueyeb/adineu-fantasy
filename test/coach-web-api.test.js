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
      return {
        week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
        myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } }
      };
    },
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    getMatchupContext: async () => null,
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

test("an unpublishable report is refused to bearer automation but still shown to the signed-in page", async t => {
  const coherence = { publishable: false, counts: { CALCULATION_INCONSISTENCY: 1 }, playerNames: {},
    warnings: [{ code: "ACTIONABLE_WITHOUT_COVERED_GAIN", category: "CALCULATION_INCONSISTENCY", severity: "BLOCKING", playerIds: ["x"], details: {}, message: "Fixture : action sans gain couvert." },
      { code: "BUY_LOW_NOT_REPRESENTED", category: "COVERAGE_GAP", severity: "REVIEW", playerIds: [], details: {}, message: "Fixture : à revoir." }] };
  let current = coherence;
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    getContext: async () => ({
      week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
      myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } }
    }),
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {}, coherence: current }),
    getMatchupContext: async () => null,
    analyze: async () => ({ results: [{ proposals: [] }] })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const bearer = { authorization: "Bearer test-api" };

  const refused = await fetch(`${base}/api/coach?team=t0z`, { headers: bearer });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.error, "REPORT_NOT_PUBLISHABLE");
  assert.equal(body.message, null);
  assert.match(body.notice, /1 incohérence\(s\) de calcul \(ACTIONABLE_WITHOUT_COVERED_GAIN\)/);

  const login = await fetch(`${base}/api/coach-session`, { method: "POST", headers: { origin: base }, body: JSON.stringify({ password: "test-only" }) });
  const page = await fetch(`${base}/api/coach`, { headers: { cookie: login.headers.get("set-cookie") } });
  assert.equal(page.status, 200);
  const plan = await page.json();
  assert.equal(plan.publishable, false);
  assert.match(plan.message, /NON publiable — envoi automatique refusé/);
  assert.match(plan.message, /ACTIONABLE_WITHOUT_COVERED_GAIN/);
  assert.doesNotMatch(plan.message, /BUY_LOW_NOT_REPRESENTED/);

  // Opt-in for the public report routes; without the flag they keep answering.
  assert.equal((await fetch(`${base}/api/free-agents?team=t0z`)).status, 200);
  assert.equal((await fetch(`${base}/api/free-agents?team=t0z&requirePublishable=1`)).status, 409);

  // Review-level warnings never block; neither does a missing verdict.
  current = { ...coherence, publishable: true, warnings: coherence.warnings.slice(1) };
  const sent = await fetch(`${base}/api/coach?team=t0z`, { headers: bearer });
  assert.equal(sent.status, 200);
  assert.equal(typeof (await sent.json()).message, "string");
  current = undefined;
  assert.equal((await fetch(`${base}/api/coach?team=t0z`, { headers: bearer })).status, 200);
});
