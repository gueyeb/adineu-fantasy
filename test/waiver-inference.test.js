import test from "node:test";
import assert from "node:assert/strict";
import { deriveWaiverRules, inferWaiverState, resolveAcquisitionAvailability, weeklyWaiverRuns } from "../public/assets/acquisition-availability.js";
import { createWaiverEvaluator } from "../scripts/waiver-evaluator.js";
import { buildCoherenceWarnings } from "../public/assets/decision-coherence.js";

// Réglages au format Sleeper et historique fictif : aucune transaction réelle.
const settings = { waiver_type: 2, daily_waivers: 0, waiver_day_of_week: 2, daily_waivers_hour: 0, waiver_clear_days: 1 };
const at = iso => Date.parse(iso);
const batch = (iso, count = 4) => Array.from({ length: count }, (_, i) => ({ transaction_id: `${iso}-${i}`, type: "waiver", status: "complete", status_updated: at(iso) + i * 1000 }));
// Mercredi 00:09 Pacific : 07:09 UTC en heure d'été, 08:09 UTC en heure d'hiver.
const history = [...batch("2026-09-16T07:09:00Z"), ...batch("2026-09-23T07:09:00Z"), ...batch("2026-09-30T07:09:00Z")];
const rules = deriveWaiverRules({ leagueSettings: settings, transactions: history });
const schedule = [
  { week: 4, away_team: "AAA", home_team: "BBB", kickoffAt: "2026-10-04T17:00:00Z" },
  { week: 5, away_team: "AAA", home_team: "CCC", kickoffAt: "2026-10-11T17:00:00Z" },
  { week: 5, away_team: "BBB", home_team: "DDD", kickoffAt: "2026-10-08T00:15:00Z" }
];
const resolve = (asOf, extra = {}) => resolveAcquisitionAvailability({ playerId: "p", rosters: [], asOf, nflTeam: "AAA", schedule, waiverRules: rules,
  kickoffAt: "2026-10-11T17:00:00Z", week: 5, season: "2026", leagueId: "L", ...extra });

test("waiver rules come from Sleeper's settings and are accepted only when the league's history confirms them", () => {
  assert.deepEqual([rules.clearDay, rules.clearTime, rules.clearDays, rules.source], ["Wednesday", "00:00 America/Los_Angeles", 1, "SLEEPER_LEAGUE_SETTINGS"]);
  assert.equal(rules.validation.confirmedWeeklyBatches, 3);
  // Ambigu : historique insuffisant, contredit, ou réglages d'un autre type de waivers.
  assert.equal(deriveWaiverRules({ leagueSettings: settings, transactions: batch("2026-09-16T07:09:00Z") }), null);
  assert.equal(deriveWaiverRules({ leagueSettings: settings, transactions: [...history, ...batch("2026-09-24T19:00:00Z")] }), null);
  assert.equal(deriveWaiverRules({ leagueSettings: { ...settings, daily_waivers: 1 }, transactions: history }), null);
  assert.equal(deriveWaiverRules({ leagueSettings: { ...settings, waiver_type: 0 }, transactions: history }), null);
  assert.equal(deriveWaiverRules({ leagueSettings: null, transactions: history }), null);
  // Les traitements isolés (fin de blocage d'une coupe) ne comptent ni pour ni contre.
  assert.ok(deriveWaiverRules({ leagueSettings: settings, transactions: [...history, ...batch("2026-09-17T06:19:00Z", 2)] }));
});

test("the weekly run follows Pacific time across both daylight-saving changes", () => {
  const run = asOf => weeklyWaiverRuns({ asOf, ...rules }).nextRunAt;
  assert.equal(run("2026-10-06T12:00:00Z"), "2026-10-07T07:00:00.000Z");
  // Europe déjà en heure d'hiver, Pacifique encore en heure d'été : toujours 07:00 UTC.
  assert.equal(run("2026-10-27T12:00:00Z"), "2026-10-28T07:00:00.000Z");
  assert.equal(run("2026-11-03T12:00:00Z"), "2026-11-04T08:00:00.000Z");
  assert.equal(weeklyWaiverRuns({ asOf: "2026-10-07T07:00:00Z", ...rules }).lastRunAt, "2026-10-07T07:00:00.000Z");
});

