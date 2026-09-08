import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoricalRecords,
  buildSeasonMatchups,
  estimatePregameWinProbability
} from "../public/assets/matchups-live.js";

const users = [
  { user_id: "u1", display_name: "bm2222", metadata: { team_name: "The Bad Man" } },
  { user_id: "u2", display_name: "ESTOCADE", metadata: { team_name: "Estocade" } }
];
const rosters = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" }
];
const rows = [
  { matchup_id: 4, roster_id: 1, points: 112.4, starters: ["p1", "p2"] },
  { matchup_id: 4, roster_id: 2, points: 108.1, starters: ["p3", "p4"] }
];

test("buildHistoricalRecords keeps the record oriented to canonical manager names", () => {
  const archive = {
    seasons: [{
      weeks: [{
        matchups: [
          { team1Manager: "Birama", team2Manager: "Ado", team1Score: 120, team2Score: 110 },
          { team1Manager: "Ado", team2Manager: "Birama", team1Score: 99, team2Score: 99 }
        ]
      }]
    }]
  };
  const record = buildHistoricalRecords(archive).get("Ado::Birama");

  assert.deepEqual(record, {
    managerA: "Ado",
    managerB: "Birama",
    winsA: 0,
    winsB: 1,
    ties: 1,
    games: 2
  });
});

test("buildSeasonMatchups resolves Sleeper aliases, teams, projections and history", () => {
  const historicalRecords = new Map([["Ado::Birama", {
    managerA: "Ado",
    managerB: "Birama",
    winsA: 3,
    winsB: 4,
    ties: 0,
    games: 7
  }]]);
  const projections = {
    p1: { pts_ppr: 20 },
    p2: { pts_ppr: 15 },
    p3: { pts_ppr: 12 },
    p4: { pts_ppr: 11 }
  };
  const [matchup] = buildSeasonMatchups({
    rows,
    rosters,
    users,
    projections,
    historicalRecords,
    expectedStarterCount: 2
  });

  assert.equal(matchup.matchupId, 4);
  assert.equal(matchup.teams[0].manager, "Birama");
  assert.equal(matchup.teams[0].teamName, "The Bad Man");
  assert.equal(matchup.teams[1].manager, "Ado");
  assert.equal(matchup.teams[0].projection.total, 35);
  assert.equal(matchup.history.games, 7);
  assert.ok(matchup.chances.teamA > matchup.chances.teamB);
});

test("pregame win probability stays neutral for equal projections and rejects missing data", () => {
  assert.deepEqual(estimatePregameWinProbability(100, 100), { teamA: 50, teamB: 50 });
  assert.equal(estimatePregameWinProbability(null, 100), null);
  assert.equal(estimatePregameWinProbability(0, 100), null);
});

test("matchup probability stays hidden when projection coverage is incomplete", () => {
  const longRows = rows.map(row => ({
    ...row,
    starters: Array.from({ length: 9 }, (_, index) => `${row.roster_id}-${index}`)
  }));
  const [matchup] = buildSeasonMatchups({
    rows: longRows,
    rosters,
    users,
    projections: { "1-0": { pts_ppr: 20 }, "2-0": { pts_ppr: 18 } }
  });

  assert.equal(matchup.teams[0].projection.total, null);
  assert.equal(matchup.chances, null);
});

test("matchup probability stays hidden when a starting lineup is incomplete", () => {
  const sevenStarters = rows.map(row => ({
    ...row,
    starters: Array.from({ length: 7 }, (_, index) => `${row.roster_id}-${index}`)
  }));
  const projections = Object.fromEntries(sevenStarters.flatMap(row =>
    row.starters.map(playerId => [playerId, { pts_ppr: 14 }])));
  const [matchup] = buildSeasonMatchups({ rows: sevenStarters, rosters, users, projections });

  assert.equal(matchup.chances, null);
});
