import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSosAiContext, readSosHandoff, formatSosHandoff } from '../public/assets/sos-ai-context.js';
import { sosDifficultyFields } from '../public/assets/sos-insights.js';
import { evaluateSos } from '../scripts/sos-feedback.js';
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
  assert.deepEqual(json.snapshot.teams, snapshot.teams.filter(t => t.team === 'ARI').map(t => ({ ...t, ...sosDifficultyFields(t) })));
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


test('Markdown rounds numeric interpretation values, JSON retains full precision including compact summaries', () => {
  const changed = structuredClone(snapshot);
  changed.leagueAverage = 32.2106329113924;
  changed.teams[0].opponents[0].adjustedDifficulty = 34.57898734177215;
  changed.teams[0].opponents[0].opponentWrPprAllowed = 36.727999999999994;
  const text = buildSosAiContext(changed);
  assert.match(text, /moyenne NFL=32.21/);
  assert.match(text, /ajusté 34.58/);
  assert.match(text, /DvP brut 36.73/);
  assert.doesNotMatch(text, /34\.578987|36\.727999|32\.210632/);
  const json = JSON.parse(buildSosAiContext(changed, { format: 'JSON' }));
  assert.equal(json.snapshot.teams[0].opponents[0].adjustedDifficulty, 34.57898734177215);
  const compact = JSON.parse(buildSosAiContext(changed, { format: 'JSON', detail: 'COMPACT' }));
  assert.equal(compact.snapshot.summary.teams[0].easiestMatchups[0].adjustedDifficulty, 34.57898734177215);
  assert.match(formatSosHandoff(compact), /S6 ATL \(34.58\)/);
});

test('MODEL_FEEDBACK distinguishes pending, unavailable and evaluated evidence with authentic forecast provenance', () => {
  const forecast = bundle.horizons.NFL_ROS;
  const evaluation = { ...evaluateSos(bundle, [{ gameId: 'game', defense: 'ATL', kickoff: '2026-10-18T17:00:00Z', actualAllowedPpr: 38.123456 }], '2026-10-20T12:00:00Z'), forecast };
  const changed = { ...snapshot, snapshotId: 'new-current', asOf: '2026-10-20T12:00:00Z' };
  const raw = buildSosAiContext(changed, { format: 'JSON', scope: 'SELECTED', team: 'ARI', modelFeedback: evaluation });
  const data = JSON.parse(raw);
  assert.equal(data.modelFeedback.status, 'AVAILABLE');
  assert.equal(data.modelFeedback.sample, 1);
  assert.equal(data.modelFeedback.forecast.asOf, forecast.asOf);
  assert.notEqual(data.modelFeedback.forecast.snapshotId, data.snapshot.snapshotId);
  assert.equal(data.modelFeedback.rows[0].actualAllowedPpr, 38.123456);
  assert.equal(data.modelFeedback.metricScope, 'ALL_MATCHUPS_IN_FORECAST');
  assert.match(formatSosHandoff(data), /observé 38.12/);
  const pending = evaluateSos(bundle, [], '2026-10-15T13:00:00Z');
  assert.equal(JSON.parse(buildSosAiContext(snapshot, { format: 'JSON', modelFeedback: pending })).modelFeedback.status, 'PENDING');
  assert.equal(JSON.parse(buildSosAiContext(snapshot, { format: 'JSON' })).modelFeedback.status, 'UNAVAILABLE');
  assert.throws(() => buildSosAiContext(changed, { modelFeedback: { ...evaluation, forecast: null } }), /Provenance/);
});

test('evaluation API includes immutable forecast and separately dated observation provenance', async t => {
  const app = createAppServer({ getSosBundle: async () => bundle, sosArchives: { load: async () => bundle } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.address().port}/api/sos/evaluation?snapshotId=${bundle.snapshotId}`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.forecast.snapshotId, bundle.snapshotId);
  assert.equal(data.forecast.window.viewMode, 'AS_OF_SNAPSHOT');
  assert.equal(data.observationSources.dvp.fetchedAt, input.dvp.fetchedAt);
  assert.equal(data.sample, 0);
});
