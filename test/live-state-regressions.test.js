import test from "node:test";
import assert from "node:assert/strict";
import { findRecentDrops, nextWeekHorizon, resolveAcquisitionAvailability, summarizeRecentTransactions } from "../public/assets/acquisition-availability.js";
import { evaluateMarket, evaluateRosterFit, LAST_REGULAR_WEEK } from "../public/assets/waiver-model.js";
import { extractDecisionFeatures } from "../scripts/decision-features.js";
import { createWaiverEvaluator, evaluateNextUnlockScenario } from "../scripts/waiver-evaluator.js";

// Fixtures fictives : aucun identifiant, nom ou événement ne décrit un fait NFL réel.
const asOf = "2026-10-05T12:00:00Z";
const at = iso => Date.parse(iso);
const scope = { asOf, week: 4, season: "2026", leagueId: "L" };
const player = (id, position, nflTeam, extra = {}) => [id, { id, name: `Player ${id}`, position, nflTeam, active: true, injuryStatus: null, ...extra }];
const weeks = Array.from({ length: LAST_REGULAR_WEEK - 3 }, (_, i) => 4 + i);
const projections = byId => Object.fromEntries(weeks.map(w => [w, Object.fromEntries(Object.entries(byId).map(([id, pts]) => [id, { pts_ppr: pts }]))]));
const features = overrides => extractDecisionFeatures({ index: new Map(), catalog: { players: [] }, rosters: [], nflState: {}, projectionsByWeek: {},
  statsByWeek: [], fetchedAtByPath: {}, roleEvidenceById: {}, lastCompletedWeek: 3, ...scope, ...overrides });

test("recent drops: the latest complete movement decides, and a drop never proves clearance", () => {
  const transactions = [
    { transaction_id: "t1", status: "complete", status_updated: at("2026-10-04T10:00:00Z"), drops: { cut: 1, readded: 1 } },
    { transaction_id: "t2", status: "complete", status_updated: at("2026-10-04T12:00:00Z"), adds: { readded: 2 } },
    { transaction_id: "t3", status: "failed", status_updated: at("2026-10-04T13:00:00Z"), drops: { failed: 3 } },
    { transaction_id: "t4", status: "complete", status_updated: at("2026-09-20T13:00:00Z"), drops: { old: 3 } }
  ];
  const drops = findRecentDrops(transactions, { asOf });
  assert.deepEqual([...drops.keys()], ["cut"]);
  assert.equal(drops.get("cut").droppedByRosterId, 1);

  const unverified = resolveAcquisitionAvailability({ playerId: "cut", rosters: [], asOf, recentDrop: drops.get("cut") });
  assert.equal(unverified.availability, "UNKNOWN");
  assert.equal(unverified.canAddNow, false);
  assert.ok(unverified.coverageIssues.includes("RECENT_DROP_CLEARANCE_UNVERIFIED"));

  // Washington/Wilson : l'ADD par un autre roster l'emporte sur la coupe, quel que soit l'historique.
  const owned = resolveAcquisitionAvailability({ playerId: "cut", rosters: [{ roster_id: 2, players: ["cut"] }], asOf, recentDrop: drops.get("cut") });
  assert.equal(owned.availability, "ROSTERED");
  assert.equal(owned.recentDrop, null);

  const evidence = { availability: "WAIVER_LOCKED", source: "https://example.com/obs", observedAt: "2026-10-05T09:00:00Z", expiresAt: "2026-10-05T18:00:00Z", waiverProcessesAt: "2026-10-07T07:00:00Z" };
  const locked = resolveAcquisitionAvailability({ playerId: "cut", rosters: [], evidence, asOf, recentDrop: drops.get("cut"), latestTransactionAt: at("2026-10-04T10:00:00Z") });
  assert.equal(locked.availability, "WAIVER_LOCKED");
  assert.ok(!locked.coverageIssues.includes("RECENT_DROP_CLEARANCE_UNVERIFIED"));

  const summary = summarizeRecentTransactions(transactions, { asOf, availabilityOf: () => locked });
  assert.equal(summary.recentTransactions.flatMap(t => t.movements).find(m => m.playerId === "cut").availability, "WAIVER_LOCKED");
});

