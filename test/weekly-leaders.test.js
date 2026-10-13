import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { getWeeklyLeaders } from "../scripts/league-context.js";
import { buildWeeklyLeaders, leaguePoints } from "../public/assets/weekly-leaders.js";

const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6, fgm_40_49: 4, fgm_50_59: 5, fgm_50p: 0, xpm: 1, sack: 1, bonus_rec_te: 0 };
const players = new Map([
  ["1", { name: "Quarter Back", position: "QB", nflTeam: "NE" }],
  ["2", { name: "Wide Out", position: "WR", nflTeam: "LAR" }],
  ["3", { name: "Free Catcher", position: "WR", nflTeam: "JAX" }],
  ["4", { name: "Bench Catcher", position: "WR", nflTeam: "GB" }],
  ["5", { name: "Line Backer", position: "LB", nflTeam: "GB" }],
  ["6", { name: "Idle Catcher", position: "WR", nflTeam: "GB" }],
  ["NE", { name: "New England Patriots", position: "DEF", nflTeam: "NE" }]
]);
const stats = {
  1: { gp: 1, pass_yd: 300, pass_td: 2, pass_int: 1, pts_ppr: 19 },
  2: { gp: 1, rec: 8, rec_yd: 120, rec_td: 1 },
  3: { gp: 1, rec: 6, rec_yd: 90 },
  4: { gp: 1, rec: 9, rec_yd: 110, rec_td: 2 },
  5: { gp: 1, sack: 2 },
  6: { gp: 0, rec: 0 },
  NE: { gp: 1, sack: 3 },
  TEAM_NE: { gp: 1, pass_yd: 300, rec: 30 }
};
const projections = { 1: { pass_yd: 250, pass_td: 1.5, pass_int: 0.5 }, 2: { rec: 6, rec_yd: 80, rec_td: 0.5 } };
const owners = new Map([["1", { rosterId: 1, teamName: "Kuro" }], ["2", { rosterId: 2, teamName: "Boukki" }], ["4", { rosterId: 2, teamName: "Boukki" }]]);
const lineups = new Map([["1", { rosterId: 1, started: true }], ["2", { rosterId: 2, started: true }], ["4", { rosterId: 2, started: false }], ["3", { rosterId: 5, started: false }]]);

test("leaguePoints applies the league scoring, not Sleeper's pts_ppr", () => {
  assert.equal(leaguePoints(stats[1], scoring), 18);
  assert.equal(leaguePoints(null, scoring), null);
});

test("leaguePoints scores a projected fgm_50p at the 50–59 rate only when the detail is missing", () => {
  assert.equal(leaguePoints({ fgm_40_49: 1, fgm_50p: 0.4, xpm: 2 }, scoring), 8);
  assert.equal(leaguePoints({ fgm_50p: 1, fgm_50_59: 1 }, scoring), 5);
});

test("buildWeeklyLeaders ranks per position with holder, bench, projection and usage", () => {
  const report = buildWeeklyLeaders({ stats, projections, scoring, playerOf: id => players.get(id), owners, lineups,
    usage: new Map([["2", { usageScore: 91, signal: "SELL_HIGH" }]]) });
  const wr = report.positions.WR.leaders;
  assert.deepEqual(wr.map(row => [row.rank, row.name, row.points]), [[1, "Bench Catcher", 32], [2, "Wide Out", 26], [3, "Free Catcher", 15]]);
  assert.equal(wr[0].benched, true);
  assert.deepEqual([wr[1].owner, wr[1].benched, wr[1].projected, wr[1].delta, wr[1].usageScore, wr[1].usageSignal], ["Boukki", false, 17, 9, 91, "SELL_HIGH"]);
  // Free agent: no projection stays null, and a past lineup of another roster is not a bench.
  assert.deepEqual([wr[2].freeAgent, wr[2].owner, wr[2].projected, wr[2].delta, wr[2].benched], [true, null, null, null, null]);
  assert.deepEqual(report.positions.WR.freeAgents.map(row => row.rank), [3]);
  assert.equal(report.positions.DEF.leaders[0].name, "New England Patriots");
  assert.equal(report.positions.QB.leaders.length, 1);
  assert.deepEqual(report.summary, { played: 5, freeAgentsInTop: 2, benchedInTop: 1 });
});

