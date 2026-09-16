import { test } from "node:test";
import assert from "node:assert/strict";
import { highestCompletedScore, buildRecordWatchEntries } from "../public/assets/record-watch.js";

const matchupRows = [
  { week: 1, manager: "Alice", points: 120, isPlayoff: false },
  { week: 2, manager: "Alice", points: 140, isPlayoff: false },
  { week: 3, manager: "Alice", points: 999, isPlayoff: false }, // live/current week — must be excluded
  { week: 2, manager: "Alice", points: 500, isPlayoff: true }, // playoff noise — must be excluded
  { week: 1, manager: "Bob", points: 200, isPlayoff: false }
];

test("highestCompletedScore only considers this manager's completed, non-playoff rows", () => {
  assert.equal(highestCompletedScore(matchupRows, "Alice", 3), 140);
});

test("highestCompletedScore returns 0 when a manager has no completed rows yet", () => {
  assert.equal(highestCompletedScore(matchupRows, "Cara", 3), 0);
});

test("highestCompletedScore includes every non-playoff row when currentWeek is null (season fully complete)", () => {
  assert.equal(highestCompletedScore(matchupRows, "Alice", null), 999); // week 3 no longer excluded once there's no "live" week
});

const recordBook = {
  highScore: { manager: "Zed", year: 2022, week: 9, points: 180 },
  topStreaks: [{ manager: "Zed", year: 2022, wins: 8 }]
};
const seasonPointsRecord = { team: "Zed's Team", year: 2022, pf: 2000 };

test("buildRecordWatchEntries reports a raw gap and never a fabricated percentage", () => {
  const entries = buildRecordWatchEntries({
    recordBook,
    seasonPointsRecord,
    liveHighScore: 140,
    liveStreakWins: 3,
    livePointsFor: 850
  });
  assert.equal(entries.length, 3);
  const highScoreEntry = entries.find(entry => entry.label === "Score le plus haut sur un match");
  assert.equal(highScoreEntry.gap, 40);
  assert.equal(highScoreEntry.broken, false);
  assert.ok(!("odds" in highScoreEntry) && !("percentage" in highScoreEntry));
});

test("buildRecordWatchEntries flags broken:true when the live value beats the historical record", () => {
  const entries = buildRecordWatchEntries({
    recordBook,
    seasonPointsRecord,
    liveHighScore: 999, // week 3 (live) would break it, but callers only ever pass completed scores in
    liveStreakWins: 3,
    livePointsFor: 850
  });
  const highScoreEntry = entries.find(entry => entry.label === "Score le plus haut sur un match");
  assert.equal(highScoreEntry.broken, true);
});

test("buildRecordWatchEntries skips an entry whose record source is missing, never a placeholder row", () => {
  const entries = buildRecordWatchEntries({
    recordBook: { highScore: null, topStreaks: [] },
    seasonPointsRecord: null,
    liveHighScore: 140,
    liveStreakWins: 3,
    livePointsFor: 850
  });
  assert.deepEqual(entries, []);
});