test("pool: a recent cut and a sourced event enter without projection, unpriced and pinned; exclusions are counted", () => {
  const index = new Map([
    player("dropped", "WR", "AAA"), player("returning", "WR", "BBB", { injuryStatus: "IR" }), player("mate", "WR", "BBB"),
    player("silent", "WR", "CCC"), player("hurt", "RB", "CCC", { injuryStatus: "Out" }), player("owned", "QB", "CCC"),
    player("lb", "LB", "CCC"), player("projected", "WR", "DDD")
  ]);
  const event = { type: "RETURN", nflTeam: "BBB", positions: ["WR"], source: "https://example.com/dated", observedAt: "2026-10-05T09:00:00Z", expiresAt: "2026-10-06T09:00:00Z", targetWeek: 4, season: "2026", leagueId: "L" };
  const result = features({ index, rosters: [{ roster_id: 1, players: ["owned"] }], eventsById: { returning: event },
    projectionsByWeek: projections({ projected: 9, mate: 6 }),
    allTransactions: [{ transaction_id: "t", status: "complete", status_updated: at("2026-10-04T10:00:00Z"), drops: { dropped: 1 } }] });
  const byId = new Map(result.rows.map(row => [row.sleeperId, row]));

  assert.deepEqual(byId.get("dropped").poolEntry.reasons, ["RECENT_DROP"]);
  assert.deepEqual(byId.get("returning").poolEntry.reasons, ["SOURCED_EVENT"]);
  for (const id of ["dropped", "returning"]) {
    assert.equal(byId.get(id).poolEntry.pinned, true);
    assert.equal(byId.get(id).valuationCovered, false);
    assert.equal(byId.get(id).rosPpg, null);
    assert.equal(byId.get(id).effectivePpg, null);
  }
  // Ripple : le coéquipier est signalé à réévaluer, sans part ni succession ; il n'entre pas « grâce » à l'événement.
  assert.deepEqual(byId.get("mate").ripple.map(row => [row.trigger, row.triggerPlayerId, row.shareAttributed, row.successionInferred]), [["SNAPSHOT_STATUS", "returning", null, false], ["SOURCED_EVENT", "returning", null, false]]);
  assert.deepEqual(byId.get("mate").poolEntry.reasons, ["PROJECTION"]);
  assert.equal(byId.get("projected").ripple.length, 0);
  assert.equal(byId.has("silent"), false);
  assert.deepEqual(result.poolCoverage.excluded, { ROSTERED: 1, INACTIVE_OR_NO_NFL_TEAM: 0, NON_FANTASY_POSITION: 1, STATUS_ALERT: 1, NO_PROJECTION_OR_STATS: 1 });
  assert.equal(result.poolCoverage.unvalued, 2);

  const market = evaluateMarket({ rows: result.rows, week: 4 });
  const unpriced = market.find(row => row.sleeperId === "returning");
  assert.equal(unpriced.faabMarket, null);
  assert.equal(unpriced.surplusPoints, null);
  assert.equal(market.at(0).valuationCovered, true);

  // Douglas : analysé, jamais chiffré ni actionnable.
  const myPlayers = [{ sleeperId: "b", name: "Bench", position: "WR", nflTeam: "EEE" }];
  const weekly = { b: 5 };
  const fitContext = { myPlayers, paceOf: p => weekly[p.sleeperId] ?? 0, weeklyPaceOf: p => weekly[p.sleeperId] ?? null,
    projectionCovered: p => Number.isFinite(weekly[p.sleeperId]), faabRemaining: 100 };
  const evaluated = createWaiverEvaluator({ fitContext, week: 4, availabilityFor: () => resolveAcquisitionAvailability({ playerId: "returning", rosters: [], asOf }),
    ownershipRechecked: true, transactionsComplete: true })(unpriced);
  assert.equal(evaluated.waiver.fit.netGainTotal, null);
  assert.equal(evaluated.waiver.suggestedBid, 0);
  assert.ok(["WATCH", "IGNORE"].includes(evaluated.waiver.decision.recommendedAction));
  assert.ok(evaluated.waiver.decision.actionBlockers.includes("NO_PROJECTION"));
});

