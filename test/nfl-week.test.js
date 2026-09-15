import test from "node:test";
import assert from "node:assert/strict";
import { resolveOperationalWeek, resolveLastCompletedWeek } from "../public/assets/nfl-week.js";

test("uses Sleeper week during the Tuesday rollover when display_week is stale", () => {
  const state = { week: 2, display_week: 1, season_has_scores: true };
  assert.equal(resolveOperationalWeek(state), 2);
  assert.equal(resolveLastCompletedWeek(state), 1);
});

test("falls back safely when Sleeper omits week", () => {
  assert.equal(resolveOperationalWeek({ display_week: 4 }), 4);
  assert.equal(resolveOperationalWeek({}), 1);
});
