import test from "node:test";
import assert from "node:assert/strict";
import { calculatePlayoffRace, DEFAULT_PLAYOFF_SPOTS } from "../public/assets/playoff-race.js";

const managers = Array.from({ length: 12 }, (_, index) => `Manager ${index + 1}`);

function matchupRows(weeks = 2) {
  return Array.from({ length: weeks }, (_, weekIndex) => managers.map((manager, managerIndex) => ({
    week: weekIndex + 1,
    manager,
    team: `Team ${managerIndex + 1}`,
    points: 150 - managerIndex * 3 + weekIndex,
    opponentPoints: 95 + managerIndex,
    isPlayoff: false
  }))).flat();
}

test("stays locked before power rankings are ready, same gate as power-rankings.js", () => {
  const result = calculatePlayoffRace(matchupRows(1), { expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "insufficient_weeks");
  assert.deepEqual(result.standings, []);
});

test("ranks by wins then points-for, and marks the top 8 seeds as in the playoffs", () => {
  const result = calculatePlayoffRace(matchupRows(), { expectedManagers: managers });
  assert.equal(result.ready, true);
  assert.equal(result.standings.length, 12);
  assert.equal(result.standings[0].manager, "Manager 1");
  assert.equal(result.standings[0].seed, 1);
  assert.equal(result.standings[0].inPlayoffs, true);
  assert.equal(result.standings[7].inPlayoffs, true);
  assert.equal(result.standings[8].inPlayoffs, false);
  assert.equal(result.standings[11].manager, "Manager 12");
});

test("computes games back from the cutoff seed using the standard formula", () => {
  const rows = [
    ...managers.map(manager => ({ week: 1, manager, team: manager, points: manager === "Manager 1" ? 120 : 100, opponentPoints: 90, isPlayoff: false })),
    ...managers.map(manager => ({ week: 2, manager, team: manager, points: manager === "Manager 1" ? 120 : 80, opponentPoints: 90, isPlayoff: false }))
  ];
  const result = calculatePlayoffRace(rows, { expectedManagers: managers, playoffSpots: 8 });
  const leader = result.standings.find(s => s.manager === "Manager 1");
  const others = result.standings.filter(s => s.manager !== "Manager 1");

  assert.equal(leader.wins, 2);
  assert.ok(leader.gamesBack <= 0); // gamesBack est relatif à la 8e place, pas à soi-même : négatif = devant le cutoff
  for (const team of others) {
    assert.equal(team.wins, 1);
    assert.ok(team.gamesBack >= 0);
  }
});

test("respects a custom playoffSpots count", () => {
  const result = calculatePlayoffRace(matchupRows(), { expectedManagers: managers, playoffSpots: 4 });
  assert.equal(result.playoffSpots, 4);
  assert.equal(result.standings.filter(s => s.inPlayoffs).length, 4);
});

test("exports the league default of 8 playoff spots", () => {
  assert.equal(DEFAULT_PLAYOFF_SPOTS, 8);
});
