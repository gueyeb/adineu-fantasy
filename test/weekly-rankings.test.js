import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildWeeklyRankings, RANKINGS_LIMITS } from "../public/assets/weekly-rankings.js";

const calibration = JSON.parse(await readFile(new URL("../public/data/boom-bust-calibration.json", import.meta.url), "utf8"));
const players = new Map([
  ["healthy", { name: "Healthy", position: "WR", nflTeam: "BUF" }],
  ["out", { name: "Absent", position: "WR", nflTeam: "BUF", injuryStatus: "Out" }],
  ["unknown", { name: "Unknown", position: "WR", nflTeam: "BUF" }],
  ["rb", { name: "Runner", position: "RB", nflTeam: "BUF" }],
  ["te", { name: "Tight end", position: "TE", nflTeam: "BUF" }],
  ["qb", { name: "Quarterback", position: "QB", nflTeam: "BUF" }],
  ["excluded", { name: "No projection FA", position: "WR", nflTeam: "BUF" }]
]);
const options = { week: 6, players, scoring: { rec: 1, rec_yd: 0.1, fgm_50_59: 5 }, calibration,
  projections: { healthy: { rec: 5, rec_yd: 70 }, out: { rec: 20 }, rb: { rec: 4 }, te: { rec: 3 }, qb: { rec: 1 } },
  owners: new Map([["healthy", { rosterId: 12, teamName: "Twelfth manager" }], ["unknown", { rosterId: 1, teamName: "First manager" }]]) };

test("ranks the league, forces stale Out projections to zero, and leaves missing projections unranked", () => {
  const report = buildWeeklyRankings(options);
  const wr = report.byPosition.WR;
  assert.deepEqual(wr.map(row => row.sleeperId), ["healthy", "out", "unknown"]);
  assert.equal(wr[0].projection, 12);
  assert.equal(wr[0].holder, "Twelfth manager");
  assert.equal(wr[0].holderRosterId, 12);
  assert.equal(wr[1].holder, null);
  assert.equal(wr[1].projection, 0);
  assert.equal(wr[1].floor, 0);
  assert.equal(wr[2].projection, null);
  assert.equal(wr[2].rank, null);
  assert.equal(wr[2].tier, null);
  assert.ok(wr[0].tier > 0);
  assert.ok(Number.isFinite(wr[0].ceiling));
  assert.deepEqual(new Set(report.flex.map(row => row.position)), new Set(["WR", "RB", "TE"]));
  assert.equal(report.flex.find(row => row.sleeperId === "rb").rank, 2);
});

test("IR, status overrides and byes take precedence; long field goals use league scoring", () => {
  const report = buildWeeklyRankings({ ...options, statuses: new Map([["healthy", "IR"]]), byeWeeks: { BUF: 6 } });
  assert.equal(report.byPosition.WR[0].projection, 0);
  assert.equal(report.byPosition.QB[0].projection, 0);
  assert.equal(report.byPosition.QB[0].injuryStatus, "BYE");
  const kicker = buildWeeklyRankings({ ...options, players: new Map([["k", { name: "Kicker", position: "K" }]]), projections: { k: { fgm_50p: 2 } } });
  assert.equal(kicker.byPosition.K[0].projection, 10);
});

test("default and overridden position/FLEX limits, shared ranks, and pure inputs", () => {
  const players = new Map();
  const projections = {};
  for (const position of Object.keys(RANKINGS_LIMITS).filter(p => p !== "FLEX")) {
    for (let i = 0; i < 110; i++) {
      const id = `${position}${i}`;
      players.set(id, { name: id, position });
      projections[id] = { rec: 1 };
    }
  }
  const report = buildWeeklyRankings({ ...options, players, projections });
  for (const [position, rows] of Object.entries(report.byPosition)) {
    assert.equal(rows.length, RANKINGS_LIMITS[position]);
    assert.ok(rows.every(row => row.rank === 1 && row.tier === 1));
  }
  assert.equal(report.flex.length, 100);
  const owned = buildWeeklyRankings({ ...options, players, projections, owners: new Map([["WR99", { teamName: "Boukki", rosterId: 1 }]]) });
  const tail = owned.byPosition.WR.at(-1);
  assert.equal(owned.byPosition.WR.length, RANKINGS_LIMITS.WR + 1);
  assert.deepEqual([tail.sleeperId, tail.beyondLimit, tail.rank], ["WR99", true, 1]);
  assert.ok(owned.byPosition.WR.slice(0, -1).every(row => !row.beyondLimit));
  const small = buildWeeklyRankings({ ...options, limits: { WR: 1, FLEX: 2 } });
  assert.equal(small.byPosition.WR.filter(row => !row.beyondLimit).length, 1);
  assert.equal(small.flex.filter(row => !row.beyondLimit).length, 2);
  assert.equal(options.players.get("healthy").tier, undefined);
});

test("Doubtful keeps its Sleeper projection, while known IR overrides stale data", () => {
  const report = buildWeeklyRankings({ ...options, statuses: new Map([["healthy", "Doubtful"], ["rb", "IR"]]) });
  assert.equal(report.byPosition.WR[0].projection, 12);
  assert.equal(report.byPosition.RB[0].projection, 0);
  assert.equal(report.byPosition.WR[0].matchup.label, "INCONNU");
});

test("Node assembly defaults to the current week, includes all 12 owners and reuses projection cache", async () => {
  const { getWeeklyRankings } = await import("../scripts/league-context.js");
  const calls = [];
  const rawPlayers = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), { full_name: `Player ${i}`, position: "WR", team: "BUF" }]));
  const routes = {
    "/state/nfl": { week: 2, season: "2026", season_has_scores: true },
    "/league/L": { season: "2026", scoring_settings: { rec: 1 } },
    "/league/L/rosters": Array.from({ length: 12 }, (_, i) => ({ roster_id: i + 1, owner_id: `u${i}`, players: [String(i)] })),
    "/league/L/users": Array.from({ length: 12 }, (_, i) => ({ user_id: `u${i}`, display_name: `Manager ${i}` })),
    "/players/nfl": rawPlayers,
    "/projections/nfl/regular/2026/2": Object.fromEntries(Object.keys(rawPlayers).map(id => [id, { rec: 5 }])),
    "/stats/nfl/regular/2026/1": { 0: { pts_ppr: 12 } }
  };
  const fetchImpl = async url => {
    const path = String(url).replace("https://api.sleeper.app/v1", "");
    calls.push(path);
    if (path.includes("games.csv")) return { ok: true, text: async () => "season,game_type,week,away_team,home_team\n2026,REG,1,BUF,NYJ\n2026,REG,2,BUF,NYJ" };
    return { ok: path in routes, status: 404, json: async () => routes[path] };
  };
  const report = await getWeeklyRankings({ leagueId: "L", fetchImpl });
  assert.equal(report.week, 2);
  assert.equal(new Set(report.byPosition.WR.map(row => row.holder)).size, 12);
  assert.equal(report.byPosition.WR[0].matchup.opponent, "NYJ");
  assert.equal(report.byPosition.WR[0].matchup.rank, 1);
  await getWeeklyRankings({ leagueId: "L", fetchImpl, week: 2 });
  assert.equal(calls.filter(path => path === "/projections/nfl/regular/2026/2").length, 1);
});
