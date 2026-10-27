import test from "node:test";
import assert from "node:assert/strict";
import { compareSyncWeek, auditSleeperSync } from "../scripts/audit-sleeper-sync.js";
const stored = points => ({ week: 1, points, updated_at: "2026-10-20T08:00:00Z", team: { external_roster_id: "1" } });
test("audit detects stale zeroes, respects custom zero, missing and duplicate coverage", () => {
  const run = (sourceRows, storedRows) => compareSyncWeek({ week: 1, rosterIds: [1], sourceRows, storedRows });
  assert.equal(run([{ roster_id: 1, points: 20 }], [stored(0)]).issues[0].type, "SCORE_MISMATCH");
  assert.equal(run([{ roster_id: 1, points: 20, custom_points: 0 }], [stored(0)]).issues[0].type, "SOURCE_ALL_ZERO_UNCONFIRMED");
  assert.equal(run([{ roster_id: 1, points: 20 }], [stored(20)]).status, "MATCH");
  assert.equal(run([], [stored(20)]).status, "REVIEW");
  assert.equal(run([{ roster_id: 1, points: 20 }], [stored(20), stored(20)]).status, "REVIEW");
  assert.equal(run([{ roster_id: 1, points: 20 }], [stored(null)]).issues[0].type, "MISSING_SCORE");
});
test("end-to-end audit is GET-only, excludes live week and exports no owner IDs", async () => {
  const calls = [];
  const report = await auditSleeperSync({ fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    const body = url.endsWith('/state/nfl') ? { season: '2026', season_type: 'regular', week: 2, display_week: 2 } :
      url.endsWith('/rosters') ? [{ roster_id: 1, owner_id: 'private-owner' }] :
      url.includes('/rest/v1/') ? [stored(20)] :
      url.includes('/matchups/') ? [{ roster_id: 1, points: 20 }] :
      { season: '2026', status: 'in_season', total_rosters: 1, settings: { start_week: 1, playoff_week_start: 15 } };
    return { ok: true, json: async () => body };
  } });
  assert.equal(report.status, "MATCH");
  assert.equal(report.weeks.length, 1);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.ok(!calls.some(call => call.url.endsWith('/matchups/2')));
  assert.ok(!JSON.stringify(report).includes('private-owner'));
  await assert.rejects(auditSleeperSync({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});
