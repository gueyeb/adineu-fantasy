import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityWindow, projectionHorizons, decisionWeeklyProjection } from '../public/assets/decision-horizons.js';
import { classifyWaiverDecision, evaluateRosterFit } from '../public/assets/waiver-model.js';
import { buildPlayerWeeks, calculateUsageScores } from '../public/assets/usage-score.js';

const scope = { week: 11, season: 2026, leagueId: 'L', asOf: '2026-11-20T20:00:00Z' };
const evidence = { type: 'INJURY', source: 'dated report', observedAt: '2026-11-20T18:00:00Z', expiresAt: '2026-11-21T18:00:00Z', targetWeek: 11, season: 2026, leagueId: 'L', outThroughWeek: 14 };

test('injured surge cannot become BREAKOUT 96; unknown return stays unpriced', () => {
  const args = { position: 'WR', marketScore: 81, flags: ['USAGE_SURGE'], injuryStatus: 'IR', netGain: 8, targetWeekDelta: 8 };
  const unknown = classifyWaiverDecision(args);
  assert.equal(unknown.strategicUpside, null);
  assert.equal(unknown.immediateValue, 0);
  assert.equal(unknown.decisionClass, 'INJURED_STASH');
  assert.equal(unknown.recommendedAction, 'WATCH');
  assert.ok(unknown.actionBlockers.includes('RETURN_DATE_UNCONFIRMED'));
  const window = availabilityWindow({ injuryStatus: 'IR' }, { ...scope, endWeek: 14, evidence });
  const known = classifyWaiverDecision({ ...args, availabilityWindow: window });
  assert.equal(known.strategicUpside, 0);
  assert.equal(known.decisionClass, 'UNAVAILABLE_HORIZON');
  assert.equal(availabilityWindow({ injuryStatus: 'IR' }, { ...scope, endWeek: 14, evidence: { ...evidence, targetWeek: 10 } }).fraction, null);
});

test('qualification and individual playoff weeks have independent coverage and absence windows', () => {
  const projectionsByWeek = Object.fromEntries([11, 12, 13, 14, 15, 17].map(w => [w, { p: { pts_ppr: 20 } }]));
  const result = projectionHorizons({ ...scope, player: { sleeperId: 'p', injuryStatus: 'IR' }, projectionsByWeek, evidence });
  assert.equal(result.QUALIFICATION.total, 0);
  assert.equal(result.PLAYOFF_WEEK_15.total, 20);
  assert.equal(result.PLAYOFF_WEEK_15.availability.fraction, 1);
  assert.equal(result.PLAYOFFS.availability.fraction, 1);
  assert.equal(result.PLAYOFF_WEEK_16.total, null);
  assert.equal(result.PLAYOFFS.total, null);
  assert.deepEqual(result.PLAYOFFS.missingWeeks, [16]);
  assert.equal(result.PLAYOFFS.availability.returnConfirmed, false);
  assert.equal(decisionWeeklyProjection({ sleeperId: 'p', injuryStatus: 'IR' }, 13, { ...scope, projectionsByWeek, eventsById: { p: evidence } }), 0);
  assert.equal(decisionWeeklyProjection({ sleeperId: 'p', injuryStatus: 'IR' }, 15, { ...scope, projectionsByWeek, eventsById: { p: evidence } }), 20);
});

test('unknown usage and possible handcuffs cannot be automatic cheap cuts', () => {
  const marketRow = { sleeperId: 'new', position: 'WR', effectivePpg: 20, surplusPoints: 30 };
  const known = { sleeperId: 'known', position: 'WR', pace: 3, projectedPpg: 3, usageScore: 50 };
  const unknown = { sleeperId: 'unknown', position: 'WR', pace: 0, projectedPpg: 0, usageScore: null };
  const evaluate = myPlayers => evaluateRosterFit({ marketRow, myPlayers, week: 11, faabRemaining: 100, paceOf: p => p.pace ?? p.effectivePpg });
  assert.equal(evaluate([unknown, known]).dropCandidate.sleeperId, 'known');
  const blocked = evaluate([unknown]);
  assert.equal(blocked.dropCandidate, null);
  assert.equal(blocked.horizonCovered, false);
  assert.ok(blocked.coverageIssues.includes('CUT_OPTION_VALUE_UNKNOWN'));
  assert.equal(evaluate([{ ...known, handcuff: { status: 'POSSIBLE' } }]).dropCandidate, null);
});

test('passing participation uses published routes and never substitutes snaps', () => {
  const input = routes => [1, 2, 3].map(week => ({ week, stats: { p: { off_snp: 50, tm_off_snp: 60, rec_tgt: 8, rec_air_yd: 80, pts_ppr: 1, ...(routes ? { rec_routes: 30 } : {}) }, q: { off_snp: 60, pass_att: 38, pass_sack: 2 }, low: { off_snp: 1, tm_off_snp: 60, rec_tgt: 0 } } }));
  const calculate = routes => calculateUsageScores(buildPlayerWeeks(input(routes), { teamOf: () => 'X', positionOf: id => id === 'q' ? 'QB' : 'WR' })).players.find(p => p.playerId === 'p');
  const measured = calculate(true);
  assert.equal(measured.passingParticipation.routeParticipation, 75);
  assert.equal(measured.passingParticipation.targetsPerRoute, 0.267);
  assert.equal(measured.signalEvidence.routesAvailable, true);
  assert.equal(calculate(false).passingParticipation.routeParticipation, null);
  assert.equal(calculate(false).passingParticipation.routeCoverage, '0/3');
});
