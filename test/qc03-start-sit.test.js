import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoomSafeLineups, buildPlayableLineups, diagnoseLineup } from '../scripts/lineup-advisor.js';
import { buildDecisionContext, formatDecisionContext } from '../scripts/ai-context.js';
import { buildCoachPlan } from '../scripts/coach-assistant.js';
const now = Date.now();
const asOf = new Date(now).toISOString();
const player = { sleeperId: 'p', name: 'Test', position: 'QB', nflTeam: 'KC', projection: 15, floor: 10, ceiling: 20 };
const timingContext = { asOf, season: 2026, games: [{ season: 2026, week: 8, home_team: 'KC', away_team: 'BUF', kickoffAt: new Date(now + 10000).toISOString() }] };
test('identical optimal Boom and Safe have one explicit explanation', () => {
  const result = buildBoomSafeLineups([player], new Set());
  assert.equal(result.boomDiffers, false);
  assert.equal(result.safeDiffers, false);
  assert.match(result.identicalReason, /mêmes joueurs/);
});
test('playable excludes kicked-off players at exact boundary and keeps permission null', () => {
  const result = buildPlayableLineups([player], new Set(), { week: 8, timingContext, now: now + 10000 });
  assert.equal(result.excluded[0].reason, 'GAME_LOCKED');
  assert.equal(result.permission, null);
  assert.ok(result.optimal.slots.every(slot => !slot.sleeperId));
});
test('playable excludes Out IR byes and unknown kickoff evidence', () => {
  for (const injuryStatus of ['Out', 'IR']) assert.equal(buildPlayableLineups([{ ...player, injuryStatus }], new Set(), { week: 8, timingContext, now }).excluded[0].reason, 'ABSENT');
  assert.equal(buildPlayableLineups([player], new Set(), { week: 8, timingContext, now, byeWeeks: { KC: 8 } }).excluded[0].reason, 'BYE');
  assert.equal(buildPlayableLineups([player], new Set(), { week: 8, now }).excluded[0].reason, 'LOCK_CONTEXT_UNKNOWN');
});
test('Coach Start/Sit and decision context preserve the same qualification and nullable gain', () => {
  for (const blockers of [[], ['GAME_LOCKED']]) for (const date of [asOf, null]) for (const gain of [null, 3.4]) for (const inferred of [false, true]) {
    const candidate = { ...player, availability: { availability: 'FREE_AGENT', canAddNow: true, verified: true, availabilitySource: inferred ? 'LEAGUE_RULES_INFERRED' : 'OPERATOR_EVIDENCE' }, waiver: { decision: { recommendedAction: 'ADD_NOW', actionBlockers: blockers }, fit: { legalTransaction: true, horizonCovered: true, netGainTotal: gain }, reasons: [], flags: [] } };
    const myTeam = { starters: [{ slot: 'QB', player: null }], bench: [], ir: [], faab: {}, teamName: 'Test', owner: 'test', record: {} };
    const waivers = { week: 8, lastCompletedWeek: 7, availabilityAsOf: date, byPosition: { QB: [candidate] } };
    const context = { week: 8, myTeam, league: { name: 'Test', teams: 12, rosterSettings: { starters: { QB: 1 }, benchSlots: 6, reserveSlots: 1 } } };
    const decision = buildDecisionContext({ context, waivers });
    const coach = buildCoachPlan({ decisionContext: decision, trades: { results: [] } });
    const start = diagnoseLineup({ myTeam, freeAgentsByPosition: waivers.byPosition, currentWeek: 8, availabilityAsOf: date, dataThroughWeek: 7 }).alerts[0].replacement.acquisition.qualification;
    assert.deepEqual(start, decision.waiverActions.ADD_NOW[0].qualification);
    assert.deepEqual(start, coach.waiverActions.ADD_NOW[0].qualification);
    assert.equal(start.availabilityAsOf, date);
    assert.equal(start.netGainTotal, gain);
    assert.match(formatDecisionContext(decision), /Qualification=/);
  }
});

test('diagnosis does not propose changing a locked Out starter', () => {
  const diagnosis = diagnoseLineup({ myTeam: { starters: [{ slot: 'QB', player }], bench: [{ ...player, sleeperId: 'bench' }] }, playerStatuses: new Map([['p', 'Out']]), currentWeek: 8, timingContext, now: now + 10000 });
  assert.equal(diagnosis.alerts[0].replacementRole, 'LOCKED');
  assert.equal(diagnosis.alerts[0].replacement, null);
});
