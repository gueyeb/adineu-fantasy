import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaiverEvaluator } from '../scripts/waiver-evaluator.js';

const roster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DEF'].map((position, index) => ({
  sleeperId: `r${index}`, name: position === 'TE' ? 'Reference TE' : `Roster ${index}`, position,
  nflTeam: position === 'TE' ? 'ARI' : 'XXX', pace: position === 'TE' ? 20 : position === 'WR' ? index === 6 ? 10 : 14 : 12
}));
const candidate = { sleeperId: 'new-te', name: 'Candidate TE', position: 'TE', nflTeam: 'MIA', effectivePpg: 8,
  marketScore: 76, surplusPoints: 40, faabMarket: [10, 60], signals: {},
  events: { roleWeeks: 2, duration: 'SHORT_2_4W', flags: [], roleConfirmation: 'NOT_APPLICABLE' } };
function evaluate({ week = 13, row = candidate, players = roster, open = true, missing = false, starterIds = new Set(roster.map(player => player.sleeperId)), reserveIds = new Set(), frozenSlots = {}, starterTeId = null } = {}) {
  return createWaiverEvaluator({ week, ownershipRechecked: true, transactionsComplete: true,
    availabilityFor: () => ({ availability: 'FREE_AGENT', canAddNow: true, canStartTargetWeek: true }),
    fitContext: { myPlayers: players, protectedIds: new Set(), starterIds, reserveIds, frozenSlots, starterTeId, faabRemaining: 100, hasOpenRosterSlot: open,
      paceOf: player => player.pace ?? player.effectivePpg,
      weeklyPaceOf: (player, w) => missing && w === 14 && player.sleeperId === 'new-te' ? null : player.nflTeam === 'ARI' && w === 14 ? 0 : player.pace ?? player.effectivePpg,
      projectionCovered: (player, w) => !(missing && w === 14 && player.sleeperId === 'new-te') }
  })(row);
}

test('TE2 explains its actual projected bye use behind a stronger incumbent', () => {
  const row = evaluate();
  const utility = row.teRosterUtility;
  assert.equal(utility.context, 'ADDITIONAL_TE');
  assert.equal(utility.reference.name, 'Reference TE');
  assert.equal(utility.reference.byeWeek, 14);
  assert.deepEqual(utility.teWeeks, [14]);
  assert.deepEqual(utility.flexWeeks, []);
  assert.equal(utility.byeCoverage.status, 'PROJECTED_TE_USE_ON_BYE');
  assert.equal(utility.grossGainTotal, 8);
  assert.equal(utility.insuranceValue, null);
  assert.equal(utility.changesDecisionModel, false);
});

test('a short role ending before the bye never promises a replacement for that bye', () => {
  const row = evaluate({ row: { ...candidate, events: { ...candidate.events, roleWeeks: 1 } } });
  assert.equal(row.teRosterUtility.byeCoverage.status, 'OUTSIDE_ROLE_WINDOW');
  assert.equal(row.teRosterUtility.status, 'NO_PROJECTED_START');
  assert.equal(row.teRosterUtility.netGainTotal, 0);
});

test('TE2 can improve FLEX and exposes the whole lineup gain', () => {
  const row = evaluate({ row: { ...candidate, effectivePpg: 12, events: { ...candidate.events, roleWeeks: 1 } } });
  assert.deepEqual(row.teRosterUtility.flexWeeks, [13]);
  assert.equal(row.teRosterUtility.grossGainTotal, 2);
  assert.equal(row.teRosterUtility.weeklyUsage[0].lineupDelta, 2);
});

test('a high market cannot hide the bench cut cost that erases the gain', () => {
  const bench = { sleeperId: 'bench', name: 'Bench option', position: 'WR', nflTeam: 'XXX', pace: 1, projectedPpg: 1, usageScore: 100 };
  const row = evaluate({ row: { ...candidate, effectivePpg: 3 }, players: [...roster, bench], open: false });
  assert.equal(row.teRosterUtility.netAssessment, 'NON_POSITIVE');
  assert.equal(row.teRosterUtility.grossGainTotal, 3);
  assert.equal(row.teRosterUtility.cutOptionCostTotal, 3);
  assert.equal(row.teRosterUtility.netGainTotal, 0);
  assert.equal(row.waiver.suggestedBid, 0);
});

test('missing projections keep bye utility and net value unverified', () => {
  const row = evaluate({ missing: true });
  assert.equal(row.teRosterUtility.status, 'UNVERIFIED');
  assert.equal(row.teRosterUtility.byeCoverage.status, 'COMPARISON_UNVERIFIED');
  assert.equal(row.teRosterUtility.netGainTotal, null);
  assert.deepEqual(row.teRosterUtility.teWeeks, []);
});

test('same bye and unknown calendar do not invent bye coverage', () => {
  const same = evaluate({ row: { ...candidate, nflTeam: 'ARI' } }).teRosterUtility;
  assert.equal(same.byeCoverage.status, 'SAME_BYE');
  assert.deepEqual(same.teWeeks, []);
  const unknown = evaluate({ row: { ...candidate, nflTeam: null } }).teRosterUtility;
  assert.equal(unknown.byeCoverage.status, 'CANDIDATE_CALENDAR_UNVERIFIED');
});

