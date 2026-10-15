import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSosAiContext, readSosHandoff, formatSosHandoff } from '../public/assets/sos-ai-context.js';
import { buildSosBundle } from '../scripts/sos-service.js';
import { createAppServer } from '../server.js';

const input = { season: 2026, week: 6, lastCompletedWeek: 5, asOf: '2026-10-15T12:00:00Z',
  schedule: { source: 'fixture', fetchedAt: '2026-10-15T11:00:00Z', complete: true, games: [
    { gameId: 'game', season: 2026, week: 6, away_team: 'ARI', home_team: 'ATL', kickoffAt: '2026-10-18T17:00:00Z', completed: false }] },
  dvp: { source: 'fixture', fetchedAt: '2026-10-15T10:00:00Z', completedWeeks: [1], scoring: 'FULL_PPR', observations: [], byDefense: new Map([
    ['ATL|WR', { valid: true, games: 1, allowedPerGame: 35 }], ['ARI|WR', { valid: true, games: 1, allowedPerGame: 25 }] ]) } };
const bundle = buildSosBundle(input);
const snapshot = bundle.horizons.FANTASY_ROS;

test('SOS exports preserve exact displayed values, nulls, dates and official ranks without mutation', () => {
  const before = structuredClone(snapshot);
  const json = JSON.parse(buildSosAiContext(snapshot, { format: 'JSON', scope: 'SELECTED', team: 'ARI', exportedAt: '2026-10-15T13:00:00Z', filters: { displayedWeek: 7 } }));
  assert.deepEqual(json.snapshot.teams, snapshot.teams.filter(t => t.team === 'ARI'));
  assert.equal(json.snapshot.asOf, input.asOf);
  assert.equal(json.snapshot.sources.dvp.fetchedAt, input.dvp.fetchedAt);
  assert.notEqual(json.exportedAt, json.snapshot.asOf);
  assert.equal(json.snapshot.teams[0].opponents.length, 1); // Week detail filter cannot change score inputs.
  const all = JSON.parse(buildSosAiContext(snapshot, { format: 'JSON' }));
  assert.equal(all.snapshot.teams.length, 32);
  assert.equal(all.snapshot.teams.find(t => t.team === 'BAL').rank, null);
  assert.deepEqual(snapshot, before);
  const markdown = buildSosAiContext(snapshot);
  assert.match(markdown, /jamais précision prédictive/);
  assert.match(markdown, /Un rang extrême peut donc rester neutre/);
  assert.match(markdown, /S6 ATL/);
});

test('comparison refuses mixed snapshots; compact and extremes preserve official cutoff ties', () => {
  const json = JSON.parse(buildSosAiContext(snapshot, { format: 'JSON', detail: 'COMPACT', comparisons: [bundle.horizons.PAST] }));
  assert.equal(json.comparisons[0].window.horizon, 'PAST');
  assert.ok(json.snapshot.teams.every(t => !('opponents' in t)));
  assert.throws(() => buildSosAiContext(snapshot, { comparisons: [{ ...bundle.horizons.PAST, snapshotId: 'other' }] }), /même snapshot/);
  assert.throws(() => buildSosAiContext(null), /indisponible/);
  assert.throws(() => buildSosAiContext(snapshot, { scope: 'SELECTED' }), /Sélectionnez/);
  const tied = { ...snapshot, teams: [{ team: 'A', rank: 10 }, { team: 'B', rank: 10 }, { team: 'C', rank: null }, { team: 'D', rank: 23 }] };
  assert.deepEqual(JSON.parse(buildSosAiContext(tied, { format: 'JSON', scope: 'EXTREMES' })).snapshot.teams.map(t => t.team), ['A', 'B', 'D']);
});

test('Coach handoff retains original snapshot after login; invalid or expired storage is ignored', () => {
  const exportedAt = '2026-10-15T13:00:00Z';
  const raw = buildSosAiContext(snapshot, { format: 'JSON', exportedAt, scope: 'SELECTED', team: 'ARI' });
  const storage = { getItem: () => raw };
  const value = readSosHandoff(storage, Date.parse(exportedAt) + 1000);
  assert.equal(value.snapshot.snapshotId, snapshot.snapshotId);
  assert.match(formatSosHandoff(value), new RegExp(snapshot.snapshotId));
  assert.equal(readSosHandoff(storage, Date.parse(exportedAt) + 3_600_001), null);
  assert.equal(readSosHandoff({ getItem: () => '{' }), null);
  assert.equal(readSosHandoff({ getItem: () => { throw Error(); } }), null);
});

test('bundle API serves all horizons from one captured source without exposing ingestion inputs', async t => {
  let calls = 0;
  const app = createAppServer({ getSosBundle: async () => { calls++; return bundle; } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const res = await fetch(`${base}/api/sos/bundle`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(calls, 1);
  assert.equal(Object.keys(data.horizons).length, 5);
  assert.ok(Object.values(data.horizons).every(s => s.snapshotId === snapshot.snapshotId));
  assert.deepEqual(data.horizons.FANTASY_ROS, snapshot);
  assert.equal(data.inputs, undefined);
  assert.equal((await fetch(`${base}/api/sos/bundle?position=QB`)).status, 400);
  assert.equal((await fetch(`${base}/api/sos/bundle?horizon=PAST&perspective=FROZEN`)).status, 400);
});
