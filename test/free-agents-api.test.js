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

test("formatWaiverReport copies the live balance and dollar-based roster fit facts", () => {
  const text = formatWaiverReport({
    week: 4,
    faabRemaining: 497,
    byPosition: { WR: [{
      name: "Usage Receiver", nflTeam: "KC", weekProjection: 12.8,
      waiver: { category: "PRIORITÉ", rosPpg: 11.9, faabMarket: [80, 120], usageScore: 78, usageSignal: "BUY_LOW", duration: "BREAKOUT", newsOverride: false, fit: { fitScore: 82, priorityScore: 88, gainPerWeek: 2.4, netGainPerWeek: 2, dropCandidate: { name: "Bench" }, dropCostPerWeek: 0.4, faabMaxForMe: 105 } }
    }] }
  });
  assert.match(text, /FAAB restant : 497 \$ \/ 1000 \$/);
  assert.match(text, /FAAB marché 80–120 \$/);
  assert.match(text, /Usage 78 BUY_LOW/);
  assert.match(text, /Gain net moyen ROS 2 pts\/sem · Coupe Bench \(0\.4 pts\/sem\) · Max 105 \$/);
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

const sleeperFixture = ({ rostered = [], players = {}, projections = {}, stats = {} }) => async url => ({
  ok: true,
  json: async () => {
    if (url.endsWith("/rosters")) return [{ roster_id: 1, owner_id: "u1", players: rostered, settings: { waiver_budget_used: 100 } }];
    if (url.endsWith("/users")) return [{ user_id: "u1", display_name: "t0z" }];
    if (url.endsWith("/state/nfl")) return { display_week: 4, week: 4, season: "2026", season_has_scores: true };
    if (url.endsWith("/players/nfl")) return players;
    const projection = url.match(/projections\/nfl\/regular\/2026\/(\d+)/);
    if (projection) return projections[projection[1]] || {};
    const stat = url.match(/stats\/nfl\/regular\/2026\/(\d+)/);
    if (stat) return stats[stat[1]] || {};
    return {};
  }
});
const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);
const futureWeeks = points => Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(4 + i), points]));

test("getFreeAgents v2: an injury ahead + a snap surge makes a deep backup a priority add (Gordon/Achane case)", async () => {
  const players = {
    star: { full_name: "Injured Starter", position: "RB", team: "MIA", injury_status: "IR", injury_body_part: "Knee - ACL", search_rank: 8, active: true },
    backup: { full_name: "Deep Backup", position: "RB", team: "MIA", search_rank: 466, active: true },
    filler: { full_name: "Filler Back", position: "RB", team: "KC", search_rank: 300, active: true },
    rostered: { full_name: "Rostered Back", position: "RB", team: "BUF", search_rank: 20, active: true }
  };
  const projections = futureWeeks({ backup: { pts_ppr: 7 }, filler: { pts_ppr: 6 }, rostered: { pts_ppr: 15 } });
  const stats = {
    2: { backup: { off_snp: 10, tm_off_snp: 70, rush_att: 2, pts_ppr: 1 } },
    3: { backup: { off_snp: 61, tm_off_snp: 73, rush_att: 17, rec_tgt: 3, pts_ppr: 14.5 } }
  };
  const report = await getFreeAgents({ fetchImpl: sleeperFixture({ rostered: ["rostered"], players, projections, stats }), catalogUrl, position: "RB", limitPerPosition: 5, forceRefreshInjuryStatuses: true, team: "t0z" });
  assert.equal(report.rankingModel, "WAIVER_V2");
  assert.ok(report.byPosition.RB.every(player => player.sleeperId !== "rostered" && player.sleeperId !== "star"));
  const backup = report.byPosition.RB[0];
  assert.equal(backup.sleeperId, "backup");
  assert.equal(backup.waiver.duration, "UNCERTAIN");
  assert.ok(backup.waiver.flags.includes("PROMOTION") && backup.waiver.flags.includes("SNAP_SURGE"));
  assert.ok(["PRIORITÉ", "STREAMING", "STASH"].includes(backup.waiver.category));
  assert.equal(backup.waiver.roleConfirmation, "UNCONFIRMED");
  assert.ok(backup.waiver.fit && Number.isFinite(backup.waiver.fit.fitScore));
  assert.ok(Number.isFinite(backup.waiver.fit.priorityScore));
  assert.ok(Number.isFinite(backup.waiver.fit.dropCostPerWeek));
  assert.ok(Number.isFinite(backup.waiver.fit.netGainPerWeek));
  assert.ok(["ADD_NOW", "CLAIM_IF_CHEAP", "WATCH", "IGNORE"].includes(backup.waiver.decision.recommendedAction));
  assert.equal(report.faabRemaining, 900);
});

test("getFreeAgents never recommends a player Sleeper has marked IR/Out/Doubtful/PUP/Sus/NA", async () => {
  const players = { hurt: { full_name: "Hurt WR", position: "WR", team: "KC", injury_status: "IR", active: true }, ok: { full_name: "Healthy WR", position: "WR", team: "KC", active: true } };
  const projections = futureWeeks({ hurt: { pts_ppr: 18 }, ok: { pts_ppr: 8 } });
  const report = await getFreeAgents({ fetchImpl: sleeperFixture({ players, projections }), catalogUrl, position: "WR", limitPerPosition: 40, forceRefreshInjuryStatuses: true });
  assert.ok(report.byPosition.WR.every(player => player.sleeperId !== "hurt"), "an IR player must never be recommended with a fabricated projection");
  assert.ok(report.byPosition.WR.some(player => player.sleeperId === "ok"));
});

test("usage API returns the report and 404s an unknown team", async t => {
  const server = createAppServer({
    getUsage: async ({ team }) => {
      if (team === "personne") throw new Error("Équipe Sleeper inconnue : personne");
      return { weeks: [1, 2, 3], players: [{ name: "Alpha", usageScore: 90, signal: "BUY_LOW" }] };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const ok = await fetch(`http://127.0.0.1:${port}/api/usage?team=t0z`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).players[0].signal, "BUY_LOW");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/usage?team=personne`)).status, 404);
});
