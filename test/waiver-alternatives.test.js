import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionPlan } from '../public/assets/waiver-plan.js';

const processAt = '2026-10-08T07:00:00Z';
const players = [{ sleeperId: 'cut', name: 'Bench asset', position: 'WR' }];
const candidates = [
  { sleeperId: 'coleman', name: 'Coleman', position: 'WR', utility: 10, bid: 47 },
  { sleeperId: 'harris', name: 'Harris', position: 'WR', utility: 8, bid: 23 },
  { sleeperId: 'def', name: 'Fixture DEF', position: 'DEF', utility: 4, bid: 0 }
];
function evaluate(candidate, state) {
  const wrOwned = state.myPlayers.some(player => ['coleman', 'harris'].includes(player.sleeperId));
  const cut = candidate.position === 'WR' ? state.myPlayers.find(player => player.sleeperId === 'cut') : null;
  const legal = candidate.position === 'WR' ? Boolean(cut) && !wrOwned : state.hasOpenRosterSlot;
  const gain = legal ? candidate.utility : 0;
  const free = candidate.bid === 0;
  return { ...candidate, availability: { availability: free ? 'FREE_AGENT' : 'WAIVER_LOCKED', canAddNow: free,
    canStartTargetWeek: true, waiverProcessesAt: free ? null : processAt },
    waiver: { suggestedBid: candidate.bid, personalMaxBid: candidate.bid,
      decision: { recommendedAction: legal ? free ? 'ADD_NOW' : 'CLAIM_IF_CHEAP' : 'IGNORE' },
      fit: { legalTransaction: legal, horizonCovered: true, netGainTotal: gain, targetWeekDelta: gain,
        dropCandidate: cut ?? null, horizonWeeks: 1, weeklyLineupDeltas: [{ week: 5, delta: gain }] } } };
}
const planFor = (options = {}) => buildAcquisitionPlan({ candidates, myPlayers: players, rosterCapacity: 2, faabRemaining: 100, evaluateCandidate: evaluate, ...options });

test('same-cut fallback claims have ordered outcomes and reserve the maximum bid, never their sum', () => {
  const plan = planFor();
  assert.deepEqual(plan.steps.map(step => step.playerId), ['def', 'coleman']);
  const group = plan.alternativeClaimGroups[0];
  assert.deepEqual(group.claims.map(claim => claim.playerId), ['coleman', 'harris']);
  assert.equal(group.maximumBid, 47);
  assert.equal(group.platformCancellationVerified, false);
  const portfolio = plan.claimPortfolio;
  assert.equal(portfolio.coverage, 'COMPLETE_REVIEWED_SCENARIOS');
  assert.deepEqual(portfolio.scenarios.find(scenario => scenario.scenarioId === portfolio.primaryScenarioId).steps, plan.steps);
  assert.equal(portfolio.maximumReviewedFaabExposure, 47);
  assert.equal(portfolio.simultaneousSubmissionExposure, null);
  const fallback = portfolio.scenarios.find(scenario => scenario.outcomes.some(outcome => outcome.winnerPlayerId === 'harris'));
  assert.deepEqual(fallback.steps.map(step => step.playerId), ['def', 'harris']);
  assert.equal(fallback.reservedFaab, 23);
  assert.deepEqual(fallback.outcomes.at(-1).earlierClaimFailures, ['coleman']);
  const failed = portfolio.scenarios.find(scenario => scenario.outcomes.some(outcome => outcome.winnerPlayerId === null));
  assert.deepEqual(failed.steps.map(step => step.playerId), ['def']);
  assert.equal(failed.reservedFaab, 0);
  assert.equal(failed.remainingFaab, 100);
});

test('different processing windows and uncertain or overpriced candidates cannot become fallbacks', () => {
  for (const change of [
    row => { row.availability.waiverProcessesAt = '2026-10-09T07:00:00Z'; },
    row => { row.availability.canStartTargetWeek = false; },
    row => { row.waiver.fit.horizonCovered = false; },
    row => { row.waiver.suggestedBid = 101; },
    row => { row.waiver.decision.recommendedAction = 'WATCH'; }
  ]) {
    const plan = planFor({ evaluateCandidate: (candidate, state) => {
      const row = evaluate(candidate, state); if (candidate.sleeperId === 'harris') change(row); return row;
    } });
    assert.equal(plan.alternativeClaimGroups.length, 0);
  }
});

