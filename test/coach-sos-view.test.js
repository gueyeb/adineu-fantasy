import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCoachSos } from '../public/assets/coach-sos-view.js';

const row = (scope, overrides = {}) => ({ name: 'Receiver', nflTeam: 'ARI', scope, reason: null,
  sos: { rank: 4, difficulty: 'FAVORABLE', sosScore: 34.15, coveredGames: 8, gamesInWindow: 8, opponents: [{ week: 6, opponent: 'ATL' }] }, ...overrides });

test('roster leads; waiver candidates and technical details stay in labelled closed disclosures', () => {
  const sos = { players: [row('ROSTER'), row('WAIVER', { name: 'Candidate' })], asOf: '2026-10-15T08:05:32Z', snapshotId: 'snapshot', explanation: 'Full explanation' };
  const before = structuredClone(sos);
  const html = renderCoachSos(sos);
  assert.ok(html.indexOf('WR du roster') < html.indexOf('Voir les candidats waivers'));
  assert.match(html, /<details class="coach-sos-candidates"><summary>Voir les candidats waivers/);
  assert.match(html, /<details class="method-note coach-sos-method"><summary>Méthode et données/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /34,15/);
  assert.match(html, /Favorable/);
  assert.doesNotMatch(html, />FAVORABLE</);
  assert.deepEqual(sos, before);
});

test('partial/missing coverage keeps official rank absent and score explicitly indicative', () => {
  const html = renderCoachSos({ players: [row('ROSTER', { sos: null, reason: 'DVP_PARTIAL', horizons: { FANTASY_ROS: {
    sosScore: 30, rank: null, coverageStatus: 'PARTIAL', coveredGames: 2, gamesInWindow: 5, opponents: []
  } } })] });
  assert.match(html, /Couverture partielle/);
  assert.match(html, /2\/5 matchs/);
  assert.match(html, /score indicatif, sans rang officiel/);
  assert.match(html, /coach-sos-rank">—/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('names and source metadata are escaped; unavailable data is not shown as zero', () => {
  const html = renderCoachSos({ players: [row('ROSTER', { name: '<script>alert(1)</script>', sos: null, reason: 'SOS_UNAVAILABLE' })], snapshotId: '<img src=x>', asOf: 'invalid' });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Calendrier indisponible/);
  assert.doesNotMatch(html, />0 WR PPR|0\/0 matchs/);
  assert.match(html, /Couverture indisponible/);
  assert.match(renderCoachSos(null), /Calendrier indisponible/);
  assert.doesNotMatch(renderCoachSos(null), /Aucun WR dans le roster/);
});
