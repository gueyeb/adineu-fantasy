import { test } from "node:test";
import assert from "node:assert/strict";
import { buildYahooRecordBook } from "../public/assets/record-book.js";

// Two managers, two seasons — enough to exercise every field buildYahooRecordBook returns.
// Alice wins every regular-season game across both seasons (7-game streak, meets the >=7 filter);
// Bob never wins a regular-season game, so he supplies highestLoss.
function buildWeeks(managerAWins, count, startWeek = 1) {
  return Array.from({ length: count }, (_, index) => ({
    week: startWeek + index,
    matchups: [{
      team1Manager: "Alice", team1Name: "Alice's Team", team1Score: managerAWins ? 150 + index : 90,
      team2Manager: "Bob", team2Name: "Bob's Team", team2Score: managerAWins ? 90 : 150 + index
    }]
  }));
}

const matchupArchive = {
  seasons: [
    { year: 2024, weeks: buildWeeks(true, 7) },
    { year: 2023, weeks: buildWeeks(true, 1) }
  ]
};

const playoffSeasons = [
  {
    year: 2024,
    games: [
      { week: 15, round: "final", winner: { manager: "Alice", team: "Alice's Team", points: 180 }, loser: { manager: "Bob", team: "Bob's Team", points: 140 } }
    ]
  }
];

test("highScore picks the single highest regular-season side across all seasons", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  assert.equal(recordBook.highScore.manager, "Alice");
  assert.equal(recordBook.highScore.points, 156); // week 7 of the 2024 streak: 150 + 6
});

test("highestLoss picks the highest score among losing sides (Bob, who never wins)", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  assert.equal(recordBook.highestLoss.manager, "Bob");
  assert.equal(recordBook.highestLoss.points, 90);
});

test("topStreaks only keeps streaks of 7+ wins, longest first", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  assert.equal(recordBook.topStreaks.length, 1);
  assert.equal(recordBook.topStreaks[0].manager, "Alice");
  assert.equal(recordBook.topStreaks[0].wins, 7);
  assert.equal(recordBook.topStreaks[0].year, 2024);
});

test("biggestWin and closestWin are both drawn from winning sides only", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  assert.equal(recordBook.biggestWin.manager, "Alice");
  assert.ok(recordBook.biggestWin.points > recordBook.closestWin.points || recordBook.biggestWin === recordBook.closestWin);
});

test("playoff fields are computed from the pre-built playoffSeasons argument, not re-derived", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  assert.equal(recordBook.playoffHigh.manager, "Alice");
  assert.equal(recordBook.playoffHigh.points, 180);
  assert.equal(recordBook.playoffBiggestWin.points - recordBook.playoffBiggestWin.opponent.points, 40);
});

test("highestCombined sums both sides of a single matchup, not two different games", () => {
  const recordBook = buildYahooRecordBook(matchupArchive, playoffSeasons);
  // 2024 week 7: Alice 156 + Bob 90 = 246, the highest combined regular-season matchup.
  assert.equal(recordBook.highestCombined.team1.points + recordBook.highestCombined.team2.points, 246);
});
