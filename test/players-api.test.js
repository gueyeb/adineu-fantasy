import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("players API returns only requested slim entries and validates ids", async t => {
  const index = new Map([
    ["4046", { name: "Patrick Mahomes", position: "QB", fantasyPositions: ["QB"], injuryStatus: "Out" }],
    ["9509", { name: "Bijan Robinson", position: "RB", fantasyPositions: null }]
  ]);
  const server = createAppServer({ getPlayersIndex: async () => index });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/players`;
  const body = await (await fetch(`${base}?ids=4046,9509,unknown1`)).json();
  assert.deepEqual(body.players, {
    4046: { full_name: "Patrick Mahomes", position: "QB", fantasy_positions: ["QB"] },
    9509: { full_name: "Bijan Robinson", position: "RB", fantasy_positions: ["RB"] }
  });
  assert.equal((await fetch(base)).status, 400);
  assert.equal((await fetch(`${base}?ids=${Array.from({ length: 601 }, (_, i) => i + 1).join(",")}`)).status, 400);
});