test('one vacant roster place is consumed once on each fallback branch', () => {
  const delayedDef = (candidate, state) => {
    const row = evaluate(candidate, state);
    if (candidate.position === 'DEF') {
      row.availability = { availability: 'WAIVER_LOCKED', canStartTargetWeek: true, canAddNow: false, waiverProcessesAt: '2026-10-09T07:00:00Z' };
      row.waiver.decision.recommendedAction = state.hasOpenRosterSlot ? 'CLAIM_IF_CHEAP' : 'WATCH';
    }
    return row;
  };
  const plan = planFor({ evaluateCandidate: delayedDef });
  for (const scenario of plan.claimPortfolio.scenarios) {
    assert.equal(scenario.steps.filter(step => step.playerId === 'def').length, 1);
    assert.equal(scenario.steps.filter(step => ['coleman', 'harris'].includes(step.playerId)).length <= 1, true);
    assert.equal(scenario.steps.find(step => step.playerId === 'def').dropCandidate, null);
    assert.ok(scenario.reservedFaab <= 100);
  }
});

test('unknown FAAB never proposes paid fallbacks', () => {
  const plan = planFor({ faabRemaining: null });
  assert.deepEqual(plan.steps.map(step => step.playerId), ['def']);
  assert.deepEqual(plan.alternativeClaimGroups, []);
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, null);
});

test('a more expensive fallback changes portfolio exposure without increasing the primary reservation', () => {
  const expensive = candidates.map(candidate => candidate.sleeperId === 'harris' ? { ...candidate, bid: 60 } : candidate);
  const plan = planFor({ candidates: expensive });
  assert.equal(plan.reservedFaab, 47);
  assert.equal(plan.alternativeClaimGroups[0].maximumBid, 60);
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, 60);
  assert.equal(plan.claimPortfolio.scenarios.find(scenario => scenario.outcomes.some(outcome => outcome.winnerPlayerId === 'harris')).remainingFaab, 40);
});

test('fallback role windows remain bounded in the subsequent roster evaluation', () => {
  const observed = [];
  planFor({ candidates: [...candidates, { sleeperId: 'marker', name: 'Watch only', position: 'TE', utility: 0, bid: 0 }], evaluateCandidate: (candidate, state) => {
    for (const player of state.myPlayers) if (['coleman', 'harris'].includes(player.sleeperId)) observed.push([player.sleeperId, player.plannedRoleWindow]);
    return evaluate(candidate, state);
  } });
  for (const id of ['coleman', 'harris']) assert.ok(observed.some(([playerId, window]) => playerId === id && window?.startWeek === 5 && window.endWeekExclusive === 6));
});

function multiGroupPlan(groupCount, options = {}) {
  const roster = Array.from({ length: groupCount }, (_, index) => ({ sleeperId: `cut-${index}`, name: `Bench ${index}`, position: 'WR' }));
  const pool = roster.flatMap((player, group) => [0, 1].map(option => ({ sleeperId: `group-${group}-${option}`, name: `Choice ${group}/${option}`, position: 'WR', group, option })));
  return buildAcquisitionPlan({ candidates: pool, myPlayers: roster, rosterCapacity: roster.length,
    faabRemaining: 100, maxAcquisitions: groupCount,
    evaluateCandidate: (candidate, state) => {
      const cut = state.myPlayers.find(player => player.sleeperId === `cut-${candidate.group}`);
      const gain = cut ? 20 - candidate.group * 2 - candidate.option : 0;
      return { ...candidate, availability: { availability: 'WAIVER_LOCKED', canStartTargetWeek: true, waiverProcessesAt: processAt },
        waiver: { suggestedBid: 10 + candidate.option, personalMaxBid: 11, decision: { recommendedAction: cut ? 'CLAIM_IF_CHEAP' : 'IGNORE' },
          fit: { legalTransaction: Boolean(cut), horizonCovered: true, dropCandidate: cut, netGainTotal: gain,
            targetWeekDelta: gain, horizonWeeks: 1, weeklyLineupDeltas: [{ week: 5, delta: gain }] } } };
    }, ...options });
}

test('multiple independent groups combine winner and failure outcomes on one recomputed roster', () => {
  const plan = multiGroupPlan(2);
  assert.equal(plan.claimPortfolio.scenarios.length, 9);
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, 22);
  assert.equal(plan.claimPortfolio.coverage, 'COMPLETE_REVIEWED_SCENARIOS');
  for (const scenario of plan.claimPortfolio.scenarios) {
    assert.equal(new Set(scenario.steps.map(step => step.dropCandidate.sleeperId)).size, scenario.steps.length);
    assert.ok(scenario.reservedFaab <= 100);
    assert.equal(new Set(scenario.endingRosterPlayerIds).size, 2);
  }
});