test("boundaries: weekly run, kickoff, recent drop, end of lock, owned player", () => {
  // Avant le passage hebdomadaire : son équipe a joué depuis le dernier passage.
  const before = resolve("2026-10-07T06:59:00Z");
  assert.deepEqual([before.availability, before.availabilitySource, before.verified, before.canAddNow, before.canStartTargetWeek],
    ["WAIVER_LOCKED", "LEAGUE_RULES_INFERRED", false, false, true]);
  assert.equal(before.waiverProcessesAt, "2026-10-07T07:00:00.000Z");
  assert.equal(before.inference.rule, "KICKOFF_SINCE_LAST_WEEKLY_RUN");
  assert.ok(before.coverageIssues.includes("AVAILABILITY_INFERRED_NOT_VERIFIED"));
  // Pendant le traitement (résultats observés ~9 min après l'heure, marge de 5 min) : pas encore libre.
  assert.equal(rules.processingMinutes, 15);
  const running = resolve("2026-10-07T07:00:00Z");
  assert.deepEqual([running.availability, running.canAddNow, running.inference.rule, running.inference.processing, running.waiverProcessesAt],
    ["WAIVER_LOCKED", false, "WEEKLY_RUN_IN_PROGRESS", true, "2026-10-07T07:15:00.000Z"]);
  assert.equal(resolve("2026-10-07T07:14:59Z").availability, "WAIVER_LOCKED");
  // Traitement terminé : libre, jusqu'à son kickoff.
  const after = resolve("2026-10-07T07:15:00Z");
  assert.deepEqual([after.availability, after.canAddNow, after.canStartTargetWeek, after.inference.rule], ["FREE_AGENT", true, true, "CLEARED_AT_LAST_WEEKLY_RUN"]);
  assert.equal(resolve("2026-10-11T16:59:00Z").availability, "FREE_AGENT");
  // Kickoff : verrouillé, prochain passage déduit pour le scénario suivant.
  const locked = resolve("2026-10-11T17:00:00Z");
  assert.deepEqual([locked.availability, locked.availabilitySource, locked.canAddNow, locked.waiverProcessesAt, locked.waiverProcessesAtSource],
    ["GAME_LOCKED", "SCHEDULE", false, "2026-10-14T07:00:00.000Z", "LEAGUE_RULES_INFERRED"]);
  // Coupe récente : en waivers pendant clearDays, borne haute, puis libre.
  const drop = { droppedAt: "2026-10-08T10:00:00.000Z", droppedByRosterId: 2 };
  const dropped = resolve("2026-10-09T09:59:00Z", { recentDrop: drop });
  assert.deepEqual([dropped.availability, dropped.inference.rule, dropped.waiverProcessesAt, dropped.canStartTargetWeek], ["WAIVER_LOCKED", "RECENT_DROP_CLEAR_DAYS", "2026-10-09T10:00:00.000Z", true]);
  assert.ok(!dropped.coverageIssues.includes("RECENT_DROP_CLEARANCE_UNVERIFIED"));
  assert.equal(resolve("2026-10-09T10:00:00Z", { recentDrop: drop }).availability, "FREE_AGENT");
  // Coupé avant le passage alors que son équipe a joué : la plus tardive des deux échéances.
  const both = resolve("2026-10-07T06:00:00Z", { recentDrop: { droppedAt: "2026-10-06T20:00:00.000Z" } });
  assert.equal(both.waiverProcessesAt, "2026-10-07T20:00:00.000Z");
  // Déjà détenu : la propriété courante prime sur toute déduction.
  const owned = resolve("2026-10-07T08:00:00Z", { rosters: [{ roster_id: 3, players: ["p"] }] });
  assert.deepEqual([owned.availability, owned.availabilitySource, owned.inference, owned.canAddNow], ["ROSTERED", "CURRENT_OWNERSHIP", null, false]);
  // Bye la semaine précédente : aucun kickoff depuis le dernier passage, donc libre même avant le suivant.
  assert.equal(inferWaiverState({ nflTeam: "CCC", schedule, asOf: "2026-10-07T06:00:00Z", waiverRules: rules }).availability, "FREE_AGENT");
});

