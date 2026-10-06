import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaiverEvaluator } from '../scripts/waiver-evaluator.js';
import { buildCoachPlan, formatCoachPlan } from '../scripts/coach-assistant.js';
import { buildDecisionContext } from '../scripts/ai-context.js';
import { buildAcquisitionPlan } from '../public/assets/waiver-plan.js';

const roster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K'].map((position, i) => ({ sleeperId: `r${i}`, name: `Roster ${i}`, position, pace: 10 }));
const candidate = { sleeperId: 'DEF', name: 'Fixture DEF', position: 'DEF', effectivePpg: 8, weekProjection: 8,
  marketScore: 20, faabMarket: [5, 15], surplusPoints: 30, signals: {}, events: { roleWeeks: 10, flags: [], roleConfirmation: 'NOT_APPLICABLE' } };
const evaluate = ({ available = true, players = roster, open = true, missingTarget = false } = {}) => createWaiverEvaluator({ week: 5,
  fitContext: { myPlayers: players, protectedIds: new Set(), paceOf: p => p.pace ?? p.effectivePpg,
    weeklyPaceOf: (p, w) => w === 7 || missingTarget && p.sleeperId === 'DEF' ? null : p.pace ?? p.weekProjection,
    projectionCovered: (p, w) => w !== 7 && !(missingTarget && p.sleeperId === 'DEF'), faabRemaining: 50, hasOpenRosterSlot: open },
  ownershipRechecked: true, transactionsComplete: true,
  availabilityFor: () => ({ availability: available ? 'FREE_AGENT' : 'UNKNOWN', canAddNow: available, canStartTargetWeek: available }) });

test('a vacant DEF with an open roster slot is evaluated for the target week separately from ROS', () => {
  const row = evaluate()(candidate);
  assert.equal(row.waiver.decision.recommendedAction, 'ADD_NOW');
  assert.equal(row.waiver.fit.horizonWeeks, 1);
  assert.equal(row.waiver.fit.netGainTotal, 8);
  assert.equal(row.waiver.fit.dropCandidate, null);
  assert.equal(row.starterVacancyScenario.slot, 'DEF');
  assert.equal(row.starterVacancyScenario.rosFit.horizonCovered, false);
  assert.equal(row.waiver.suggestedBid, 0);
});
test('weekly vacancy keeps availability and target projection blockers', () => {
  assert.equal(evaluate({ available: false })(candidate).waiver.decision.recommendedAction, 'WATCH');
  const missing = evaluate({ missingTarget: true })(candidate);
  assert.equal(missing.waiver.fit.horizonCovered, false);
  assert.notEqual(missing.waiver.decision.recommendedAction, 'ADD_NOW');
});
test('an occupied position does not become a vacancy and a permanent cut still requires future coverage', () => {
  assert.equal(evaluate({ players: [...roster, { ...candidate, sleeperId: 'owned' }] })(candidate).starterVacancyScenario, null);
  const full = evaluate({ open: false, players: [...roster, { sleeperId: 'bench', name: 'Bench', position: 'WR', pace: 1 }] })(candidate);
  assert.equal(full.starterVacancyScenario.fit.horizonCovered, false);
  assert.ok(full.starterVacancyScenario.fit.coverageIssues.includes('MISSING_POST_ROLE_PROJECTIONS_WEEK_7'));
  assert.notEqual(full.waiver.decision.recommendedAction, 'ADD_NOW');
});

test('a blocked slot fill remains visible ahead of strategic watch targets in Coach', () => {
  const row = evaluate({ available: false })(candidate);
  const watch = { name: row.name, position: row.position, starterVacancyScenario: row.starterVacancyScenario,
    targetWeekDelta: row.waiver.fit.targetWeekDelta, decision: row.waiver.decision };
  const plan = buildCoachPlan({ decisionContext: { week: 5, league: { teams: 12 }, myTeam: { teamName: 'Fixture' },
    waiverActions: { WATCH: [...Array.from({ length: 4 }, (_, i) => ({ name: `WR ${i}`, position: 'WR' })), watch,
      ...Array.from({ length: 3 }, (_, i) => ({ ...watch, name: `Alternative DEF ${i}`, targetWeekDelta: 7 }))] } }, trades: { results: [] } });
  assert.equal(plan.watchlist[0].name, 'Fixture DEF');
  assert.equal(plan.watchlist[1].name, 'WR 0', 'multiple DEF options must not hide every other position');
  assert.match(formatCoachPlan(plan), /compléter DEF en S5 \(8 pts projetés\)/);
  assert.match(formatCoachPlan(plan), /disponibilité cette semaine non vérifiée/);
});

test('same execution time prioritizes filling a vacant slot over a larger optional upgrade', () => {
  const plan = buildAcquisitionPlan({ candidates: [{ sleeperId: 'wr' }, { sleeperId: 'def' }], myPlayers: roster,
    faabRemaining: 50, maxAcquisitions: 1, evaluateCandidate: row => ({ ...row,
      starterVacancyScenario: row.sleeperId === 'def' ? { slot: 'DEF' } : null,
      availability: { canStartTargetWeek: true, canAddNow: true, availability: 'FREE_AGENT' },
      waiver: { decision: { recommendedAction: 'ADD_NOW' }, suggestedBid: 0,
        fit: { legalTransaction: true, horizonCovered: true, netGainTotal: row.sleeperId === 'def' ? 8 : 30,
          horizonWeeks: 1, weeklyLineupDeltas: [{ week: 5 }] } } }) });
  assert.equal(plan.steps[0].playerId, 'def');
});

test('weekly slot metrics remain identical across Waiver, AI Context and Coach', () => {
  const row = evaluate()(candidate);
  const context = buildDecisionContext({ context: { week: 5,
    league: { teams: 12, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { owner: 'fixture', teamName: 'Fixture', starters: roster.map(player => ({ player })), bench: [], ir: [], record: { wins: 1, losses: 3 } } },
    waivers: { byPosition: { DEF: [row] } } });
  const aiRow = context.waiverActions.ADD_NOW.find(p => p.sleeperId === 'DEF');
  const coach = buildCoachPlan({ decisionContext: context, trades: { results: [] } });
  assert.deepEqual(aiRow.modelMetrics, row.modelMetrics);
  assert.deepEqual(coach.waiverActions.ADD_NOW[0].modelMetrics, row.modelMetrics);
  assert.equal(coach.waiverActions.ADD_NOW[0].starterVacancyScenario.rosFit.horizonCovered, false);
});