test("buildWeeklyLeaders limits each list and reports an unplayed week as empty", () => {
  const limited = buildWeeklyLeaders({ stats, scoring, playerOf: id => players.get(id), limit: 2, freeAgentsLimit: 1 });
  assert.equal(limited.positions.WR.leaders.length, 2);
  assert.equal(limited.positions.WR.freeAgents.length, 1);
  assert.equal(buildWeeklyLeaders({ stats: {}, scoring, playerOf: () => undefined }).summary.played, 0);
});

function fakeSleeper(routes, calls = []) {
  return async url => {
    const path = String(url).replace("https://api.sleeper.app/v1", "");
    calls.push(path);
    if (!(path in routes)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => routes[path] };
  };
}
const sleeperPlayers = Object.fromEntries([...players].map(([id, player]) => [id, { full_name: player.name, position: player.position, team: player.nflTeam }]));
const baseRoutes = {
  "/league/L": { season: "2026", scoring_settings: scoring },
  "/league/L/rosters": [{ roster_id: 2, owner_id: "u2", players: ["2", "4"] }],
  "/league/L/users": [{ user_id: "u2", display_name: "boukki", metadata: { team_name: "Boukki" } }],
  "/state/nfl": { week: 6, season: "2026", season_has_scores: true },
  "/players/nfl": sleeperPlayers,
  "/stats/nfl/regular/2026/5": stats,
  "/stats/nfl/regular/2026/6": {},
  "/projections/nfl/regular/2026/5": projections,
  "/league/L/matchups/5": [{ roster_id: 2, players: ["2", "4"], starters: ["2"] }]
};

test("getWeeklyLeaders falls back to the last completed week and survives a missing usage report", async () => {
  const report = await getWeeklyLeaders({ leagueId: "L", fetchImpl: fakeSleeper(baseRoutes), getUsage: async () => { throw new Error("down"); } });
  assert.deepEqual([report.week, report.currentWeek, report.live], [5, 6, false]);
  assert.deepEqual(report.usageWeeks, []);
  assert.deepEqual(report.positions.WR.leaders.map(row => [row.name, row.owner, row.benched]), [["Bench Catcher", "Boukki", true], ["Wide Out", "Boukki", false], ["Free Catcher", null, null]]);
});

test("getWeeklyLeaders shows the current week as soon as a game is played", async () => {
  const routes = { ...baseRoutes, "/stats/nfl/regular/2026/6": { 3: { gp: 1, rec: 4, rec_yd: 40 } } };
  const report = await getWeeklyLeaders({ leagueId: "L", fetchImpl: fakeSleeper(routes), getUsage: async () => ({ weeks: [3, 4, 5], players: [{ playerId: "3", usageScore: 70, signal: "BUY_LOW" }] }) });
  assert.deepEqual([report.week, report.live, report.usageWeeks], [6, true, [3, 4, 5]]);
  assert.deepEqual(report.positions.WR.leaders.map(row => [row.name, row.points, row.usageSignal]), [["Free Catcher", 8, "BUY_LOW"]]);
});

test("leaders API passes the week through and rejects an invalid one", async t => {
  const seen = [];
  const server = createAppServer({ getLeaders: async ({ week }) => { seen.push(week); return { week: week ?? 5, positions: {} }; } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/leaders`;
  assert.equal((await (await fetch(base)).json()).week, 5);
  assert.equal((await (await fetch(`${base}?week=3`)).json()).week, 3);
  assert.deepEqual(seen, [null, 3]);
  for (const bad of ["0", "19", "2.5", "abc", ""]) assert.equal((await fetch(`${base}?week=${bad}`)).status, 400);
});
