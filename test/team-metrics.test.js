import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFaabRemaining, formatStreak, streakWinCount } from "../public/assets/team-metrics.js";

test("calculateFaabRemaining subtracts spend from the total budget", () => {
  assert.equal(calculateFaabRemaining(1000, 52), 948);
});

test("calculateFaabRemaining treats a missing waiver_budget_used as zero spent", () => {
  assert.equal(calculateFaabRemaining(1000, undefined), 1000);
});

test("calculateFaabRemaining never goes negative and returns null without a valid budget", () => {
  assert.equal(calculateFaabRemaining(1000, 5000), 0);
  assert.equal(calculateFaabRemaining(undefined, 52), null);
});

test("formatStreak reads Sleeper's \"3W\"/\"1L\" shorthand into a French label", () => {
  assert.equal(formatStreak("3W"), "3 victoires de suite");
  assert.equal(formatStreak("1L"), "1 défaite de suite");
  assert.equal(formatStreak("1W"), "1 victoire de suite");
});

test("formatStreak returns null for absent or malformed streak values, never a guess", () => {
  assert.equal(formatStreak(undefined), null);
  assert.equal(formatStreak(""), null);
  assert.equal(formatStreak("0W"), null);
  assert.equal(formatStreak("garbage"), null);
});

test("streakWinCount reads the numeric length of a current win streak", () => {
  assert.equal(streakWinCount("3W"), 3);
  assert.equal(streakWinCount("1W"), 1);
});

test("streakWinCount is 0 for a loss streak or an absent/malformed value (never negative)", () => {
  assert.equal(streakWinCount("2L"), 0);
  assert.equal(streakWinCount(undefined), 0);
  assert.equal(streakWinCount("garbage"), 0);
});
