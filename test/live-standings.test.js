import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveStandings, parseNflLiveGames } from "../public/assets/live-standings.js";
const ids = [1, 2, 3, 4];
function fixture() {
  const row = (id, points) => ({ roster_id: id, matchup_id: id < 3 ? 1 : 2, points, custom_points: null, starters: Array.from({ length: 9 }, (_, i) => `${id}-${i}`), players: [...Array.from({ length: 9 }, (_, i) => `${id}-${i}`), `${id}-bench`], players_points: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${id}-${i < 9 ? i : 'bench'}`, i < 9 ? points / 9 : 99])) });
  const players = new Map(ids.flatMap(id => Array.from({ length: 10 }, (_, i) => [`${id}-${i < 9 ? i : 'bench'}`, { name: `Player ${id}/${i}`, position: "WR", nflTeam: "DAL" }])));
  const currentRows = ids.map((id, i) => row(id, [90, 100, 80, 80][i]));
  return { league: { season: "2026", total_rosters: 4, scoring_settings: { rec_yd: 0.1 }, settings: { start_week: 1, playoff_week_start: 15, playoff_seed_type: 0, league_average_match: 0 } },
    state: { week: 2, season: "2026", season_type: "regular" }, rosters: ids.map(id => ({ roster_id: id, owner_id: `private${id}`, settings: { wins: 99 } })),
    users: ids.map(id => ({ user_id: `private${id}`, display_name: `Manager ${id}` })),
    history: [{ week: 1, rows: ids.map((id, i) => row(id, [110, 100, 90, 95][i])) }], currentRows, players,
    projections: Object.fromEntries([...players.keys()].map(id => [id, { rec_yd: 100 }])),
    nfl: { games: [{ home: "DAL", away: "PHI", state: "LIVE", remainingFraction: 0.5, period: 3, clock: "15:00" }], byes: [] }, asOf: "2026-10-26T18:00:00Z" };
}

test("rebuilds W/L from prior weeks, adds live once, counts ties, excludes bench", () => {
  const input = fixture(); const report = buildLiveStandings(input);
  assert.equal(report.ready, true);
  const one = report.live.find(t => t.rosterId === 1);
  assert.deepEqual([one.wins, one.losses, one.ties, one.pointsFor], [1, 1, 0, 200]);
  assert.equal(report.live.find(t => t.rosterId === 3).ties, 1);
  assert.equal(report.matchups[0].teams[0].estimate, 135, "90 acquired + 9 × 10 × half game; bench never contributes");
  assert.equal(report.matchups[0].teams[0].bench[0].actual, 99);
  assert.ok(!JSON.stringify(report).includes("private"));
  assert.deepEqual(buildLiveStandings(input).live, report.live, "refresh never compounds results");
});

test("before kickoff, current-score standings do not invent 0–0 ties", () => {
  const input = fixture(); input.currentRows.forEach(row => { row.points = 0; row.players_points = {}; });
  input.nfl.games[0] = { home: "DAL", away: "PHI", state: "PREGAME", remainingFraction: 1 };
  const report = buildLiveStandings(input);
  assert.ok(report.live.every(t => t.wins + t.losses + t.ties === 1));
  assert.equal(report.started, false);
  input.nfl.games[0] = { home: "DAL", away: "PHI", state: "FINAL", remainingFraction: 0 };
  assert.ok(buildLiveStandings(input).live.every(team => team.ties === 1), "a real final 0–0 counts as a tie");
});

test("missing projections/clock suspend projected league standings, keep current-score scenario", () => {
  const input = fixture(); delete input.projections["1-0"];
  let report = buildLiveStandings(input);
  assert.equal(report.live.length, 4); assert.equal(report.projected.length, 0);
  input.nfl = { games: [], byes: [] };
  report = buildLiveStandings(input);
  assert.equal(report.ready, true); assert.equal(report.projectionComplete, false);
});

test("final games use official scores without projections; custom score is not added twice", () => {
  const input = fixture(); input.nfl.games[0].state = "FINAL"; input.nfl.games[0].remainingFraction = 0; input.projections = {};
  input.currentRows[0].custom_points = 105;
  const report = buildLiveStandings(input);
  assert.equal(report.completed, true);
  assert.deepEqual(report.projected, report.live);
  assert.equal(report.live.find(t => t.rosterId === 1).pointsFor, 215);
});

test("history gaps, duplicate matchups, playoffs and unsupported seeding fail explicitly", () => {
  const input = fixture(); input.history = [];
  assert.equal(buildLiveStandings(input).reason, "INCOMPLETE_HISTORY");
  input.currentRows.push(input.currentRows[0]);
  assert.equal(buildLiveStandings(input).reason, "INCOMPLETE_MATCHUPS");
  input.state.week = 15;
  assert.equal(buildLiveStandings(input).reason, "OUTSIDE_REGULAR_SEASON");
  input.state.week = 2; input.league.settings.league_average_match = 1;
  assert.equal(buildLiveStandings(input).reason, "UNSUPPORTED_STANDINGS_RULE");
});

test("NFL clock adapter verifies season/week, normalizes teams and suspends overtime", () => {
  const event = { id: "game", date: "2026-10-26T17:00:00Z", season: { year: 2026 }, week: { number: 7 }, status: { period: 3, clock: 900, displayClock: "15:00", type: { state: "in", completed: false } }, competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "WSH" }, score: "10" }, { homeAway: "away", team: { abbreviation: "JAC" }, score: "7" }] }] };
  const body = { season: { year: 2026, type: 2 }, week: { number: 7, teamsOnBye: [{ abbreviation: "LA" }] }, events: [event] };
  let report = parseNflLiveGames(body, { season: 2026, week: 7 });
  assert.equal(report.games[0].remainingFraction, 0.5); assert.equal(report.games[0].home, "WAS"); assert.deepEqual(report.byes, ["LAR"]);
  event.status.period = 5;
  assert.equal(parseNflLiveGames(body, { season: 2026, week: 7 }).games[0].remainingFraction, null);
  assert.equal(parseNflLiveGames(body, { season: 2025, week: 7 }).available, false);
});

test("equal wins and cumulative PF preserve tied ranks, and source inputs remain unchanged", () => {
  const input = fixture();
  input.history[0].rows.forEach(row => { row.points = 100; });
  input.currentRows.forEach(row => { row.points = 90; });
  const before = JSON.stringify(input.currentRows);
  const report = buildLiveStandings(input);
  assert.deepEqual(report.live.map(team => team.rank), [1, 1, 1, 1]);
  assert.equal(JSON.stringify(input.currentRows), before);
});


test("a stale pregame clock cannot double-count a player who already scored", () => {
  const input = fixture();
  input.nfl.games[0] = { home: "DAL", away: "PHI", state: "PREGAME", remainingFraction: 1 };
  const report = buildLiveStandings(input);
  assert.equal(report.ready, true);
  assert.equal(report.projected.length, 0);
  assert.equal(report.matchups[0].teams[0].estimate, null);
});
