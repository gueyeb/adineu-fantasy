import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { getFreeAgents, formatWaiverReport } from "../scripts/league-context.js";

const sampleReport = {
  generatedAt: "2026-09-07T08:00:00.000Z",
  week: 3,
  byPosition: {
    RB: [{ name: "Backup Runner", nflTeam: "KC", quality: { expertRank: 120 }, market: { sleeperAdp: 140 } }]
  }
};

test("formatWaiverReport groups free agents by position with rank and ADP", () => {
  const text = formatWaiverReport(sampleReport);
  assert.match(text, /WAIVER WIRE REPORT — ADINEU \(Semaine 3\)/);
  assert.match(text, /RB\n1\. Backup Runner \(KC\) · ECR #120 · ADP 140/);
});

test("formatWaiverReport says so when nothing matches the filter", () => {
  const text = formatWaiverReport({ byPosition: {} });
  assert.match(text, /Aucun free agent disponible/);
});

test("free-agents API returns JSON grouped by position with a text alias", async t => {
  const server = createAppServer({ getFreeAgents: async () => sampleReport });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/free-agents?position=RB`);
  assert.equal(jsonResponse.status, 200);
  const body = await jsonResponse.json();
  assert.equal(body.byPosition.RB[0].name, "Backup Runner");
  assert.match(body.message, /WAIVER WIRE REPORT/);

  const textResponse = await fetch(`http://127.0.0.1:${port}/api/free-agents?format=text`);
  assert.match(textResponse.headers.get("content-type"), /text\/plain/);
});

test("getFreeAgents excludes every rostered player and sorts by expert rank", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.endsWith("/rosters")
      ? [{ roster_id: 1, players: ["7564"] }]
      : { display_week: 2, week: 2, season: "2026" }
  });
  const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);

  const report = await getFreeAgents({ fetchImpl, catalogUrl, position: "WR", limitPerPosition: 3 });

  assert.ok(report.byPosition.WR.length > 0);
  assert.ok(report.byPosition.WR.every(player => player.sleeperId !== "7564"));
  for (let i = 1; i < report.byPosition.WR.length; i++) {
    const prevRank = report.byPosition.WR[i - 1].quality?.expertRank ?? Infinity;
    const rank = report.byPosition.WR[i].quality?.expertRank ?? Infinity;
    assert.ok(rank >= prevRank);
  }
});
