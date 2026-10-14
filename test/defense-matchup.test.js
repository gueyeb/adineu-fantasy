import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { buildDefenseMatchups, evaluateDefenseMatchup, expectedPointsAllowedScore, impliedPoints, quadrantFor, teamRates } from "../public/assets/defense-matchup.js";
import { defenseInjuryNotes } from "../scripts/league-context.js";

const scoring = { sack: 1, int: 2, fum_rec: 2, def_td: 6, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
// Two prior games each: AAA's offense is sacked a lot and turns it over; DDD's defense gets home.
const row = (season, week, gameId, team, opponent, offense = {}, defense = {}) => ({ season, week, gameId, team, opponent,
  attempts: 30, sacksSuffered: 2, interceptions: 1, fumblesLost: 0, carries: 25, defSacks: 2, defTds: 0, specialTeamsTds: 0, ...offense, ...defense });
const teamWeeks = [
  row(2026, 1, "g1", "AAA", "XXX", { attempts: 36, sacksSuffered: 4, interceptions: 2, fumblesLost: 1 }), row(2026, 1, "g1", "XXX", "AAA", { attempts: 28, sacksSuffered: 2 }),
  row(2026, 2, "g2", "AAA", "YYY", { attempts: 36, sacksSuffered: 4, interceptions: 2, fumblesLost: 1 }), row(2026, 2, "g2", "YYY", "AAA", { attempts: 28, sacksSuffered: 2 }),
  row(2026, 1, "g3", "DDD", "ZZZ", {}, { defSacks: 4, defTds: 1 }), row(2026, 1, "g3", "ZZZ", "DDD", { attempts: 36, sacksSuffered: 4 }),
  row(2026, 2, "g4", "DDD", "ZZZ", {}, { defSacks: 4 }), row(2026, 2, "g4", "ZZZ", "DDD", { attempts: 36, sacksSuffered: 4 }),
  row(2026, 3, "g5", "DDD", "ZZZ", {}, { defSacks: 9 })
];

test("teamRates reads the last games before the target week, offense and defense", () => {
  const offense = teamRates(teamWeeks, "AAA", { season: 2026, week: 3 });
  assert.deepEqual([offense.games, offense.sackRateAllowed, offense.interceptionRate, offense.fumblesLostPerGame, offense.dropbacksPerGame], [2, 0.1, 0.05, 1, 40]);
  const defense = teamRates(teamWeeks, "DDD", { season: 2026, week: 3 });
  assert.deepEqual([defense.games, defense.sackRate, defense.returnTdsPerGame], [2, 0.1, 0.5]);
  assert.equal(teamRates(teamWeeks, "NONE", { season: 2026, week: 3 }), null);
});

test("impliedPoints splits the total by the home margin; the points-allowed score follows the brackets", () => {
  const game = { home: "DDD", away: "AAA", spread: 7, total: 41 };
  assert.deepEqual([impliedPoints(game, "DDD"), impliedPoints(game, "AAA"), impliedPoints(game, "QQQ"), impliedPoints({ home: "A", away: "B" }, "A")], [24, 17, null, null]);
  assert.ok(expectedPointsAllowedScore(10, scoring) > expectedPointsAllowedScore(17, scoring));
  assert.ok(expectedPointsAllowedScore(17, scoring) > expectedPointsAllowedScore(30, scoring));
  assert.equal(expectedPointsAllowedScore(null, scoring), null);
});

test("evaluateDefenseMatchup blends 67 % opponent and 33 % defense sack rates into a league-scored expectation", () => {
  const row3 = evaluateDefenseMatchup({ defense: "DDD", game: { home: "DDD", away: "AAA", spread: 7, total: 41 }, teamWeeks, scoring, target: { season: 2026, week: 3 }, projection: 7.24 });
  assert.equal(row3.opponent, "AAA");
  assert.equal(row3.projectedSackRate, 10);
  assert.deepEqual([row3.expected.sacks, row3.expected.interceptions, row3.expected.fumbles, row3.expected.returnTds], [4, 2, 1, 0.5]);
  const paScore = expectedPointsAllowedScore(17, scoring);
  assert.equal(row3.expected.total, Number((4 + 4 + 2 + paScore + 3).toFixed(1)));
  assert.deepEqual([row3.sleeperProjection, row3.reliability, row3.impliedOpponentPoints], [7.2, "LOW", 17]);
  const noLine = evaluateDefenseMatchup({ defense: "DDD", game: { home: "DDD", away: "AAA" }, teamWeeks, scoring, target: { season: 2026, week: 3 } });
  assert.deepEqual([noLine.expected.total, noLine.reliability], [null, "LOW"]);
});

test("quadrants and the two-week streaming horizon", () => {
  assert.equal(quadrantFor({ projectedSackRate: 8, impliedOpponentPoints: 18 }, { sackRate: 6, implied: 22 }), "STRONG_MATCHUP");
  assert.equal(quadrantFor({ projectedSackRate: 5, impliedOpponentPoints: 18 }, { sackRate: 6, implied: 22 }), "SOFT_OPPONENT");
  assert.equal(quadrantFor({ projectedSackRate: 8, impliedOpponentPoints: 28 }, { sackRate: 6, implied: 22 }), "PASS_RUSH_ONLY");
  assert.equal(quadrantFor({ projectedSackRate: 5, impliedOpponentPoints: 28 }, { sackRate: 6, implied: 22 }), "AVOID");
  assert.equal(quadrantFor({ projectedSackRate: null, impliedOpponentPoints: 28 }, { sackRate: 6, implied: 22 }), "UNKNOWN");
  const games = [{ season: 2026, week: 3, home: "DDD", away: "AAA", spread: 7, total: 41 }, { season: 2026, week: 4, home: "AAA", away: "DDD", spread: 0, total: 40 }];
  const report = buildDefenseMatchups({ teamWeeks, games, scoring, season: 2026, week: 3, horizonWeeks: 2, notesFor: defense => (defense === "DDD" ? ["note"] : []) });
  assert.deepEqual(report.defenses.map(row => row.defense), ["DDD", "AAA"]);
  const [ddd] = report.defenses;
  assert.deepEqual([ddd.next[0].week, ddd.next[0].opponent, ddd.horizonWeeksPlayed, ddd.notes], [4, "AAA", 2, ["note"]]);
  assert.equal(ddd.horizonExpected, Number((ddd.expected.total + ddd.next[0].expected).toFixed(1)));
  const bye = buildDefenseMatchups({ teamWeeks, games: games.slice(0, 1), scoring, season: 2026, week: 3 });
  assert.deepEqual([bye.defenses[0].next[0].quadrant, bye.defenses[0].horizonWeeksPlayed], ["BYE", 1]);
});

test("defenseInjuryNotes reports a backup QB, absent pass rushers and OL, matching suffixed names", () => {
  const index = new Map([
    ["q1", { name: "Michael Penix", position: "QB", nflTeam: "ATL", depthOrder: 1 }],
    ["q2", { name: "Star Passer", position: "QB", nflTeam: "CHI", depthOrder: 1, injuryStatus: "IR" }],
    ["e1", { name: "Edge One", position: "DE", nflTeam: "DDD", depthPosition: "LOLB", depthOrder: 1, injuryStatus: "Out" }],
    ["e2", { name: "Edge Two", position: "DE", nflTeam: "DDD", depthPosition: "ROLB", depthOrder: 2, injuryStatus: "Out" }],
    ["o1", { name: "Tackle", position: "OT", nflTeam: "ATL", injuryStatus: "IR" }]
  ]);
  assert.deepEqual(defenseInjuryNotes(index, "DDD", "ATL", { home_team: "ATL", homeQb: "Michael Penix Jr." }), ["Pass rush : Edge One Out", "1 OL adverse absent (titularité inconnue)"]);
  assert.deepEqual(defenseInjuryNotes(index, "ZZZ", "ATL", { home_team: "ATL", homeQb: "Kirk Cousins" }), ["QB adverse annoncé : Kirk Cousins (titulaire habituel Michael Penix)", "1 OL adverse absent (titularité inconnue)"]);
  assert.deepEqual(defenseInjuryNotes(index, "ZZZ", "CHI", null), ["QB adverse Star Passer IR"]);
});

test("defense matchups API passes the week and rejects an invalid one", async t => {
  const seen = [];
  const server = createAppServer({ getDefenseMatchups: async ({ week }) => { seen.push(week); return { week: week ?? 6, defenses: [] }; } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/defense-matchups`;
  assert.equal((await (await fetch(base)).json()).week, 6);
  assert.equal((await (await fetch(`${base}?week=7`)).json()).week, 7);
  assert.equal((await fetch(`${base}?week=0`)).status, 400);
  assert.deepEqual(seen, [null, 7]);
});
