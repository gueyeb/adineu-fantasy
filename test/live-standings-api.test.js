import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { getLiveStandings } from "../scripts/live-standings.js";

function sourceFixture({ nflFailure = false, historyFailure = false } = {}) {
  const counts = new Map();
  const rows = [{ roster_id: 1, matchup_id: 1, points: 10, starters: Array(9).fill("0"), players: [] }, { roster_id: 2, matchup_id: 1, points: 20, starters: Array(9).fill("0"), players: [] }];
  const fetchImpl = async url => {
    url = String(url); counts.set(url, (counts.get(url) || 0) + 1);
    let body;
    if (url.includes("espn.com")) {
      if (nflFailure) return { ok: false, status: 503 };
      body = { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [] };
    } else if (url.endsWith("/state/nfl")) body = { week: 2, season: "2026", season_type: "regular" };
    else if (url.endsWith("/rosters")) body = [{ roster_id: 1, owner_id: "private-one" }, { roster_id: 2, owner_id: "private-two" }];
    else if (url.endsWith("/users")) body = [{ user_id: "private-one", display_name: "One" }, { user_id: "private-two", display_name: "Two" }];
    else if (url.endsWith("/matchups/1")) {
      if (historyFailure) return { ok: false, status: 503 };
      body = rows;
    } else if (url.endsWith("/matchups/2")) body = rows;
    else if (url.includes("/projections/") || url.endsWith("/players/nfl")) body = {};
    else if (url.endsWith("/league/L")) body = { season: "2026", total_rosters: 2, settings: { playoff_week_start: 15, start_week: 1 }, scoring_settings: { rec: 1 } };
    else throw Error(`Unexpected fixture source ${url}`);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, counts };
}

test("live service shares in-flight reads and never exposes platform account IDs", async () => {
  const fixture = sourceFixture();
  const [a, b] = await Promise.all([getLiveStandings({ leagueId: "L", fetchImpl: fixture.fetchImpl }), getLiveStandings({ leagueId: "L", fetchImpl: fixture.fetchImpl })]);
  assert.equal(a.ready, true); assert.deepEqual(a, b);
  assert.ok([...fixture.counts.values()].every(count => count === 1));
  assert.equal(a.live.find(team => team.rosterId === 1).losses, 2);
  assert.ok(!JSON.stringify(a).includes("private-"));
});

test("NFL outage preserves score standings; missing history suspends the table", async () => {
  let fixture = sourceFixture({ nflFailure: true });
  let report = await getLiveStandings({ leagueId: "L", fetchImpl: fixture.fetchImpl });
  assert.equal(report.ready, true); assert.equal(report.nfl.available, false); assert.equal(report.projected.length, 0);
  fixture = sourceFixture({ historyFailure: true });
  report = await getLiveStandings({ leagueId: "L", fetchImpl: fixture.fetchImpl });
  assert.equal(report.reason, "INCOMPLETE_HISTORY"); assert.equal(report.matchups.length, 1);
});

test("live endpoint is read-only and degrades without leaking source errors", async t => {
  let fail = false;
  const server = createAppServer({ getLiveStandings: async () => { if (fail) throw Error("sensitive upstream details"); return { ready: true, week: 7, live: [] }; } });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/live-standings`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
  fail = true;
  const response = await fetch(url);
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes("sensitive"));
});