test("fantasy transactions never create a ripple; an event with another team than the snapshot is rejected", () => {
  const index = new Map([player("a", "WR", "AAA"), player("b", "WR", "AAA")]);
  const base = { type: "INJURY", positions: ["WR"], source: "https://example.com/dated", observedAt: "2026-10-05T09:00:00Z", expiresAt: "2026-10-06T09:00:00Z", targetWeek: 4, season: "2026", leagueId: "L" };
  const added = features({ index, projectionsByWeek: projections({ a: 8, b: 7 }),
    allTransactions: [{ transaction_id: "t", status: "complete", status_updated: at("2026-10-04T10:00:00Z"), drops: { a: 1 } }] });
  assert.ok(added.rows.every(row => row.ripple.length === 0));
  const mismatch = features({ index, projectionsByWeek: projections({ a: 8, b: 7 }), eventsById: { a: { ...base, nflTeam: "ZZZ" } } });
  assert.ok(mismatch.rows.every(row => row.ripple.length === 0));
  assert.deepEqual(mismatch.poolCoverage.rippleIssues.map(row => row.code), ["EVENT_TEAM_MISMATCH"]);
});

const fitFixture = (overrides = {}) => {
  const myPlayers = [
    { sleeperId: "4035", name: "Low Id", position: "RB", nflTeam: "AAA", usageScore: 60, projectedPpg: 9.7 },
    { sleeperId: "9000", name: "High Id", position: "RB", nflTeam: "BBB", usageScore: null, projectedPpg: null },
    { sleeperId: "5000", name: "Starter", position: "RB", nflTeam: "CCC", usageScore: 80, projectedPpg: 15 },
    { sleeperId: "7000", name: "Reserve", position: "WR", nflTeam: "DDD", injuryStatus: "IR" }
  ];
  const weekly = { 4035: 9, 9000: 4, 5000: 15, new: 11, ...overrides.weekly };
  return { marketRow: { sleeperId: "new", name: "New", position: "RB", nflTeam: "EEE", surplusPoints: 30, faabMarket: [10, 30], events: {} },
    myPlayers, week: 4, faabRemaining: 100, paceOf: p => weekly[p.sleeperId] ?? 0,
    weeklyPaceOf: p => weekly[p.sleeperId] ?? null, projectionCovered: p => Number.isFinite(weekly[p.sleeperId]),
    protectedIds: new Set(["7000"]), reserveIds: new Set(["7000"]), ...overrides.fit };
};

test("Kamara: an uncovered horizon designates no cut instead of the smallest player id", () => {
  // Sans la règle « réserve non titularisable », le joueur IR sans projection bloque tout l'horizon.
  const blocked = evaluateRosterFit(fitFixture({ fit: { reserveIds: new Set() } }));
  assert.equal(blocked.horizonCovered, false);
  assert.equal(blocked.dropCandidate, null);
  assert.equal(blocked.cutSelection, "UNRANKED_INCOMPLETE_COVERAGE");
  assert.equal(blocked.dropCostPerWeek, null);
  assert.deepEqual([...new Set(blocked.coverageBlockers.map(row => row.name))], ["Reserve"]);
  assert.ok(blocked.dropCandidates.every(row => row.ranked === false));
});

test("Kamara: with coverage, the cut is ranked on net gain and every cost component is explained", () => {
  const fit = evaluateRosterFit(fitFixture());
  assert.equal(fit.horizonCovered, true);
  assert.deepEqual(fit.assumptions, ["RESERVE_PLAYERS_NOT_STARTABLE"]);
  assert.equal(fit.cutSelection, "RANKED_BY_NET_GAIN");
  assert.equal(fit.dropCandidate.sleeperId, "9000");
  assert.equal(fit.comparedCutCount, 3);
  assert.deepEqual(fit.cutExclusions, [{ playerId: "7000", name: "Reserve", reason: "RESERVE_SLOT" }]);
  const lowId = fit.dropCandidates.find(row => row.sleeperId === "4035").dropCostComponents;
  assert.equal(lowId.usagePremiumPerWeek, 0.3);
  assert.equal(lowId.projectionUpsidePerWeek, 0.1);
  assert.equal(lowId.optionValuePerWeek, 0.4);
  assert.equal(lowId.optionCoverage, "COMPLETE");
  assert.equal(lowId.lineupLossIncludedInGross, true);
  // Entrées manquantes : option inconnue, jamais présentée comme faible.
  const highId = fit.dropCandidates.find(row => row.sleeperId === "9000");
  assert.deepEqual(highId.dropCostComponents.missingInputs, ["USAGE_SCORE", "WEEK_PROJECTION"]);
  assert.equal(highId.regretRisk, "UNKNOWN");
});

