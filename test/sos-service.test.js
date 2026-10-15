import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSosService, buildSosBundle, replaySosBundle } from '../scripts/sos-service.js';
import { createSosStore, historicalSos } from '../scripts/sos-store.js';
import { evaluateSos, spearman } from '../scripts/sos-feedback.js';
import { buildSosDvp, parseSosCsv } from '../scripts/sos-sources.js';
import { createAppServer } from '../server.js';

function fixture() {
  return { season: 2026, asOf: '2026-10-15T12:00:00Z', week: 6, lastCompletedWeek: 5,
    schedule: { source: 'nflverse', fetchedAt: '2026-10-15T11:00:00Z', complete: true, games: [
      { gameId: '6_ARI_ATL', season: 2026, week: 6, away_team: 'ARI', home_team: 'ATL', kickoffAt: '2026-10-15T13:00:00Z', completed: false }] },
    dvp: { source: 'stats', fetchedAt: '2026-10-15T11:00:00Z', scoring: 'FULL_PPR', completedWeeks: [1], observations: [],
      byDefense: new Map([['ATL|WR', { valid: true, games: 1, allowedPerGame: 30 }], ['ARI|WR', { valid: true, games: 1, allowedPerGame: 40 }]]) } };
}

test('shared bundle cache merges concurrent loads, returns clones and expires at kickoff', async () => {
  let now = Date.parse(fixture().asOf), calls = 0;
  const service = createSosService({ now: () => now, ttlMs: 100000000, load: async () => { calls++; return { ...fixture(), asOf: new Date(now).toISOString() }; } });
  const [a, b] = await Promise.all([service.getBundle(), service.getBundle()]);
  assert.equal(a.snapshotId, b.snapshotId); assert.equal(calls, 1);
  a.horizons.FANTASY_ROS.teams = [];
  assert.equal((await service.getBundle()).horizons.FANTASY_ROS.teams.length, 32);
  now = Date.parse('2026-10-15T13:00:00Z');
  const after = await service.getBundle();
  assert.equal(calls, 2);
  assert.equal(after.horizons.FANTASY_ROS.rankedTeams, 0);
});

test('atomic archive publication keeps first weekly capture and replay output', async () => {
  const directory = await mkdtemp(`${tmpdir()}/adineu-sos-`);
  try {
    const store = createSosStore({ directory });
    const bundle = buildSosBundle(fixture());
    const results = await Promise.all([store.save(bundle), store.save(bundle)]);
    assert.equal(results.filter(r => r.published).length, 1);
    const changed = buildSosBundle({ ...fixture(), asOf: '2026-10-15T12:01:00Z' });
    assert.equal((await store.save(changed)).snapshotId, bundle.snapshotId);
    assert.equal((await store.list()).length, 1);
    const restored = await store.load(bundle.snapshotId);
    assert.deepEqual(restored, JSON.parse(JSON.stringify(bundle)));
    assert.equal(replaySosBundle(restored).reproduced, true);
    const corrupted = structuredClone(restored); corrupted.horizons.FANTASY_ROS.teams[0].sosScore = 999;
    assert.throws(() => replaySosBundle(corrupted), /SOS_REPLAY_MISMATCH/);
    const historical = historicalSos(restored, 'FANTASY_ROS');
    assert.equal(historical.window.viewMode, 'AS_OF_SNAPSHOT');
    assert.equal(historical.teams.find(t => t.team === 'ARI').sosScore, bundle.horizons.FANTASY_ROS.teams.find(t => t.team === 'ARI').sosScore);
    await assert.rejects(store.load('../secret'));
    assert.equal(await store.load('0'.repeat(64)), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('feedback evaluates archived forecasts only against completed results, no invented history', () => {
  const bundle = buildSosBundle(fixture());
  const observations = [{ gameId: '6_ARI_ATL', week: 6, defense: 'ATL', actualAllowedPpr: 30, kickoff: '2026-10-15T13:00:00Z' }];
  const result = evaluateSos(bundle, observations, '2026-10-16T12:00:00Z');
  assert.equal(result.sample, 1);
  assert.equal(result.mae, 3.75);
  assert.equal(result.exclusions.MISSING_RESULT, 1);
  assert.equal(result.reliability, 'INSUFFICIENT_SAMPLE');
  observations[0].kickoff = '2026-10-15T11:00:00Z';
  assert.equal(evaluateSos(bundle, observations, '2026-10-16T12:00:00Z').exclusions.LATE_SNAPSHOT, 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [3, 2, 1]), null);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('CSV parsing and historical team adapter preserve numeric zero and reject incomplete rows', () => {
  assert.deepEqual(parseSosCsv('a,b\n"one,two","say ""hi"""\n'), [{ a: 'one,two', b: 'say "hi"' }]);
  const game = { ...fixture().schedule.games[0], week: 1, completed: true };
  const base = { player_id: 'gsis', season_type: 'REG', position: 'WR', week: '1', team: 'ARI', opponent_team: 'ATL', game_id: game.gameId };
  for (const field of ['passing_yards', 'passing_tds', 'passing_interceptions', 'passing_2pt_conversions', 'rushing_yards', 'rushing_tds', 'rushing_2pt_conversions', 'receptions', 'receiving_yards', 'receiving_tds', 'receiving_2pt_conversions', 'fumbles_lost_total', 'fumble_recovery_tds']) base[field] = '0';
  const build = rows => buildSosDvp({ rows, games: [game], lastCompletedWeek: 1, fetchedAt: fixture().asOf, source: 'fixture' });
  assert.equal(build([base]).byDefense.get('ATL|WR').allowedPerGame, 0);
  assert.equal(build([{ ...base, receptions: '' }]).byDefense.size, 0);
  assert.equal(build([base, base]).byDefense.size, 0);
  assert.equal(build([{ ...base, game_id: 'wrong' }]).byDefense.size, 0);
});

test('HTTP SOS contract: validation, missing archives, shared response and no raw inputs', async () => {
  const bundle = buildSosBundle(fixture());
  const app = createAppServer({ getSosBundle: async () => bundle, sosArchives: { load: async () => null, list: async () => [] } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await fetch(`${base}/api/sos?horizon=ROS`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.snapshotId, bundle.snapshotId);
    assert.equal(body.inputs, undefined);
    assert.equal(body.teams.length, 32);
    for (const query of ['position=RB', 'horizon=WHOLE', 'snapshotId=../secret']) assert.equal((await fetch(`${base}/api/sos?${query}`)).status, 400);
    assert.equal((await fetch(`${base}/api/sos?snapshotId=${'0'.repeat(64)}`)).status, 404);
    assert.equal((await fetch(`${base}/api/sos/evaluation`)).status, 400);
    assert.equal((await fetch(`${base}/api/sos`, { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => app.close(resolve)); }
});