test('bounded exploration reports incomplete coverage instead of inventing a global maximum', () => {
  const plan = multiGroupPlan(3);
  assert.equal(plan.claimPortfolio.scenarios.length, 16);
  assert.equal(plan.claimPortfolio.coverage, 'PARTIAL_REVIEWED_SCENARIOS');
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, null);
  assert.ok(plan.claimPortfolio.issues.includes('SCENARIO_LIMIT_REACHED'));
  assert.ok(plan.claimPortfolio.evaluatedScenarioMaxFaab <= plan.initialFaab);
  assert.ok(plan.claimPortfolio.primaryScenarioId);
});

test('valid sequential acquisitions with distinct recomputed cuts are not suppressed as fallbacks', () => {
  const base = multiGroupPlan(1);
  const pool = [...candidates.slice(0, 2)];
  const plan = planFor({ myPlayers: [...players, { sleeperId: 'cut2', name: 'Other bench', position: 'WR' }], rosterCapacity: 2, candidates: pool,
    evaluateCandidate: (candidate, state) => {
      const row = evaluate(candidate, state);
      const cut = state.myPlayers.find(player => ['cut', 'cut2'].includes(player.sleeperId));
      row.waiver.fit = { ...row.waiver.fit, dropCandidate: cut, legalTransaction: Boolean(cut), netGainTotal: cut ? candidate.utility : 0 };
      row.waiver.decision.recommendedAction = cut ? 'CLAIM_IF_CHEAP' : 'IGNORE';
      return row;
    } });
  assert.deepEqual(plan.steps.map(step => step.playerId), ['coleman', 'harris']);
  assert.equal(plan.alternativeClaimGroups.length, 0);
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, 70);
  assert.equal(base.steps.length, 1);
});