test('the whole lineup gain includes the incumbent TE moving to FLEX', () => {
  const row = evaluate({ row: { ...candidate, effectivePpg: 24, events: { ...candidate.events, roleWeeks: 1 } } });
  assert.deepEqual(row.teRosterUtility.teWeeks, [13]);
  assert.equal(row.teRosterUtility.weeklyUsage[0].previousTeSlotAfter, 'FLEX');
  assert.equal(row.teRosterUtility.grossGainTotal, 14);
});

test('non-TE candidates have no TE diagnostic and utility does not change the canonical fit', () => {
  assert.equal(evaluate({ row: { ...candidate, position: 'WR' } }).teRosterUtility, null);
  const row = evaluate();
  assert.equal(row.teRosterUtility.netGainTotal, row.waiver.fit.netGainTotal);
  assert.deepEqual(row.modelMetrics.teRosterUtility, row.teRosterUtility);
  assert.deepEqual(row.waiver.teRosterUtility, row.teRosterUtility);
});


test('several unassigned owned TEs do not manufacture a reference starter', () => {
  const row = evaluate({ players: [...roster, { sleeperId: 'other-te', name: 'Other TE', position: 'TE', nflTeam: 'MIA', pace: 2 }], starterIds: new Set() });
  assert.equal(row.teRosterUtility.reference, null);
  assert.equal(row.teRosterUtility.byeCoverage.status, 'REFERENCE_UNDETERMINED');
});

test('an IR tight end is excluded from the available lineup and candidate replaces an active slot', () => {
  const row = evaluate({ reserveIds: new Set(['r5']) });
  assert.equal(row.teRosterUtility.context, 'TE_SLOT_FILL');
  assert.equal(row.teRosterUtility.reference, null);
  assert.equal(row.teRosterUtility.activeOwnedTeCount, 0);
});

test('current fixed TE slots and current blocked statuses are preserved in the explanation', () => {
  const row = evaluate({ row: { ...candidate, effectivePpg: 24, events: { ...candidate.events, roleWeeks: 1 } }, frozenSlots: { TE: 'r5' } });
  assert.deepEqual(row.teRosterUtility.teWeeks, []);
  assert.deepEqual(row.teRosterUtility.flexWeeks, [13]);
  const blocked = evaluate({ row: { ...candidate, injuryStatus: 'Out', effectivePpg: 24, events: { ...candidate.events, roleWeeks: 1 } } });
  assert.deepEqual(blocked.teRosterUtility.teWeeks, []);
  assert.equal(blocked.teRosterUtility.weeklyUsage[0].candidateUnavailable, true);
});

test('TE utility and metrics remain identical in AI Context and Coach', async () => {
  const { buildDecisionContext, formatDecisionContext } = await import('../scripts/ai-context.js');
  const { buildCoachPlan, formatCoachPlan } = await import('../scripts/coach-assistant.js');
  const { formatWaiverReport } = await import('../scripts/league-context.js');
  const row = evaluate();
  const waivers = { week: 13, byPosition: { TE: [row] } };
  const context = buildDecisionContext({ context: { week: 13, league: { name: 'Fixture', teams: 12, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { teamName: 'Fixture', starters: roster.map(player => ({ player })), bench: [], ir: [], record: { wins: 1, losses: 3 } } }, waivers });
  const aiRow = Object.values(context.waiverActions).flat().find(player => player.sleeperId === candidate.sleeperId);
  assert.deepEqual(aiRow.teRosterUtility, row.teRosterUtility);
  const coach = buildCoachPlan({ decisionContext: { ...context, waiverActions: { WATCH: [aiRow] } }, trades: { results: [] } });
  assert.deepEqual(coach.watchlist[0].modelMetrics, row.modelMetrics);
  assert.deepEqual(coach.watchlist[0].teRosterUtility, row.teRosterUtility);
  for (const text of [formatWaiverReport(waivers), formatDecisionContext(context), formatCoachPlan(coach)]) {
    assert.match(text, /TE projeté pendant le bye S14/);
    assert.match(text, /Valeur de secours sur blessure future : n\/d/);
  }
  const staged = { ...aiRow, playerId: aiRow.sleeperId, suggestedBid: 0, budgetAfter: 100,
    netGainTotal: 8, dependsOnPlayerIds: ['prior'],
    teRosterUtility: { ...aiRow.teRosterUtility, reference: { ...aiRow.teRosterUtility.reference, name: 'Staged reference' }, assumesPriorAcquisitions: ['prior'] } };
  const stagedText = formatCoachPlan({ ...coach, acquisitionPlan: { steps: [staged], reservedFaab: 0 } });
  const diagnostic = stagedText.split('🏈 UTILITÉ DU TE')[1];
  assert.match(diagnostic, /Staged reference/);
  assert.doesNotMatch(diagnostic, /Reference TE/);
  assert.match(diagnostic, /acquisitions précédentes supposées réussies/);
  assert.equal(diagnostic.split('Valeur de secours').length - 1, 1);
});


test('declared TE slot remains the reference when another owned TE starts in FLEX', () => {
  const other = { sleeperId: 'flex-te', name: 'Flex TE', position: 'TE', nflTeam: 'MIA', pace: 11 };
  const row = evaluate({ players: [...roster, other], starterIds: new Set([...roster.map(player => player.sleeperId), 'flex-te']), starterTeId: 'r5' });
  assert.equal(row.teRosterUtility.reference.playerId, 'r5');
  assert.equal(row.teRosterUtility.reference.method, 'DECLARED_TE_SLOT');
  assert.equal(row.teRosterUtility.byeCoverage.status, 'NO_PROJECTED_TE_USE_ON_BYE');
});
