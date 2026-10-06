import test from "node:test";
import assert from "node:assert/strict";
import { buildEmergingRole, classifyRoleProfile, ROLE_PROFILES, ROLE_PROFILE_THRESHOLDS } from "../public/assets/role-profile.js";
import { buildOpportunitySignals, evaluateRosterFit, LAST_REGULAR_WEEK } from "../public/assets/waiver-model.js";
import { createWaiverEvaluator } from "../scripts/waiver-evaluator.js";

// Fixtures fictives : aucune ne décrit un joueur ou un événement NFL réel.
const week = (n, snapShare, targets, carries = 0) => ({ week: n, played: true, snapShare, targets, opportunities: targets + carries });

test("emerging role: dated deltas, routes never imputed, organic vs coinciding absence", () => {
  const series = [week(1, 0.3, 3), week(2, 0.45, 5), week(3, 0.6, 8)];
  const xfpByWeek = { 1: 4, 2: 6.5, 3: 9.5 };
  const organic = buildEmergingRole({ series, xfpByWeek });
  assert.deepEqual(organic.weeksCompared, [1, 2, 3]);
  assert.equal(organic.xfpDelta, 4.3);
  assert.equal(organic.targetsDelta, 4);
  assert.equal(organic.snapShareDelta, 0.225);
  assert.equal(organic.consecutiveRises, 2);
  assert.equal(organic.progression, "RISING");
  assert.equal(organic.progressionSource, "ORGANIC");
  assert.equal(organic.optionValuePerWeek, 4.3);
  assert.equal(organic.routesDelta, null);
  assert.equal(organic.routesSource, null);
  assert.equal(organic.calibrated, false);

  const mixed = buildEmergingRole({ series, xfpByWeek, absenceTriggers: [{ trigger: "SNAPSHOT_STATUS" }] });
  assert.equal(mixed.progressionSource, "COINCIDES_WITH_TEAMMATE_ABSENCE");

  assert.equal(buildEmergingRole({ series: [week(3, 0.9, 10)], xfpByWeek: { 3: 12 } }).progression, "INSUFFICIENT_DATA");
  assert.equal(buildEmergingRole({ series: [week(3, 0.9, 10)], xfpByWeek: { 3: 12 } }).optionValuePerWeek, null);
  // Snaps en hausse sans modèle xFP : pas de progression chiffrée, pas de proxy.
  assert.equal(buildEmergingRole({ series }).progression, "INSUFFICIENT_DATA");
  const falling = buildEmergingRole({ series: [week(1, 0.6, 8), week(2, 0.3, 3)], xfpByWeek: { 1: 9, 2: 4 } });
  assert.equal(falling.progression, "FALLING");
  assert.equal(falling.optionValuePerWeek, 0);
  // Jours sans match ignorés : seules les semaines jouées sont comparées.
  assert.deepEqual(buildEmergingRole({ series: [week(1, 0.3, 3), { week: 2, played: false }, week(3, 0.5, 6)], xfpByWeek: { 1: 4, 3: 7 } }).weeksCompared, [1, 3]);
});

test("buildOpportunitySignals exposes the dated series used by the trend", () => {
  const stats = n => ({ p: { off_snp: 10 * n, tm_off_snp: 60, rec_tgt: n, rush_att: 0, pts_ppr: n } });
  const signals = buildOpportunitySignals("p", [{ week: 1, stats: stats(1) }, { week: 2, stats: {} }, { week: 3, stats: stats(3) }]);
  assert.deepEqual(signals.series.map(row => [row.week, row.played]), [[1, true], [2, false], [3, true]]);
});

test("role profile is a separate dimension: five profiles, null when no role story", () => {
  assert.equal(ROLE_PROFILES.length, 5);
  assert.equal(ROLE_PROFILE_THRESHOLDS.calibrated, false);
  const promoted = signals => classifyRoleProfile({ flags: ["PROMOTION"], signals }).profile;
  assert.equal(promoted({ gamesPlayed: 3, prevSnapShare: 0.45, prevOpportunities: 6 }), "INJURY_PROMOTION_WITH_EXISTING_ROLE");
  assert.equal(promoted({ gamesPlayed: 3, prevSnapShare: 0.05, prevOpportunities: 1 }), "PURE_RENTAL");
  assert.equal(promoted({ gamesPlayed: 1, prevSnapShare: null, prevOpportunities: null }), "UNCERTAIN");

  const rising = { progression: "RISING", progressionSource: "ORGANIC", consecutiveRises: 2 };
  assert.equal(classifyRoleProfile({ emergingRole: rising }).profile, "ROLE_EXPANSION");
  assert.equal(classifyRoleProfile({ emergingRole: { ...rising, consecutiveRises: 1 } }).profile, "BREAKOUT");
  assert.equal(classifyRoleProfile({ flags: ["SNAP_SURGE"], emergingRole: { progression: "STABLE" } }).profile, "BREAKOUT");
  assert.equal(classifyRoleProfile({ emergingRole: { ...rising, progressionSource: "COINCIDES_WITH_TEAMMATE_ABSENCE" } }).profile, "UNCERTAIN");
  assert.equal(classifyRoleProfile({ emergingRole: { progression: "STABLE" } }).profile, null);
});

