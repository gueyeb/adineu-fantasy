import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDecisionProvenance, formatProvenanceSummary } from '../scripts/decision-provenance.js';
import { buildCoachPlan, formatCoachPlan } from '../scripts/coach-assistant.js';

const source = 'https://api.sleeper.app/v1/projections/nfl/regular/2026/5';
const row = (id, name, statuses) => ({ playerId: id, name, provenance: { projections: {
  weeks: statuses.map((status, i) => ({ week: 5 + i, status, source, fetchedAt: '2026-10-07T11:00:00Z' }))
} } });

test('coverage preserves unknown provenance and distinguishes a bye from source and player gaps', () => {
  const input = { roster: [row('r', 'Roster', ['AVAILABLE', 'KNOWN_BYE', 'PLAYER_MISSING'])],
    candidates: [row('c', 'Candidate', ['LOAD_FAILED']), { playerId: 'unknown' }] };
  const before = structuredClone(input);
  const result = summarizeDecisionProvenance(input);
  assert.deepEqual(input, before);
  assert.equal(result.roster.gaps.length, 1);
  assert.equal(result.roster.gaps[0].cause, 'PLAYER_MISSING');
  assert.equal(result.candidates.gaps[0].cause, 'LOAD_FAILED');
  assert.equal(result.candidates.missingProvenance, 1);
  assert.equal(result.roster.projectionWeekCounts.KNOWN_BYE, 1);
  assert.equal(result.candidates.gaps[0].source, source);
});

test('text stays bounded for a large pool without stripping dated evidence from JSON', () => {
  const candidates = Array.from({ length: 100 }, (_, i) => row(String(i), `Candidate ${i}`, Array(10).fill('PLAYER_MISSING')));
  const summary = summarizeDecisionProvenance({ candidates });
  const text = formatProvenanceSummary(summary).join('\n');
  assert.equal(summary.candidates.gaps.length, 1000);
  assert.match(text, /projection gaps 1000/);
  assert.match(text, /\+88 players/);
  assert.ok(text.length < 1500);
  assert.ok(text.length < JSON.stringify(candidates).length / 10);
});

test('Coach carries candidate diagnostics and warns about unpriced cuts in its n8n message', () => {
  const plan = buildCoachPlan({ decisionContext: { week: 5, league: { teams: 12 },
    myTeam: { teamName: 'Boukki', bench: [{ sleeperId: 'r', name: 'Washington' }] },
    rosterProvenance: [row('r', undefined, ['KNOWN_BYE'])],
    candidateProvenance: [row('c', 'Candidate', ['PLAYER_MISSING'])],
    waiverActions: { WATCH: [{ name: 'Candidate', position: 'RB',
      dropCandidate: { name: 'Washington' }, dropCostComponents: { unpricedCutPotential: true } }] }
  }, trades: { results: [] } });
  assert.equal(plan.projectionDiagnostics.length, 1);
  assert.equal(plan.projectionDiagnostics[0].scope, 'candidates');
  const text = formatCoachPlan(plan);
  assert.match(text, /Potentiel de coupe non chiffré : Washington/);
  assert.match(text, /Source coverage candidates/);
  assert.match(text, /projection gaps 1 \(Candidate\)/);
});