test("Kamara: a lone unlocked player is reported as the only eligible cut, not as a ranking", () => {
  const fit = evaluateRosterFit(fitFixture({ fit: { lockedIds: new Set(["9000", "5000"]) } }));
  assert.equal(fit.cutSelection, "ONLY_ELIGIBLE_CUT");
  assert.equal(fit.dropCandidate.sleeperId, "4035");
  assert.deepEqual(fit.cutExclusions.map(row => row.reason).sort(), ["GAME_LOCKED_OR_KICKOFF_UNKNOWN", "GAME_LOCKED_OR_KICKOFF_UNKNOWN", "RESERVE_SLOT"]);
});

test("GAME_LOCKED: the current action stays blocked; the next-week scenario is separate, dated and indicative", () => {
  const schedule = [{ week: 4, away_team: "EEE", home_team: "AAA", kickoffAt: "2026-10-04T17:00:00Z", source: "s" },
    { week: 5, away_team: "EEE", home_team: "BBB", kickoffAt: "2026-10-11T17:00:00Z", source: "s" }];
  const { marketRow, ...fitContext } = fitFixture();
  const horizonFor = row => nextWeekHorizon({ schedule, week: 4, nflTeam: row.nflTeam });
  const lockedNow = evidence => resolveAcquisitionAvailability({ playerId: "new", rosters: [], evidence, kickoffAt: schedule[0].kickoffAt, asOf, ...scope });
  const evaluate = availability => createWaiverEvaluator({ fitContext, week: 4, availabilityFor: () => availability, ownershipRechecked: true, transactionsComplete: true, horizonFor })({ ...marketRow, marketScore: 60, signals: {}, events: { flags: [] } });

  const unverified = evaluate(lockedNow());
  assert.equal(unverified.availability.availability, "GAME_LOCKED");
  assert.equal(unverified.waiver.decision.recommendedAction, "WATCH");
  assert.ok(unverified.waiver.decision.actionBlockers.includes("GAME_LOCKED"));
  assert.equal(unverified.waiver.suggestedBid, 0);
  const scenario = unverified.nextUnlockScenario;
  assert.equal(scenario.status, "EVALUATED");
  assert.equal(scenario.executableNow, false);
  assert.equal(scenario.startWeek, 5);
  assert.equal(scenario.firstKickoffAt, "2026-10-11T17:00:00Z");
  assert.equal(scenario.unlockVerified, false);
  assert.ok(scenario.coverageIssues.includes("UNLOCK_UNVERIFIED"));
  assert.equal(scenario.horizonWeeks, LAST_REGULAR_WEEK - 4);
  assert.equal(scenario.weeklyLineupDeltas[0].week, 5);
  assert.ok(Number.isFinite(scenario.netGainTotal));
  assert.ok(Number.isInteger(scenario.indicativeMaxBid));

  const evidence = { availability: "WAIVER_LOCKED", source: "https://example.com/obs", observedAt: "2026-10-05T09:00:00Z", expiresAt: "2026-10-05T18:00:00Z", waiverProcessesAt: "2026-10-07T07:00:00Z", targetWeek: 4, season: "2026", leagueId: "L" };
  const verified = evaluate(lockedNow(evidence)).nextUnlockScenario;
  assert.equal(verified.unlockVerified, true);
  assert.equal(verified.unlockAt, "2026-10-07T07:00:00Z");

  // Aucun gain futur inventé : calendrier inconnu, ou location terminée avant le déblocage.
  const noSchedule = evaluateNextUnlockScenario({ row: marketRow, availability: lockedNow(), rosterContext: fitContext, week: 4 });
  assert.equal(noSchedule.status, "HORIZON_UNKNOWN");
  assert.equal(noSchedule.netGainTotal, null);
  const rental = evaluateNextUnlockScenario({ row: { ...marketRow, events: { roleWeeks: 1 } }, availability: lockedNow(), rosterContext: fitContext, week: 4, horizonFor });
  assert.equal(rental.status, "ROLE_WINDOW_ENDS_BEFORE_UNLOCK");
  assert.equal(rental.indicativeMaxBid, null);
  const longer = evaluateNextUnlockScenario({ row: { ...marketRow, events: { roleWeeks: 3 } }, availability: lockedNow(), rosterContext: fitContext, week: 4, horizonFor });
  assert.equal(longer.horizonWeeks, 2);
  assert.equal(evaluateNextUnlockScenario({ row: marketRow, availability: { availability: "FREE_AGENT" }, rosterContext: fitContext, week: 4, horizonFor }), null);
});
