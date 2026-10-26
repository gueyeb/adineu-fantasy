import test from "node:test";
import assert from "node:assert/strict";
import { calculatePowerRankings } from "../public/assets/power-rankings.js";
import { buildTeamSeasonContext, teamSeasonKey, allPlayUnavailableMessage, canonicalManagerForRoster } from "../public/assets/team-season-context.js";

// Public-name mismatch reproduced on 26/10; synthetic scores and roster IDs, no account IDs.
const names = ["t0z", "Birama", "MouhammadAT", ...Array.from({ length: 9 }, (_, i) => `Manager ${i}`)];
const rows = Array.from({ length: 7 }, (_, i) => names.map((manager, j) => ({ week: i + 1, manager, rosterId: j + 1,
  points: 100 + j, opponentPoints: 111 - j, isPlayoff: false }))).flat();

test("six completed weeks survive nickname changes through exact season roster IDs", () => {
  const context = buildTeamSeasonContext({ rows, rosterIds: names.map((_, i) => i + 1), currentWeek: 7 });
  assert.equal(context.allPlay.ready, true);
  assert.equal(context.powerRankings.ready, true);
  assert.equal(context.allPlay.completedWeekCount, 6);
  const mine = context.allPlay.records.find(row => row.manager === teamSeasonKey(1));
  assert.equal(mine.games, 6);
  assert.equal(mine.wins + mine.losses + mine.ties, 66);
  assert.equal(context.matchupRows.find(row => row.rosterId === 2).canonicalManager, "Birama");
  assert.equal(context.allPlay.records.length, 12);
  const reference = calculatePowerRankings(rows, { currentWeek: 7, expectedManagers: names });
  for (const [index, manager] of names.entries()) {
    const byRoster = context.powerRankings.rankings.find(row => row.manager === teamSeasonKey(index + 1));
    const canonical = reference.rankings.find(row => row.manager === manager);
    assert.equal(byRoster.rank, canonical.rank);
    assert.equal(byRoster.powerScore, canonical.powerScore);
  }
  assert.equal(canonicalManagerForRoster(context.matchupRows, 2), "Birama");
  assert.equal(canonicalManagerForRoster(context.matchupRows, 3), "MouhammadAT");
  assert.equal(canonicalManagerForRoster(context.matchupRows, 99), null);
  const conflict = [...context.matchupRows, { ...context.matchupRows.find(row => row.rosterId === 2), canonicalManager: "Contradiction" }];
  assert.equal(canonicalManagerForRoster(conflict, 2), null);
});

test("missing mapping is not guessed from a team or manager name", () => {
  const broken = rows.map(row => row.rosterId === 2 ? { ...row, rosterId: null, manager: "bmb22" } : row);
  const context = buildTeamSeasonContext({ rows: broken, rosterIds: names.map((_, i) => i + 1), currentWeek: 7 });
  assert.equal(context.allPlay.reason, "identity_mapping_unavailable");
  assert.equal(context.powerRankings.ready, false);
});

test("unavailable source, insufficient weeks and incomplete coverage have different messages", () => {
  assert.match(allPlayUnavailableMessage(null), /Données de saison indisponibles/);
  assert.match(allPlayUnavailableMessage({ reason: "insufficient_weeks" }), /assez de semaines/);
  assert.match(allPlayUnavailableMessage({ reason: "incomplete_coverage" }), /Couverture/);
  assert.ok(!allPlayUnavailableMessage({ reason: "identity_mapping_unavailable" }).includes("assez de semaines"));
  const partial = buildTeamSeasonContext({ rows: rows.filter(row => row.rosterId !== 2), rosterIds: names.map((_, i) => i + 1), currentWeek: 7 });
  assert.equal(partial.allPlay.reason, "incomplete_coverage");
});
