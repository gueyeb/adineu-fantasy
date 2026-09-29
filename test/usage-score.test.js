import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerWeeks, buildTeamTotals, calculateUsageScores, fitExpectedPoints } from "../public/assets/usage-score.js";

const teamOf = id => id.split("-")[0];
const positionOf = id => id.split("-")[1];
// Team T: WR "T-WR-alpha" gets 10 of 20 targets but scores little -> BUY_LOW; "T-WR-beta" 3 targets + 2 TDs -> SELL_HIGH.
const line = (off_snp, rec_tgt, pts_ppr, extra = {}) => ({ off_snp, tm_off_snp: 60, rec_tgt, rec_air_yd: rec_tgt * 10, pts_ppr, ...extra });
const statsByWeek = [1, 2, 3].map(week => ({
  week,
  stats: {
    "T-WR-alpha": line(58, 10, 7),
    "T-WR-beta": line(30, 3, 19),
    "T-TE-gamma": line(40, 7, 9),
    "T-RB-delta": line(45, 0, 12, { rush_att: 18, rush_rz_att: 3 }),
    "T-QB-qb": { off_snp: 60, tm_off_snp: 60, pts_ppr: 20 },
    "T-WR-bench": { off_snp: 0, tm_off_snp: 60 }
  }
}));

test("team totals and shares come from the same week's player lines", () => {
  const totals = buildTeamTotals(statsByWeek, teamOf);
  assert.deepEqual(totals.get("1|T"), { targets: 20, airYards: 200, carries: 18, redZone: 3, snaps: 60 });
  const rows = buildPlayerWeeks(statsByWeek, { teamOf, positionOf });
  assert.ok(rows.every(row => row.playerId !== "T-QB-qb" && row.playerId !== "T-WR-bench"), "QB and non-playing players excluded");
  const alpha = rows.find(row => row.playerId === "T-WR-alpha");
  assert.equal(alpha.targetShare, 0.5);
  assert.equal(alpha.snapShare, 58 / 60);
});

test("xFP falls back to fixed volume values when there are too few player-weeks to fit", () => {
  const models = fitExpectedPoints(buildPlayerWeeks(statsByWeek, { teamOf, positionOf }));
  assert.equal(models.WR.fitted, false);
  assert.ok(models.WR.targets > 1);
});

test("usage score ranks volume, and signals compare production with expected points", () => {
  const { players } = calculateUsageScores(buildPlayerWeeks(statsByWeek, { teamOf, positionOf }));
  const byId = Object.fromEntries(players.map(player => [player.playerId, player]));
  assert.ok(byId["T-WR-alpha"].usageScore > byId["T-WR-beta"].usageScore);
  assert.equal(byId["T-WR-alpha"].signal, "BUY_LOW");
  assert.equal(byId["T-WR-beta"].signal, "SELL_HIGH");
  assert.equal(byId["T-WR-alpha"].targetShare, 50);
});

test("no signal on a single game (not enough evidence)", () => {
  const { players } = calculateUsageScores(buildPlayerWeeks(statsByWeek.slice(0, 1), { teamOf, positionOf }));
  assert.ok(players.every(player => player.signal === null));
});

test("identical usage gets an identical score (ties share the average percentile)", () => {
  const twin = { off_snp: 50, tm_off_snp: 60, rec_tgt: 6, rec_air_yd: 60, pts_ppr: 10 };
  const weeks = [1, 2].map(week => ({ week, stats: { "T-WR-a": { ...twin }, "T-WR-b": { ...twin }, "T-WR-c": { off_snp: 20, tm_off_snp: 60, rec_tgt: 1, pts_ppr: 2 } } }));
  const { players } = calculateUsageScores(buildPlayerWeeks(weeks, { teamOf, positionOf }));
  const byId = Object.fromEntries(players.map(player => [player.playerId, player]));
  assert.equal(byId["T-WR-a"].usageScore, byId["T-WR-b"].usageScore);
  assert.equal(byId["T-WR-c"].usageScore, 0);
});

test("a rarely-used feature keeps its fixed value, and an absurd fit falls back entirely", () => {
  // 40 WR rows, one with a carry: carries must NOT be fitted (the Codex stress case gave 35 pts/carry).
  const rows = Array.from({ length: 40 }, (_, i) => ({ position: "WR", targets: i % 10, carries: i === 0 ? 1 : 0, redZone: i % 3 === 0 ? 1 : 0, airYards: (i % 10) * 9, points: (i % 10) * 1.6 + (i === 0 ? 40 : 0) }));
  const model = fitExpectedPoints(rows).WR;
  assert.equal(model.carries, 0.6);
  assert.ok(model.fixedFeatures.includes("carries"));
  assert.ok(Number.isFinite(model.targets) && model.targets >= 0 && model.targets <= 4);
});

test("air share = share of downfield air yards: always within 0-100 %", () => {
  const weeks = [{ week: 1, stats: { "T-WR-deep": { off_snp: 50, tm_off_snp: 60, rec_tgt: 5, rec_air_yd: 50 }, "T-RB-screen": { off_snp: 30, tm_off_snp: 60, rec_tgt: 3, rec_air_yd: -5 } } }];
  const rows = buildPlayerWeeks(weeks, { teamOf, positionOf });
  const deep = rows.find(row => row.playerId === "T-WR-deep");
  const screen = rows.find(row => row.playerId === "T-RB-screen");
  assert.equal(deep.airShare, 1);
  assert.equal(screen.airShare, 0);
});

test("a week the player spent on another team is excluded (teamOf returns null for it)", () => {
  const weeks = [1, 2].map(week => ({ week, stats: { "X-WR-traded": { off_snp: 50, tm_off_snp: 60, rec_tgt: 8, pts_ppr: 12 } } }));
  const rows = buildPlayerWeeks(weeks, { teamOf: (id, week) => (week === 1 ? null : "X"), positionOf });
  assert.deepEqual(rows.map(row => row.week), [2]);
});
