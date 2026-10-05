import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAcquisitionAvailability, summarizeRecentTransactions } from '../public/assets/acquisition-availability.js';
import { classifyWaiverDecision, evaluateRosterFit } from '../public/assets/waiver-model.js';
const asOf = '2026-10-04T10:00:00Z';
const evidence = { observedAt: "2026-10-04T09:00:00Z", source: 'fixture Sleeper screenshot', expiresAt: '2026-10-04T19:00:00Z', kickoffAt: '2026-10-04T17:00:00Z', availability: 'WAIVER_LOCKED', waiverProcessesAt: '2026-10-05T07:00:00Z' };
test('Bills/Rams unlock after kickoff; missing evidence and current ownership block acquisition', () => {
  for (const playerId of ['BUF', 'LA']) {
    const availability = resolveAcquisitionAvailability({ playerId, rosters: [], evidence, asOf });
    assert.equal(availability.canStartTargetWeek, false);
    assert.equal(classifyWaiverDecision({ position: 'DEF', netGain: 3, availability }).recommendedAction, 'WATCH');
  }
  assert.equal(resolveAcquisitionAvailability({ playerId: 'w', rosters: [{ roster_id: 3, players: ['w'] }], evidence, asOf }).availability, 'ROSTERED');
  assert.equal(resolveAcquisitionAvailability({ playerId: 'x', rosters: [], asOf }).availability, 'UNKNOWN');
});
test('confirmed free agent can be added; uncertain promotion remains conditional', () => {
  const availability = resolveAcquisitionAvailability({ playerId: 'q', rosters: [], evidence: { ...evidence, availability: 'FREE_AGENT' }, asOf });
  assert.equal(classifyWaiverDecision({ position: 'QB', netGain: 3, availability }).recommendedAction, 'ADD_NOW');
  assert.equal(classifyWaiverDecision({ position: 'QB', netGain: 3, flags: ['PROMOTION'], roleConfirmation: 'UNCONFIRMED', availability }).recommendedAction, 'WATCH');
});
test('72h transactions are capped with explicit count and relevance', () => {
  const transactions = Array.from({ length: 32 }, (_, i) => ({ transaction_id: String(i), status_updated: Date.parse(asOf) - i * 1000, drops: { BUF: 1 } }));
  const summary = summarizeRecentTransactions(transactions, { asOf, relevantIds: new Set(['BUF']) });
  assert.equal(summary.recentTransactions.length, 30);
  assert.equal(summary.transactionsTruncatedCount, 2);
  assert.equal(summary.recentTransactions[0].relevant, true);
});
test('DEF transaction replaces Saints before cutting a WR and reports weekly horizon', () => {
  const myPlayers = [{ sleeperId: 'NO', position: 'DEF', name: 'Saints', pace: 7 }, { sleeperId: 'h', position: 'WR', name: 'Harris', pace: 8 }];
  const marketRow = { sleeperId: 'BUF', position: 'DEF', effectivePpg: 10, faabMarket: [10, 30], surplusPoints: 30, events: { roleWeeks: 1 } };
  const fit = evaluateRosterFit({ marketRow, myPlayers, paceOf: p => p.pace ?? p.effectivePpg, weeklyPaceOf: p => p.sleeperId === 'BUF' ? 7.1 : p.pace, week: 4, starterIds: new Set(['NO']), replacementByPosition: { DEF: 7, WR: 8 } });
  assert.equal(fit.dropCandidate.sleeperId, 'NO');
  assert.equal(fit.horizonWeeks, 1);
  assert.equal(fit.targetWeekDelta, 0.1);
  assert.equal(fit.grossGainTotal, 0.1);
  const blocked = evaluateRosterFit({ marketRow, myPlayers, paceOf: p => p.pace ?? p.effectivePpg, week: 4, lockedIds: new Set(['NO', 'h']) });
  assert.equal(blocked.legalTransaction, false);
});

test('expired evidence, future observation and a later transaction never confirm availability', () => {
  for (const patch of [{ expiresAt: asOf }, { observedAt: "2026-10-04T11:00:00Z" }]) {
    assert.equal(resolveAcquisitionAvailability({ playerId: "p", rosters: [], evidence: { ...evidence, ...patch }, asOf }).availability, "UNKNOWN");
  }
  assert.equal(resolveAcquisitionAvailability({ playerId: "p", rosters: [], evidence, asOf, latestTransactionAt: Date.parse("2026-10-04T09:30:00Z") }).availability, "UNKNOWN");
});
test('missing projections stay null; open roster slots need no cut; locked starters keep their slots', () => {
  const marketRow = { sleeperId: "new", position: "WR", effectivePpg: 20, faabMarket: [10, 30], surplusPoints: 100, events: { roleWeeks: 1 } };
  const myPlayers = [{ sleeperId: "old", position: "WR", pace: 10 }];
  const args = { marketRow, myPlayers, paceOf: p => p.pace ?? p.effectivePpg, week: 4, hasOpenRosterSlot: true };
  const open = evaluateRosterFit(args);
  assert.equal(open.dropCandidate, null);
  assert.equal(open.legalTransaction, true);
  const missing = evaluateRosterFit({ ...args, weeklyPaceOf: p => p.sleeperId === "new" ? null : 10, projectionCovered: p => p.sleeperId !== "new" });
  assert.equal(missing.grossGainTotal, null);
  assert.equal(missing.targetWeekDelta, null);
  assert.equal(missing.faabMaxForMe, 0);
  assert.equal(missing.horizonCovered, false);
  const frozen = evaluateRosterFit({ ...args, frozenSlots: { WR1: "old" }, weeklyPaceOf: p => p.sleeperId === "new" ? 20 : 10 });
  assert.equal(frozen.weeklyLineupDeltas[0].beforeTotal, 10);
  assert.equal(frozen.weeklyLineupDeltas[0].afterTotal, 30);
});