// Harris → Jennings (forme du cas, données fictives) : couper une progression organique pour une location.
const rentalFixture = ({ rentalWeekly = 14, optionValuePerWeek = 2 } = {}) => {
  const riser = { sleeperId: "riser", name: "Riser", position: "WR", nflTeam: "AAA", usageScore: 50, projectedPpg: 6,
    emergingRole: { progression: "RISING", progressionSource: "ORGANIC", optionValuePerWeek, consecutiveRises: 2 } };
  // Quatre titulaires au-dessus de lui : le couper ne coûte aucun point de lineup projeté.
  const starters = [12, 11, 10, 9].map((points, i) => ({ sleeperId: `s${i + 1}`, name: `Starter ${i + 1}`, position: "WR", nflTeam: "BBB", usageScore: 50, projectedPpg: points }));
  const myPlayers = [riser, ...starters];
  const weekly = { riser: 6, rental: rentalWeekly, ...Object.fromEntries(starters.map(p => [p.sleeperId, p.projectedPpg])) };
  return { marketRow: { sleeperId: "rental", name: "Rental", position: "WR", nflTeam: "DDD", surplusPoints: 40, faabMarket: [10, 40], marketScore: 70,
      signals: {}, events: { flags: [], roleWeeks: 1 } },
    myPlayers, week: 4, faabRemaining: 100, paceOf: p => weekly[p.sleeperId] ?? 0, weeklyPaceOf: p => weekly[p.sleeperId] ?? null,
    projectionCovered: p => Number.isFinite(weekly[p.sleeperId]), starterIds: new Set(starters.map(p => p.sleeperId)), lockedIds: new Set(starters.map(p => p.sleeperId)) };
};

test("progression vs rental: the cut needs a documented net gain above the organic-rise cost, no absolute ban", () => {
  const remaining = LAST_REGULAR_WEEK - 3;
  const notJustified = evaluateRosterFit(rentalFixture());
  assert.equal(notJustified.horizonWeeks, 1);
  assert.equal(notJustified.dropCandidate.sleeperId, "riser");
  assert.equal(notJustified.progressionSacrificeTotal, 2 * remaining);
  assert.equal(notJustified.progressionGuard, "NOT_JUSTIFIED");
  // netGainTotal garde sa définition ; seul le score de sélection porte le sacrifice.
  assert.ok(notJustified.netGainTotal > 0);
  assert.ok(notJustified.selectionScore < 0);
  assert.equal(notJustified.faabMaxForMe, 0);

  const justified = evaluateRosterFit(rentalFixture({ rentalWeekly: 60 }));
  assert.equal(justified.progressionGuard, "JUSTIFIED");
  assert.ok(justified.selectionScore > 0);

  const unpriced = evaluateRosterFit(rentalFixture({ optionValuePerWeek: null }));
  assert.equal(unpriced.progressionGuard, "UNPRICED");
  assert.equal(unpriced.progressionSacrificeTotal, null);

  // Acquisition durable : la comparaison location/progression ne s'applique pas.
  const seasonLong = rentalFixture();
  seasonLong.marketRow.events.roleWeeks = 0;
  assert.equal(evaluateRosterFit(seasonLong).progressionGuard, "NOT_APPLICABLE");
});

test("an unjustified or unpriced progression sacrifice downgrades an actionable move to WATCH with a blocker", () => {
  const availability = { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true, coverageIssues: [] };
  const run = options => {
    const { marketRow, ...fitContext } = rentalFixture(options);
    return createWaiverEvaluator({ fitContext, week: 4, availabilityFor: () => availability, ownershipRechecked: true, transactionsComplete: true })(marketRow);
  };
  const unpriced = run({ optionValuePerWeek: null });
  assert.equal(unpriced.waiver.decision.recommendedAction, "WATCH");
  assert.ok(unpriced.waiver.decision.actionBlockers.includes("PROGRESSION_SACRIFICE_UNPRICED"));
  assert.equal(unpriced.waiver.suggestedBid, 0);
  assert.ok(run().waiver.decision.actionBlockers.includes("PROGRESSION_SACRIFICE_NOT_JUSTIFIED"));
  const justified = run({ rentalWeekly: 60 });
  assert.equal(justified.waiver.decision.recommendedAction, "ADD_NOW");
  assert.equal(justified.modelMetrics.progressionGuard, "JUSTIFIED");
});