test("missing data stays UNKNOWN; recent operator evidence wins and expires after a transaction or a kickoff", () => {
  for (const patch of [{ waiverRules: null }, { schedule: [] }, { nflTeam: null }]) {
    const unknown = resolve("2026-10-07T08:00:00Z", patch);
    assert.deepEqual([unknown.availability, unknown.availabilitySource, unknown.canAddNow], ["UNKNOWN", "NONE", false]);
  }
  const evidence = { availability: "WAIVER_LOCKED", source: "https://example.com/obs", observedAt: "2026-10-07T07:30:00Z", expiresAt: "2026-10-08T07:30:00Z",
    waiverProcessesAt: "2026-10-08T09:00:00Z", targetWeek: 5, season: "2026", leagueId: "L" };
  const observed = resolve("2026-10-07T08:00:00Z", { evidence });
  assert.deepEqual([observed.availability, observed.availabilitySource, observed.verified, observed.inference], ["WAIVER_LOCKED", "OPERATOR_EVIDENCE", true, null]);
  // Transaction postérieure à l'observation : retour à l'état déduit.
  assert.equal(resolve("2026-10-07T08:00:00Z", { evidence, latestTransactionAt: at("2026-10-07T07:45:00Z") }).availabilitySource, "LEAGUE_RULES_INFERRED");
  // Observation antérieure au dernier kickoff de son équipe : elle décrit un état révolu.
  const stale = { ...evidence, availability: "FREE_AGENT", observedAt: "2026-10-04T12:00:00Z", expiresAt: "2026-10-09T12:00:00Z" };
  const superseded = resolve("2026-10-06T12:00:00Z", { evidence: stale });
  assert.deepEqual([superseded.availability, superseded.availabilitySource], ["WAIVER_LOCKED", "LEAGUE_RULES_INFERRED"]);
});

test("a deduced availability unlocks a conditional recommendation labelled 'confirm in Sleeper', never a verified one", () => {
  const myPlayers = [{ sleeperId: "k", name: "Kicker", position: "K", nflTeam: "ZZZ", projectedPpg: 8 }];
  const weekly = { k: 8, p: 9 };
  const fitContext = { myPlayers, faabRemaining: 100, hasOpenRosterSlot: true, paceOf: x => weekly[x.sleeperId] ?? 0, weeklyPaceOf: x => weekly[x.sleeperId] ?? null,
    projectionCovered: x => Number.isFinite(weekly[x.sleeperId]) };
  const row = { sleeperId: "p", name: "Defense", position: "DEF", nflTeam: "AAA", surplusPoints: 20, faabMarket: [5, 15], marketScore: 40, signals: {}, events: { flags: [] } };
  const evaluate = asOf => createWaiverEvaluator({ fitContext, week: 5, availabilityFor: () => resolve(asOf), ownershipRechecked: true, transactionsComplete: true })(row);
  const free = evaluate("2026-10-07T08:00:00Z");
  assert.equal(free.waiver.decision.recommendedAction, "ADD_NOW");
  assert.equal(free.waiver.decision.confirmation, "CONFIRM_IN_SLEEPER");
  assert.match(free.waiver.decision.interpretation, /confirm in Sleeper/);
  assert.deepEqual([free.waiver.bidStatus, free.waiver.suggestedBid], ["FREE_ADD", 0]);
  const claim = evaluate("2026-10-07T06:00:00Z");
  assert.equal(claim.waiver.decision.recommendedAction, "CLAIM_IF_CHEAP");
  assert.equal(claim.waiver.bidStatus, "PROPOSED");
  assert.ok(claim.waiver.suggestedBid > 0);
  const coherence = buildCoherenceWarnings({ boardRows: [free] });
  assert.deepEqual(coherence.decisionStatus, { status: "TO_CONFIRM", reasons: ["AVAILABILITY_INFERRED"] });
  assert.equal(coherence.publishable, true);
});

