import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { getLeagueContext, formatContextText } from "../scripts/league-context.js";

const sampleContext = {
  generatedAt: "2026-09-07T08:00:00.000Z",
  week: 1,
  league: {
    id: "1392715510830878721",
    name: "Adineu 2026",
    teams: 12,
    format: "redraft",
    scoring: "full_ppr",
    rosterSettings: { starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 }, benchSlots: 6, reserveSlots: 1 },
    faab: 1000,
    waiverClear: "Wednesday 09:00 Europe/Paris",
    tradeDeadlineWeek: 12
  },
  myTeam: {
    rosterId: 5,
    owner: "t0z",
    teamName: "Boukki",
    starters: [
      { slot: "QB", player: { name: "Jaxson Dart", nflTeam: "NYG", position: "QB" } },
      { slot: "K", player: null }
    ],
    bench: [{ name: "Brock Purdy", nflTeam: "SF", position: "QB" }],
    ir: []
  }
};

test("formatContextText renders league rules, starters, bench and empty slots", () => {
  const text = formatContextText(sampleContext);
  assert.match(text, /ADINEU 2026/);
  assert.match(text, /12 teams · Full PPR/);
  assert.match(text, /MON ROSTER — BOUKKI \(@t0z\)/);
  assert.match(text, /QB Jaxson Dart NYG/);
  assert.match(text, /K EMPTY/);
  assert.match(text, /QB Brock Purdy SF/);
  assert.match(text, /IR\nEMPTY/);
});

test("context API exposes JSON and a copy-pasteable text format", async t => {
  const server = createAppServer({ getContext: async () => sampleContext });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z`);
  assert.equal(jsonResponse.status, 200);
  const body = await jsonResponse.json();
  assert.equal(body.myTeam.owner, "t0z");
  assert.match(body.message, /MON ROSTER/);

  const textResponse = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z&format=text`);
  assert.equal(textResponse.status, 200);
  assert.match(textResponse.headers.get("content-type"), /text\/plain/);
  assert.match(await textResponse.text(), /MON ROSTER/);
});

test("context API rejects an unknown team instead of guessing a roster", async t => {
  const server = createAppServer({
    getContext: async () => { throw new Error("Équipe Sleeper inconnue : personne"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/context?team=personne`);
  assert.equal(response.status, 404);
});

test("getLeagueContext splits starters, bench and IR from a raw Sleeper roster", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/rosters")) {
        return [{
          roster_id: 5,
          owner_id: "owner-1",
          players: ["p-qb", "p-rb", "p-bench", "p-ir"],
          starters: ["p-qb", "0"],
          reserve: ["p-ir"]
        }];
      }
      if (url.endsWith("/users")) {
        return [{ user_id: "owner-1", display_name: "t0z", metadata: { team_name: "Boukki" } }];
      }
      return { display_week: 3, week: 3, season: "2026" };
    }
  });

  const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);
  const context = await getLeagueContext({ team: "t0z", fetchImpl, catalogUrl });

  assert.equal(context.myTeam.starters.length, 2);
  assert.equal(context.myTeam.starters[0].player.sleeperId, "p-qb");
  assert.equal(context.myTeam.starters[1].player, null);
  assert.deepEqual(context.myTeam.bench.map(p => p.sleeperId), ["p-rb", "p-bench"]);
  assert.deepEqual(context.myTeam.ir.map(p => p.sleeperId), ["p-ir"]);
});

test("getLeagueContext fails explicitly when the requested Sleeper team is absent", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.endsWith("/rosters")
      ? [{ roster_id: 1, owner_id: "owner-1", players: [], starters: [], reserve: [] }]
      : [{ user_id: "owner-1", display_name: "t0z", metadata: { team_name: "Boukki" } }]
  });
  const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);

  await assert.rejects(
    getLeagueContext({ team: "personne", fetchImpl, catalogUrl }),
    /Équipe Sleeper inconnue : personne/
  );
});
