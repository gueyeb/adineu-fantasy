import test from "node:test";
import assert from "node:assert/strict";
import { buildDefenseVsPosition, buildOpponents, matchupFor, SHRINK_GAMES } from "../public/assets/defense-vs-position.js";

// Week 1: A vs B, C vs D. A's WR scores 40 against B; everybody else's WR scores 10.
const games = [{ week: 1, away_team: "A", home_team: "B" }, { week: 1, away_team: "C", home_team: "D" }, { week: 2, away_team: "B", home_team: "C" }, { week: 2, away_team: "D", home_team: "A" }];
const teams = { a: "A", b: "B", c: "C", d: "D" };
const statsByWeek = [{ week: 1, stats: { a: { pts_ppr: 40 }, b: { pts_ppr: 10 }, c: { pts_ppr: 10 }, d: { pts_ppr: 10 } } }];
const deps = { teamOf: id => teams[id], positionOf: () => "WR", opponents: buildOpponents(games) };

test("points allowed are credited to the opponent's defense, shrunk toward the league mean", () => {
  const dvp = buildDefenseVsPosition(statsByWeek, deps);
  assert.equal(dvp.leagueAverage.WR, 17.5);
  const b = dvp.byDefense.get("B|WR"); // allowed 40 to A's WR
  assert.equal(b.allowedPerGame, 40);
  assert.equal(b.adjusted, (40 + SHRINK_GAMES * 17.5) / (1 + SHRINK_GAMES));
  assert.equal(b.rank, 1, "the defense that allows the most is rank 1 (easiest matchup)");
});

test("matchupFor labels the upcoming opponent and handles byes", () => {
  const dvp = buildDefenseVsPosition(statsByWeek, deps);
  const opponents = buildOpponents(games);
  const easy = matchupFor({ team: "C", position: "WR", week: 2, opponents, dvp }); // C plays B in week 2
  assert.equal(easy.opponent, "B");
  assert.equal(easy.label, "FACILE");
  assert.equal(matchupFor({ team: "Z", position: "WR", week: 2, opponents, dvp }).label, "BYE");
});

test("DEF players are keyed by their own team code", () => {
  const dvp = buildDefenseVsPosition([{ week: 1, stats: { A: { pts_ppr: 12 }, B: { pts_ppr: 2 } } }], { ...deps, positionOf: id => (id.length === 1 ? "DEF" : "WR") });
  assert.equal(dvp.byDefense.get("B|DEF").allowedPerGame, 12, "A's defense scored 12 against B's offense");
});
