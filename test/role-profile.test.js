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
  // Présent sur le terrain sans ballon : ce n'est pas un rôle acquis.
  assert.equal(promoted({ gamesPlayed: 3, prevSnapShare: 0.48, prevOpportunities: 1 }), "PURE_RENTAL");
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
  assert.equal(unpriced.waiver.suggestedBid, null);
  assert.ok(run().waiver.decision.actionBlockers.includes("PROGRESSION_SACRIFICE_NOT_JUSTIFIED"));
  const justified = run({ rentalWeekly: 60 });
  assert.equal(justified.waiver.decision.recommendedAction, "ADD_NOW");
  assert.equal(justified.modelMetrics.progressionGuard, "JUSTIFIED");
});

test("0 $ is a real bid: without an executable action the bid is not determined, and says why", () => {
  const { marketRow, ...fitContext } = rentalFixture({ rentalWeekly: 60 });
  const evaluate = availability => createWaiverEvaluator({ fitContext, week: 4, availabilityFor: () => availability, ownershipRechecked: true, transactionsComplete: true })(marketRow);
  const free = evaluate({ availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true, coverageIssues: [] });
  assert.deepEqual([free.waiver.decision.recommendedAction, free.waiver.bidStatus, free.waiver.suggestedBid], ["ADD_NOW", "FREE_ADD", 0]);
  const unknown = evaluate({ availability: "UNKNOWN", canAddNow: false, canStartTargetWeek: null, coverageIssues: ["WAIVER_STATE_UNVERIFIED"] });
  assert.deepEqual([unknown.waiver.decision.recommendedAction, unknown.waiver.bidStatus, unknown.waiver.suggestedBid, unknown.waiver.bidUndeterminedReason],
    ["WATCH", "NOT_DETERMINED", null, "AVAILABILITY_UNVERIFIED"]);
  assert.equal(unknown.waiver.bidPctRemaining, null);
  // La valeur pour le roster reste affichée : c'est la faisabilité qui manque, pas l'évaluation.
  assert.ok(unknown.waiver.personalMaxBid > 0);
});

test("an organically rising role is watched, never ignored; its upside is shown beside the gain, not inside it", () => {
  const myPlayers = [12, 11, 10, 9, 8, 7].map((points, i) => ({ sleeperId: `s${i}`, name: `S${i}`, position: "WR", nflTeam: "BBB", usageScore: 50, projectedPpg: points }));
  const weekly = Object.fromEntries(myPlayers.map(p => [p.sleeperId, p.projectedPpg]));
  const fitContext = { myPlayers, faabRemaining: 100, paceOf: p => weekly[p.sleeperId] ?? 0, weeklyPaceOf: p => weekly[p.sleeperId] ?? 3, projectionCovered: () => true };
  const base = { sleeperId: "c", name: "Candidate", position: "WR", nflTeam: "AAA", surplusPoints: 0, faabMarket: [0, 0], marketScore: 5, signals: {}, events: { flags: [] } };
  const evaluate = row => createWaiverEvaluator({ fitContext, week: 4, availabilityFor: () => ({ availability: "UNKNOWN", coverageIssues: [] }), ownershipRechecked: true, transactionsComplete: true })(row);
  const flat = evaluate({ ...base, emergingRole: { progression: "STABLE", xfpDelta: 0.2 } });
  assert.equal(flat.waiver.decision.recommendedAction, "IGNORE");
  assert.equal(flat.waiver.unpricedPotential, null);
  const rising = evaluate({ ...base, emergingRole: { progression: "RISING", progressionSource: "ORGANIC", xfpDelta: 5.6, weeksCompared: [2, 3, 4] } });
  assert.equal(rising.waiver.decision.recommendedAction, "WATCH");
  assert.equal(rising.waiver.decision.watchReason, "ORGANIC_RISE_NOT_PRICED");
  assert.deepEqual(rising.waiver.unpricedPotential, { xfpDeltaPerWeek: 5.6, source: "ORGANIC", weeksCompared: [2, 3, 4], includedInGain: false, calibrated: false });
  assert.equal(rising.waiver.fit.netGainTotal, flat.waiver.fit.netGainTotal);
  // Une hausse qui coïncide avec une absence n'obtient pas ce traitement.
  assert.equal(evaluate({ ...base, emergingRole: { progression: "RISING", progressionSource: "COINCIDES_WITH_TEAMMATE_ABSENCE", xfpDelta: 5.6 } }).waiver.decision.recommendedAction, "IGNORE");
});

test("a promotion on top of an existing role is valued on the rest of the season, a pure rental on its window", () => {
  const fixture = rentalFixture();
  const rental = evaluateRosterFit(fixture);
  assert.deepEqual([rental.horizonWeeks, rental.horizonBasis], [1, "TEMPORARY_ROLE_WINDOW"]);
  const existing = evaluateRosterFit({ ...fixture, marketRow: { ...fixture.marketRow, roleProfile: { profile: "INJURY_PROMOTION_WITH_EXISTING_ROLE" } } });
  assert.deepEqual([existing.horizonWeeks, existing.horizonBasis], [LAST_REGULAR_WEEK - 3, "EXISTING_ROLE_REST_OF_SEASON"]);
  assert.equal(existing.progressionGuard, "NOT_APPLICABLE");
});