test('Waiver, Context and Coach expose identical portfolio with explicit fallback text for n8n', async () => {
  const { buildCoachPlan, formatCoachPlan } = await import('../scripts/coach-assistant.js');
  const { buildDecisionContext, formatDecisionContext } = await import('../scripts/ai-context.js');
  const { formatWaiverReport } = await import('../scripts/league-context.js');
  const plan = planFor();
  const waivers = { week: 5, byPosition: {}, acquisitionPlan: plan, lastCompletedWeek: 4 };
  const decision = buildDecisionContext({ context: { week: 5, league: { name: 'Fixture', teams: 12, playoffTeams: 8,
    rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { teamName: 'Boukki', owner: 't0z', rosterId: 1, starters: [], bench: [], ir: [], record: { wins: 1, losses: 3 }, faab: { remaining: 100 } } }, waivers });
  const coach = buildCoachPlan({ decisionContext: decision, trades: { results: [] } });
  assert.equal(decision.acquisitionPlan, plan);
  assert.equal(coach.acquisitionPlan, plan);
  for (const text of [formatWaiverReport(waivers), formatDecisionContext(decision), formatCoachPlan(coach)]) {
    assert.match(text, /puis Harris \(23 \$\) seulement si les choix précédents échouent/);
    assert.match(text, /maximum de ce groupe 47 \$/);
    assert.match(text, /Annulation automatique non vérifiée/);
  }
  assert.doesNotMatch(formatCoachPlan(coach), /Total réservé 70/);
});

test('fallback limits expose omitted options and never treat an omitted claim as a submitted success', () => {
  const extra = [
    { sleeperId: 'third', name: 'Third option', position: 'WR', utility: 7, bid: 15 },
    { sleeperId: 'fourth', name: 'Fourth option', position: 'WR', utility: 6, bid: 10 }
  ];
  const plan = planFor({ candidates: [...candidates, ...extra] });
  assert.equal(plan.alternativeClaimGroups[0].claims.length, 3);
  assert.equal(plan.alternativeClaimGroups[0].omittedFallbackCount, 1);
  assert.ok(plan.claimPortfolio.issues.includes('FALLBACK_OPTIONS_LIMITED'));
  assert.equal(plan.claimPortfolio.scenarios.some(scenario => scenario.steps.some(step => step.playerId === 'fourth')), false);
});

test('a fallback may consume the same vacant slot but never creates another spot for a later add', () => {
  const pool = candidates.slice(0, 2);
  const plan = planFor({ candidates: pool, myPlayers: [], rosterCapacity: 1, evaluateCandidate: (candidate, state) => {
    const legal = state.hasOpenRosterSlot;
    const row = evaluate(candidate, { ...state, myPlayers: players });
    row.waiver.fit = { ...row.waiver.fit, dropCandidate: null, legalTransaction: legal, netGainTotal: legal ? candidate.utility : 0 };
    row.waiver.decision.recommendedAction = legal ? 'CLAIM_IF_CHEAP' : 'IGNORE';
    return row;
  } });
  assert.equal(plan.alternativeClaimGroups[0].resource, 'OPEN_ROSTER_SLOT');
  assert.equal(plan.claimPortfolio.scenarios.length, 3);
  for (const scenario of plan.claimPortfolio.scenarios) assert.ok(scenario.endingRosterPlayerIds.length <= 1);
});

test('a winning fallback recalculates remaining budget and suppresses an unaffordable later claim', () => {
  const pool = [candidates[0], { ...candidates[1], bid: 60 }, { sleeperId: 'later', name: 'Later claim', position: 'RB', bid: 50, utility: 6 }];
  const roster = [...players, { sleeperId: 'cut2', name: 'Second bench', position: 'RB' }];
  const plan = planFor({ candidates: pool, myPlayers: roster, rosterCapacity: 2, evaluateCandidate: (candidate, state) => {
    if (candidate.sleeperId !== 'later') return evaluate(candidate, state);
    const cut = state.myPlayers.find(player => player.sleeperId === 'cut2');
    return { ...candidate, availability: { availability: 'WAIVER_LOCKED', canStartTargetWeek: true, waiverProcessesAt: '2026-10-09T07:00:00Z' },
      waiver: { suggestedBid: 50, personalMaxBid: 50, decision: { recommendedAction: cut ? 'CLAIM_IF_CHEAP' : 'IGNORE' },
        fit: { legalTransaction: Boolean(cut), horizonCovered: true, netGainTotal: cut ? 6 : 0, targetWeekDelta: 6, dropCandidate: cut,
          horizonWeeks: 1, weeklyLineupDeltas: [{ week: 5, delta: 6 }] } } };
  } });
  assert.equal(plan.reservedFaab, 97);
  const fallback = plan.claimPortfolio.scenarios.find(scenario => scenario.outcomes.some(outcome => outcome.winnerPlayerId === 'harris'));
  assert.deepEqual(fallback.steps.map(step => step.playerId), ['harris']);
  assert.equal(fallback.reservedFaab, 60);
  assert.equal(fallback.remainingFaab, 40);
  assert.ok(fallback.endingRosterPlayerIds.includes('cut2'));
  assert.equal(plan.claimPortfolio.maximumReviewedFaabExposure, 97);
});

test('Coach keeps individual metrics in JSON without presenting a fallback as another cumulative action', async () => {
  const { buildCoachPlan, formatCoachPlan } = await import('../scripts/coach-assistant.js');
  const plan = buildCoachPlan({ decisionContext: { week: 5, league: { teams: 12 }, myTeam: { teamName: 'Boukki' },
    acquisitionPlan: planFor(), waiverActions: { CLAIM_IF_CHEAP: candidates.slice(0, 2).map(candidate => ({ ...candidate, netGain: 3, dropCandidate: players[0], recommendedAction: 'CLAIM_IF_CHEAP' })) } },
    trades: { results: [] } });
  assert.equal(plan.waiverActions.CLAIM_IF_CHEAP.length, 2);
  const text = formatCoachPlan(plan);
  assert.equal(text.match(/Harris/g)?.length, 1);
  assert.doesNotMatch(text, /WAIVERS — SEULEMENT AU BON PRIX/);
  assert.match(text, /CLAIMS ALTERNATIFS/);
});

test('private Coach endpoint returns the shared portfolio and readable message consumed by n8n', async t => {
  const { once } = await import('node:events');
  const { createAppServer } = await import('../server.js');
  const acquisitionPlan = planFor();
  const server = createAppServer({ coachToken: 'fixture-claim-token',
    getContext: async () => ({ week: 5, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
      myTeam: { rosterId: 1, teamName: 'Boukki', owner: 't0z', starters: [], bench: [], ir: [], record: { wins: 1, losses: 3 }, faab: { remaining: 100 } } }),
    getFreeAgents: async () => ({ week: 5, lastCompletedWeek: 4, byPosition: {}, acquisitionPlan }),
    getInjuryStatuses: async () => new Map(), getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getMatchupContext: async () => null, analyze: async () => ({ results: [] }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/coach?team=t0z`, { headers: { authorization: 'Bearer fixture-claim-token' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.acquisitionPlan, JSON.parse(JSON.stringify(acquisitionPlan)));
  assert.match(body.message, /puis Harris \(23 \$\) seulement si/);
  assert.equal(body.acquisitionPlan.claimPortfolio.simultaneousSubmissionExposure, null);
});