test("ceiling: a founded zero stays zero, an uncalibrated rising role makes it undetermined", () => {
  const myPlayers = [12, 11, 10, 9, 8, 7].map((points, i) => ({ sleeperId: `s${i}`, name: `S${i}`, position: "WR", nflTeam: "BBB", usageScore: 50, projectedPpg: points }));
  const weekly = Object.fromEntries(myPlayers.map(x => [x.sleeperId, x.projectedPpg]));
  const fitContext = { myPlayers, faabRemaining: 100, paceOf: x => weekly[x.sleeperId] ?? 0, weeklyPaceOf: x => weekly[x.sleeperId] ?? 3, projectionCovered: () => true };
  const base = { sleeperId: "c", name: "Candidate", position: "WR", nflTeam: "AAA", surplusPoints: 10, faabMarket: [14, 23], marketScore: 41, signals: {}, events: { flags: [] } };
  const evaluate = candidate => createWaiverEvaluator({ fitContext, week: 5, availabilityFor: () => resolve("2026-10-07T08:00:00Z"), ownershipRechecked: true, transactionsComplete: true })(candidate);
  const flat = evaluate(base);
  assert.deepEqual([flat.waiver.personalMaxBid, flat.waiver.maxBidStatus], [0, "DETERMINED"]);
  const rising = evaluate({ ...base, emergingRole: { progression: "RISING", progressionSource: "ORGANIC", xfpDelta: 10.8, weeksCompared: [2, 3, 4] } });
  assert.deepEqual([rising.waiver.personalMaxBid, rising.waiver.maxBidStatus], [null, "NOT_DETERMINED_UNCALIBRATED_POTENTIAL"]);
  assert.equal(rising.waiver.fit.faabMaxForMe, 0);
  assert.equal(rising.waiver.suggestedBid, null);
});

test("market estimate, personal ceiling and proposed bid are three numbers: a 0 $ market never zeroes the ceiling", () => {
  const myPlayers = [{ sleeperId: "k", name: "Kicker", position: "K", nflTeam: "ZZZ", projectedPpg: 8 }];
  const weekly = { k: 8, d1: 8.6, d2: 8.3 };
  const fitContext = { myPlayers, faabRemaining: 497, hasOpenRosterSlot: true, paceOf: x => weekly[x.sleeperId] ?? 0, weeklyPaceOf: x => weekly[x.sleeperId] ?? null,
    projectionCovered: x => Number.isFinite(weekly[x.sleeperId]) };
  const defense = (sleeperId, faabMarket) => ({ sleeperId, name: sleeperId, position: "DEF", nflTeam: "AAA", surplusPoints: 5, faabMarket, marketScore: 20, signals: {}, events: { flags: [], roleWeeks: 1 } });
  const evaluate = row => createWaiverEvaluator({ fitContext, week: 5, availabilityFor: () => resolve("2026-10-07T06:00:00Z"), ownershipRechecked: true, transactionsComplete: true })(row);
  const unpricedByMarket = evaluate(defense("d1", [0, 0]));
  // 8,6 pts × 3 $ : la valeur pour ce roster, indépendante de l'estimation de marché.
  assert.deepEqual([unpricedByMarket.waiver.faabMarket, unpricedByMarket.waiver.personalMaxBid, unpricedByMarket.waiver.suggestedBid], [[0, 0], 25, 0]);
  assert.equal(unpricedByMarket.waiver.bidNote, "ZERO_MARKET_ESTIMATE_NOT_A_GUARANTEE");
  assert.equal(unpricedByMarket.waiver.bidBasis, "MARKET_HIGH_ESTIMATE_CAPPED_BY_PERSONAL_CEILING");
  const priced = evaluate(defense("d2", [7, 11]));
  assert.deepEqual([priced.waiver.personalMaxBid, priced.waiver.suggestedBid, priced.waiver.bidNote], [24, 11, null]);
  // Le plafond personnel suit le gain : le meilleur choix n'a jamais un plafond inférieur.
  assert.ok(unpricedByMarket.waiver.personalMaxBid >= priced.waiver.personalMaxBid);
  // L'enchère proposée ne dépasse jamais le plafond personnel.
  assert.equal(evaluate(defense("d2", [40, 90])).waiver.suggestedBid, 24);
});
