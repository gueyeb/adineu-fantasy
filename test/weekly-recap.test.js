import test from "node:test";
import assert from "node:assert/strict";
import { computeOptimalLineupPoints, buildWeeklyRecap } from "../public/assets/weekly-recap.js";

const rosterSettings = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 }
};

const catalog = new Map([
  ["qb1", { position: "QB" }],
  ["rb1", { position: "RB" }],
  ["rb2", { position: "RB" }],
  ["rb3", { position: "RB" }],
  ["wr1", { position: "WR" }],
  ["wr2", { position: "WR" }],
  ["te1", { position: "TE" }],
  ["k1", { position: "K" }],
  ["def1", { position: "DEF" }]
]);

test("computeOptimalLineupPoints fills required slots then the best leftover into FLEX", () => {
  const playersPoints = {
    qb1: 20, rb1: 25, rb2: 10, rb3: 18, wr1: 15, wr2: 8, te1: 12, k1: 6, def1: 9
  };
  const total = computeOptimalLineupPoints({
    playerIds: Object.keys(playersPoints),
    playersPoints,
    playerCatalog: catalog,
    rosterSettings
  });
  // Requis : QB 20, RB 25+18 (rb2=10 recalé), WR 15+8, TE 12, K 6, DEF 9.
  // Reste pour FLEX : RB 10, WR (aucun), TE (aucun) -> FLEX = 10.
  assert.equal(total, 20 + 25 + 18 + 15 + 8 + 12 + 6 + 9 + 10);
});

test("computeOptimalLineupPoints ignores players with no recorded score", () => {
  const total = computeOptimalLineupPoints({
    playerIds: ["qb1", "ghost"],
    playersPoints: { qb1: 20 },
    playerCatalog: catalog,
    rosterSettings
  });
  assert.equal(total, 20);
});

function matchupRow({ rosterId, matchupId, points, players, playersPoints, starters }) {
  return {
    roster_id: rosterId,
    matchup_id: matchupId,
    points,
    players,
    players_points: playersPoints,
    starters
  };
}

const rosters = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: "u3" },
  { roster_id: 4, owner_id: "u4" }
];
const users = [
  { user_id: "u1", display_name: "Ado", metadata: { team_name: "Estocade" } },
  { user_id: "u2", display_name: "Birama", metadata: { team_name: "The Bad Man" } },
  { user_id: "u3", display_name: "Marius", metadata: { team_name: "Chase Me To London" } },
  { user_id: "u4", display_name: "Toughness", metadata: {} }
];

test("buildWeeklyRecap finds the highest score and the closest matchup", () => {
  const rows = [
    matchupRow({ rosterId: 1, matchupId: 10, points: 140, players: ["qb1"], playersPoints: { qb1: 140 }, starters: ["qb1"] }),
    matchupRow({ rosterId: 2, matchupId: 10, points: 90, players: ["qb1"], playersPoints: { qb1: 90 }, starters: ["qb1"] }),
    matchupRow({ rosterId: 3, matchupId: 11, points: 100, players: ["qb1"], playersPoints: { qb1: 100 }, starters: ["qb1"] }),
    matchupRow({ rosterId: 4, matchupId: 11, points: 101, players: ["qb1"], playersPoints: { qb1: 101 }, starters: ["qb1"] })
  ];
  const recap = buildWeeklyRecap({ rows, rosters, users, playerCatalog: catalog, week: 3, rosterSettings });

  assert.equal(recap.week, 3);
  assert.equal(recap.highestScore.manager, "Ado");
  assert.equal(recap.highestScore.actualScore, 140);
  assert.equal(recap.closestMatchup.margin, 1);
});

test("buildWeeklyRecap flags an upset only when the pregame underdog actually wins", () => {
  const rows = [
    matchupRow({ rosterId: 1, matchupId: 20, points: 130, players: ["qb1"], playersPoints: { qb1: 130 }, starters: ["qb1"] }),
    matchupRow({ rosterId: 2, matchupId: 20, points: 90, players: ["qb1"], playersPoints: { qb1: 90 }, starters: ["qb1"] })
  ];
  const projections = { qb1: { pts_ppr: 90 } }; // même projection pour les deux -> pas assez pour un favori net
  const noUpset = buildWeeklyRecap({ rows, rosters, users, playerCatalog: catalog, projections, rosterSettings });
  assert.equal(noUpset.biggestUpset, null);

  // Équipe 2 projetée nettement favorite (projection très supérieure) mais perd sur le terrain.
  const upsetRows = [
    matchupRow({ rosterId: 1, matchupId: 21, points: 130, players: ["qb1"], playersPoints: { qb1: 130 }, starters: ["qb1"] }),
    matchupRow({ rosterId: 2, matchupId: 21, points: 90, players: ["qb1"], playersPoints: { qb1: 90 }, starters: ["qb1"] })
  ];
  const upsetProjections = { qb1: 0 }; // recalculé par équipe ci-dessous
  const rowsWithDistinctProjection = [
    { ...upsetRows[0], starters: ["a"] },
    { ...upsetRows[1], starters: ["b"] }
  ];
  const recap = buildWeeklyRecap({
    rows: rowsWithDistinctProjection,
    rosters,
    users,
    playerCatalog: catalog,
    projections: { a: { pts_ppr: 80 }, b: { pts_ppr: 130 } },
    rosterSettings
  });
  assert.ok(recap.biggestUpset);
  assert.equal(recap.biggestUpset.winner.manager, "Ado");
  assert.equal(recap.biggestUpset.loser.manager, "Birama");
});

test("buildWeeklyRecap ranks bench points left, worst offenders first", () => {
  const rows = [
    matchupRow({
      rosterId: 1, matchupId: 30, points: 100,
      players: ["qb1", "rb1"], playersPoints: { qb1: 100, rb1: 50 }, starters: ["qb1"]
    }),
    matchupRow({
      rosterId: 2, matchupId: 30, points: 100,
      players: ["qb1"], playersPoints: { qb1: 100 }, starters: ["qb1"]
    })
  ];
  const recap = buildWeeklyRecap({ rows, rosters, users, playerCatalog: catalog, rosterSettings });
  assert.equal(recap.benchPointsLeaders[0].manager, "Ado");
  assert.equal(recap.benchPointsLeaders[0].benchPointsLeft, 50);
  assert.equal(recap.benchPointsLeaders[1].benchPointsLeft, 0);
});
