import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

const sampleContext = {
  week: 3,
  myTeam: {
    starters: [{ slot: "K", player: null }],
    bench: [],
    ir: []
  }
};

test("lineup-advisor API flags an empty slot and offers a text alias", async t => {
  const server = createAppServer({
    getContext: async () => sampleContext,
    getInjuryStatuses: async () => new Map(),
    getFreeAgents: async () => ({ byPosition: { K: [{ name: "Streaming Kicker", position: "K", nflTeam: "LAC" }] } })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/lineup-advisor?team=t0z`);
  assert.equal(jsonResponse.status, 200);
  const body = await jsonResponse.json();
  assert.equal(body.week, 3);
  assert.equal(body.alerts[0].reason, "Slot vide");
  assert.match(body.message, /START\/SIT ADVISOR/);

  const textResponse = await fetch(`http://127.0.0.1:${port}/api/lineup-advisor?format=text`);
  assert.match(textResponse.headers.get("content-type"), /text\/plain/);
});

test("lineup-advisor API rejects an unknown team instead of guessing a roster", async t => {
  const server = createAppServer({
    getContext: async () => { throw new Error("Équipe Sleeper inconnue : personne"); },
    getInjuryStatuses: async () => new Map(),
    getFreeAgents: async () => ({ byPosition: {} })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/lineup-advisor?team=personne`);
  assert.equal(response.status, 404);
});
