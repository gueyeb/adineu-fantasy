import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  RIVALRY_PAIRS,
  buildRivalryRecords,
  buildSleeperWeek,
  buildSleeperSeasonMeetings,
  sleeperManager
} from "../public/assets/rivalry-week.js";

const matchupArchive = JSON.parse(await readFile(
  new URL("../public/data/yahoo-matchups.json", import.meta.url),
  "utf8"
));
const playoffArchive = JSON.parse(await readFile(
  new URL("../public/data/yahoo-playoffs.json", import.meta.url),
  "utf8"
));
const history = JSON.parse(await readFile(
  new URL("../public/data/yahoo-history.json", import.meta.url),
  "utf8"
));

function playoffGames() {
  const archived = playoffArchive.seasons.flatMap(season => season.games.map(game => ({
    year: season.year,
    winner: game.winner,
    loser: game.loser
  })));
  const season2025 = history.seasons.find(season => season.year === 2025);
  const managerForTeam = team => history.managerHistory.find(profile =>
    profile.seasons["2025"] === team)?.manager;
  const games2025 = history.playoffs2025.map(game => ({
    year: 2025,
    winner: { manager: managerForTeam(game.winner), points: game.winnerPoints },
    loser: { manager: managerForTeam(game.loser), points: game.loserPoints }
  }));
  assert.ok(season2025);
  return [...archived, ...games2025];
}

test("assigns every 2026 manager to exactly one rivalry", () => {
  const managers = RIVALRY_PAIRS.flatMap(pair => [pair.managerA, pair.managerB]);
  assert.equal(RIVALRY_PAIRS.length, 6);
  assert.equal(managers.length, 12);
  assert.equal(new Set(managers).size, 12);
});

test("preserves the verified Yahoo regular-season records", () => {
  const records = buildRivalryRecords(matchupArchive, playoffGames());
  const summaries = Object.fromEntries(records.map(record => [
    `${record.managerA}::${record.managerB}`,
    [record.games, record.winsA, record.winsB, record.ties]
  ]));

  assert.deepEqual(summaries, {
    "Abdoulaye::Louis François": [10, 6, 4, 0],
    "Ado::Olivier": [8, 4, 4, 0],
    "babttz::Tamsir": [7, 4, 3, 0],
    "Birama::Magatte": [10, 6, 4, 0],
    "Marius::YeezyJr": [10, 5, 5, 0],
    "Mat::Toughness": [10, 4, 6, 0]
  });
});

test("keeps playoffs separate and exposes recent form", () => {
  const records = buildRivalryRecords(matchupArchive, playoffGames());
  const biramaMagatte = records.find(record => record.managerA === "Birama");
  const babttzTamsir = records.find(record => record.managerA === "babttz");

  assert.deepEqual(biramaMagatte.playoffs, { games: 3, winsA: 3, winsB: 0 });
  assert.deepEqual(babttzTamsir.playoffs, { games: 2, winsA: 1, winsB: 1 });
  assert.equal(biramaMagatte.lastFive.length, 5);
  assert.equal(biramaMagatte.lastFive.at(-1).year, 2025);
});

test("folds a played 2026 Sleeper meeting into the all-time rivalry record", () => {
  const liveMeetings = [{ managerA: "Magatte", managerB: "Birama", pointsA: 100, pointsB: 90, week: 3, year: 2026 }];
  const withLive = buildRivalryRecords(matchupArchive, playoffGames(), liveMeetings);
  const withoutLive = buildRivalryRecords(matchupArchive, playoffGames());
  const biramaMagatteLive = withLive.find(record => record.managerA === "Birama");
  const biramaMagatteFrozen = withoutLive.find(record => record.managerA === "Birama");

  assert.equal(biramaMagatteLive.games, biramaMagatteFrozen.games + 1);
  assert.equal(biramaMagatteLive.winsB, biramaMagatteFrozen.winsB + 1); // Magatte (managerB) a gagné ce match
  assert.equal(biramaMagatteLive.lastFive.at(-1).year, 2026);
  assert.equal(biramaMagatteLive.lastFive.at(-1).week, 3);
  assert.equal(biramaMagatteLive.lastFive.at(-1).pointsA, 90); // pointsA = côté Birama (managerA de la paire)
});

test("ignores a live meeting between managers who are not the tracked pair", () => {
  const liveMeetings = [{ managerA: "Birama", managerB: "Mat", pointsA: 100, pointsB: 90, week: 3, year: 2026 }];
  const records = buildRivalryRecords(matchupArchive, playoffGames(), liveMeetings);
  const biramaMagatte = records.find(record => record.managerA === "Birama");
  const matToughness = records.find(record => record.managerA === "Mat");

  assert.equal(biramaMagatte.games, 10); // inchangé : Mat n'est pas Magatte
  assert.equal(matToughness.games, 10); // inchangé : Birama n'est pas Toughness
});

test("buildSleeperSeasonMeetings tags each meeting with its week and skips unplayed weeks", () => {
  const users = [
    { user_id: "user-a", display_name: "bmb22" },
    { user_id: "user-b", display_name: "SneakySlayerMG" }
  ];
  const rosters = [
    { roster_id: 3, owner_id: "user-a" },
    { roster_id: 9, owner_id: "user-b" }
  ];
  const weeksOfRows = [
    { week: 1, rows: [{ matchup_id: 2, roster_id: 3, points: 0 }, { matchup_id: 2, roster_id: 9, points: 0 }] },
    { week: 2, rows: [{ matchup_id: 2, roster_id: 3, points: 121.4 }, { matchup_id: 2, roster_id: 9, points: 117.8 }] }
  ];

  const meetings = buildSleeperSeasonMeetings(weeksOfRows, rosters, users);
  assert.deepEqual(meetings, [
    { managerA: "Birama", managerB: "Magatte", pointsA: 121.4, pointsB: 117.8, week: 2, year: 2026 }
  ]);
});

test("resolves a published Sleeper matchup without persisting platform IDs", () => {
  const users = [
    { user_id: "user-a", display_name: "bm2222" },
    { user_id: "user-b", display_name: "SneakySlayerMG" }
  ];
  const rosters = [
    { roster_id: 3, owner_id: "user-a" },
    { roster_id: 9, owner_id: "user-b" }
  ];
  const rows = [
    { matchup_id: 2, roster_id: 3, points: 121.4 },
    { matchup_id: 2, roster_id: 9, points: 117.8 }
  ];

  assert.deepEqual(buildSleeperWeek(rows, rosters, users), [{
    managerA: "Birama",
    managerB: "Magatte",
    pointsA: 121.4,
    pointsB: 117.8
  }]);
});

test("resolves current and former Sleeper display names to canonical managers", () => {
  assert.equal(sleeperManager({ display_name: "bmb22" }), "Birama");
  assert.equal(sleeperManager({ display_name: "bm2222" }), "Birama");
  assert.equal(sleeperManager({ display_name: "Shiro00" }), "Mat");
  assert.equal(sleeperManager({ display_name: "MouhammadAT" }), "Mat");
});
