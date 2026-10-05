import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDecisionEvidence, easternKickoffIso } from "../scripts/decision-evidence.js";
import { resolveRoleEvidence } from "../public/assets/acquisition-availability.js";

test("schedule kickoffs use Eastern summer/winter offsets; unknown time stays null", () => {
  assert.equal(easternKickoffIso("2026-10-04", "13:00"), "2026-10-04T17:00:00.000Z");
  assert.equal(easternKickoffIso("2026-11-08", "13:00"), "2026-11-08T18:00:00.000Z");
  assert.equal(easternKickoffIso("2026-10-04", ""), null);
});

test("operator evidence loads end to end, rejects wrong scope and recovers from missing/invalid files", async t => {
  const dir = await mkdtemp(join(tmpdir(), "adineu-evidence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "evidence.json");
  const scope = { leagueId: "league", season: "2026", week: 4 };
  const role = { source: "https://example.com/official-announcement", observedAt: "2026-10-04T09:00:00Z", expiresAt: "2026-10-04T18:00:00Z", roleConfirmation: "CONFIRMED", announcedRole: "STARTING_QB", roleWeeks: 1 };
  await writeFile(path, JSON.stringify({ version: 1, leagueId: "league", season: "2026", targetWeek: 4, rolesById: { q: role }, rosterPreferences: [{ playerId: "p", rosterId: 1, kind: "KEEP_UNTIL" }] }));
  const loaded = await loadDecisionEvidence({ path, ...scope });
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.rosterPreferences[0].playerId, "p");
  assert.equal(resolveRoleEvidence(loaded.rolesById.q, { ...scope, asOf: "2026-10-04T10:00:00Z" }).roleConfirmation, "CONFIRMED");
  assert.equal(resolveRoleEvidence(loaded.rolesById.q, { ...scope, asOf: "2026-10-04T19:00:00Z" }).roleConfirmation, "UNCONFIRMED");
  assert.deepEqual((await loadDecisionEvidence({ path, ...scope, week: 5 })).issues, ["DECISION_EVIDENCE_SCOPE_MISMATCH"]);
  await writeFile(path, "broken");
  assert.deepEqual((await loadDecisionEvidence({ path, ...scope })).issues, ["DECISION_EVIDENCE_UNREADABLE"]);
});
