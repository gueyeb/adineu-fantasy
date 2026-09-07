import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { analyzeTrades, formatTradeBulletin } from "../scripts/analyze-trades.js";

const sampleAnalysis = {
  generatedAt: "2026-09-07T08:00:00.000Z",
  results: [{
    rosterId: 5,
    owner: "t0z",
    teamName: "Boukki",
    diagnosis: { counts: { QB: 2, RB: 5, WR: 6, TE: 2 }, surpluses: ["WR"], deficits: [] },
    proposals: [{
      category: "WIN_WIN",
      partnerName: "Rival",
      evaluation: { label: "Équitable" },
      give: [{ name: "Receveur", position: "WR" }],
      receive: [{ name: "Coureur", position: "RB" }],
      pitchTarget: "Renforce le poste RB."
    }]
  }]
};

test("formatTradeBulletin creates a Telegram-ready private alert", () => {
  const message = formatTradeBulletin(sampleAnalysis);
  assert.match(message, /BOUKKI \(@t0z\)/);
  assert.match(message, /Tu donnes : Receveur \(WR\)/);
  assert.match(message, /Tu reçois : Coureur \(RB\)/);
  assert.ok(message.length <= 3900);
});

test("trade API exposes health and an n8n-ready message", async t => {
  const server = createAppServer({ analyze: async () => sampleAnalysis });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });

  const tradeResponse = await fetch(`http://127.0.0.1:${port}/api/trades?team=t0z`);
  assert.equal(tradeResponse.status, 200);
  const body = await tradeResponse.json();
  assert.equal(body.results[0].owner, "t0z");
  assert.match(body.message, /BULLETIN TRADES ADINEU/);
});

test("trade API rejects an unknown team instead of choosing another roster", async t => {
  const server = createAppServer({
    analyze: async () => { throw new Error("Équipe Sleeper inconnue : personne"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/trades?team=personne`);
  assert.equal(response.status, 404);
});

test("analyzeTrades fails explicitly when the requested Sleeper team is absent", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.endsWith("/rosters")
      ? [{ roster_id: 1, owner_id: "owner-1", players: [] }]
      : [{ user_id: "owner-1", display_name: "t0z", metadata: { team_name: "Boukki" } }]
  });

  await assert.rejects(
    analyzeTrades({ team: "personne", fetchImpl }),
    /Équipe Sleeper inconnue : personne/
  );
});
