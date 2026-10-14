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

test("trade offer API validates ids and returns the evaluation with its message", async t => {
  const calls = [];
  const offer = {
    week: 6,
    mine: { team: "Boukki", gives: [{ name: "A.J. Brown", injuryStatus: "IR" }] },
    theirs: { team: "Rival", gives: [{ name: "Patrick Mahomes", injuryStatus: null }] },
    seasonAverage: { myDeltaPerWeek: 5.6, theirDeltaPerWeek: -3.2 },
    market: { give: 18, receive: 7 },
    scenarios: { weeks: { from: 6, to: 14 }, scenarios: [{ label: "retour immédiat", returnWeeks: { "A.J. Brown": 7 }, myTotal: 59.5, theirTotal: -3.6 }],
      evidence: { quality: "MEDIUM", projectionGaps: [], emptySlotWeeks: [], notes: [] } }
  };
  const server = createAppServer({ evaluateOffer: async args => { calls.push(args); if (args.give[0] === "9") throw new Error("Offre invalide : x"); return offer; } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/trade-offer?give=5859`)).status, 400);
  const response = await fetch(`http://127.0.0.1:${port}/api/trade-offer?give=5859&receive=4046,12519,bad;id`);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { give: ["5859"], receive: ["4046", "12519"] });
  const body = await response.json();
  assert.match(body.message, /Boukki \+5\.6 pts\/sem/);
  assert.match(body.message, /retour immédiat \(A\.J\. Brown S7\) : Boukki \+59\.5 pts/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/trade-offer?give=9&receive=1`)).status, 422);
});
