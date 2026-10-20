import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildSosBundle, createSosService, replaySosBundle } from '../scripts/sos-service.js';
import { createSosStore } from '../scripts/sos-store.js';
import { buildSosDvp, hashSos } from '../scripts/sos-sources.js';
import { trackSos, formatSosLines } from '../scripts/sos-tracking.js';
import { buildCoachSos, formatCoachSos } from '../scripts/sos-coach.js';
import { buildSosAiContext } from '../public/assets/sos-ai-context.js';
import { calculatePositionSos, calculateWrSos } from '../public/assets/wr-ros-sos.js';
import { createAppServer } from '../server.js';

// This fixture predates RB support. Lock both its original hash and full output.
const golden = JSON.parse(await readFile(new URL('./fixtures/sos-wr-v1.json', import.meta.url), 'utf8'));
const fixture = () => {
  const inputs = structuredClone(golden.inputs);
  inputs.dvp.byDefense = new Map(inputs.dvp.byDefense);
  return inputs;
};
const rbInput = () => {
  const inputs = fixture();
  inputs.dvp.byDefense = new Map([...inputs.dvp.byDefense].map(([key, row]) => [key.replace('|WR', '|RB'), { ...row, allowedPerGame: row.allowedPerGame / 2 }]));
  return inputs;
};
const bundles = () => ({ WR: buildSosBundle(fixture()), RB: buildSosBundle(rbInput(), 'RB') });

test('legacy WR hash and horizons remain byte-identical and replay; RB has separate version and fields', async () => {
  const { WR, RB } = bundles();
  assert.equal(WR.snapshotId, '7e4556e96a20b1ce933490941896b3423d2abcc6e69d054d2ee0ecdc81fc139c');
  assert.equal(hashSos(WR.horizons), hashSos(golden.horizons));
  assert.equal(replaySosBundle(golden).reproduced, true);
  assert.equal(replaySosBundle(JSON.parse(JSON.stringify(RB))).reproduced, true);
  assert.notEqual(WR.snapshotId, RB.snapshotId);
  assert.equal(RB.methodologyVersion, 'RB_TEMPORAL_V1');
  const team = RB.horizons.NFL_ROS.teams.find(t => t.team === 'ARI');
  assert.equal(team.position, 'RB');
  assert.equal(team.sosScore, 16.88);
  assert.equal(team.opponents[0].opponentRbPprAllowed, 15);
  assert.equal(team.opponents[0].opponentWrPprAllowed, undefined);
  assert.deepEqual(calculateWrSos(fixture()), calculatePositionSos({ ...fixture(), position: 'WR' }));
  assert.throws(() => calculatePositionSos({ ...fixture(), position: 'TE' }), /position/);
  const json = JSON.parse(buildSosAiContext(RB.horizons.NFL_ROS, { format: 'JSON' }));
  assert.equal(json.schema, 'adineu.sos.v1');
  assert.equal(json.position, 'RB');
  assert.match(buildSosAiContext(RB.horizons.NFL_ROS), /Position: RB/);
  assert.doesNotMatch(buildSosAiContext(RB.horizons.NFL_ROS), /WR PPR|\$\{position\}/);
});

test('RB DvP sums all RBs only, includes rushing and receiving PPR and rejects invalid rows', () => {
  const game = { ...fixture().schedule.games[0], week: 1, completed: true };
  const base = { player_id: 'one', season_type: 'REG', position: 'RB', week: '1', team: 'ARI', opponent_team: 'ATL', game_id: game.gameId };
  for (const field of ['passing_yards', 'passing_tds', 'passing_interceptions', 'passing_2pt_conversions', 'rushing_yards', 'rushing_tds', 'rushing_2pt_conversions', 'receptions', 'receiving_yards', 'receiving_tds', 'receiving_2pt_conversions', 'fumbles_lost_total', 'fumble_recovery_tds']) base[field] = '0';
  const rows = [{ ...base, rushing_yards: '100', rushing_tds: '1', receptions: '2', receiving_yards: '20' }, { ...base, player_id: 'two', rushing_yards: '40' }, { ...base, player_id: 'wr', position: 'WR', receptions: '10' }];
  const build = rows => buildSosDvp({ position: 'RB', rows, games: [game], lastCompletedWeek: 1, fetchedAt: fixture().asOf, source: 'fixture' });
  assert.equal(build(rows).byDefense.get('ATL|RB').allowedPerGame, 24);
  assert.equal(build(rows).byDefense.has('ATL|WR'), false);
  assert.equal(build(rows).observations[0].actualAllowedPpr, 24);
  assert.equal(build([...rows, rows[0]]).byDefense.size, 0);
  assert.equal(build([{ ...base, receptions: '' }]).byDefense.size, 0);
});

test('shared service loads source rows once for concurrent positions and separates clones', async () => {
  let calls = 0;
  const service = createSosService({ now: () => Date.parse(fixture().asOf), load: async () => { calls++; return { ...fixture(), rbDvp: rbInput().dvp }; } });
  const [wr, rb] = await Promise.all([service.getBundle(), service.getBundle('RB')]);
  assert.equal(calls, 1);
  assert.equal(wr.methodologyVersion, 'WR_TEMPORAL_V1');
  assert.equal(rb.methodologyVersion, 'RB_TEMPORAL_V1');
  rb.horizons.NFL_ROS.teams = [];
  assert.equal((await service.getBundle('RB')).horizons.NFL_ROS.teams.length, 32);
});

test('local weekly archives keep WR and RB pointers and lists separate', async () => {
  const directory = await mkdtemp(`${tmpdir()}/sos-positions-`);
  try {
    const store = createSosStore({ directory });
    const { WR, RB } = bundles();
    assert.equal((await store.save(WR)).published, true);
    assert.equal((await store.save(RB)).published, true);
    assert.deepEqual((await store.list()).map(r => r.snapshotId), [WR.snapshotId]);
    assert.deepEqual((await store.list('RB')).map(r => r.snapshotId), [RB.snapshotId]);
    assert.equal((await store.save(buildSosBundle({ ...rbInput(), asOf: '2026-10-15T12:01:00Z' }, 'RB'))).snapshotId, RB.snapshotId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('weekly tracking evaluates both positions separately and survives either position failure', async () => {
  const data = bundles(); const writes = []; const evaluations = [];
  const store = { list: async () => Object.values(data), load: async id => Object.values(data).find(b => b.snapshotId === id),
    save: async b => { writes.push(b.methodologyVersion); return { published: true }; },
    saveEvaluation: async (id, result) => { evaluations.push([id, result.position]); return id; } };
  const service = { getBundle: async position => data[position] };
  const result = await trackSos({ service, store });
  assert.equal(result.positions.RB.published, true);
  assert.deepEqual(evaluations.map(([id, position]) => id === data[position].snapshotId), [true, true]);
  assert.equal(writes.length, 2);
  for (const failed of ['WR', 'RB']) {
    writes.length = 0;
    const result = await trackSos({ store, service: { getBundle: async position => { if (position === failed) throw Error('fixture failure'); return data[position]; } } });
    assert.equal(result.positions[failed].error, 'fixture failure');
    assert.equal(writes.length, 1);
    assert.notEqual(writes[0], data[failed].methodologyVersion);
  }
});

test('Coach maps roster and waiver WR/RB to their own bundle without altering decisions', () => {
  const { WR, RB } = bundles();
  const context = { myTeam: { bench: [{ sleeperId: 'w', name: 'Receiver', position: 'WR', nflTeam: 'ARI' }, { sleeperId: 'r', name: 'Runner', position: 'RB', nflTeam: 'ARI' }] } };
  const waivers = { byPosition: { RB: [{ sleeperId: 'f', name: 'Free runner', position: 'RB', nflTeam: 'ATL' }] } };
  const before = structuredClone({ context, waivers });
  const result = buildCoachSos({ context, waivers, bundle: WR, rbBundle: RB, now: Date.parse(WR.asOf) });
  assert.equal(result.players.length, 3);
  assert.strictEqual(result.players[1].sos, RB.horizons.FANTASY_ROS.teams.find(t => t.team === 'ARI'));
  assert.equal(result.players[2].scope, 'WAIVER');
  assert.match(formatCoachSos(result), /RB PPR/);
  assert.equal(result.rbAiContext.position, 'RB');
  assert.deepEqual({ context, waivers }, before);
});

// Invoke the real Node HTTP request handler without binding a socket.
async function request(app, path) {
  let status;
  let body;
  await app.listeners('request')[0]({ url: path, method: 'GET', headers: {} }, {
    setHeader() {}, writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); }
  });
  return { status, body };
}

test('all SOS API routes validate position, isolate archives and select the right live bundle', async () => {
  const data = bundles();
  const app = createAppServer({ getSosBundle: async (position = 'WR') => data[position],
    sosArchives: { list: async () => Object.values(data), load: async id => Object.values(data).find(b => b.snapshotId === id) } });
  for (const path of ['', '/bundle', '/snapshots', '/trends', '/evaluation']) {
    for (const position of ['QB', 'rb', '']) {
      const response = await request(app, `/api/sos${path}?position=${position}`);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'INVALID_SOS_QUERY');
    }
  }
  for (const position of ['WR', 'RB']) {
    const response = await request(app, `/api/sos?position=${position}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.snapshotId, data[position].snapshotId);
    assert.equal(response.body.inputs, undefined);
    const snapshots = await request(app, `/api/sos/snapshots?position=${position}`);
    assert.deepEqual(snapshots.body.snapshots.map(b => b.snapshotId), [data[position].snapshotId]);
    const trends = await request(app, `/api/sos/trends?position=${position}`);
    assert.deepEqual(trends.body.snapshots.map(b => b.snapshotId), [data[position].snapshotId]);
    const other = position === 'WR' ? 'RB' : 'WR';
    const mixed = await request(app, `/api/sos/evaluation?position=${position}&snapshotId=${data[other].snapshotId}`);
    assert.equal(mixed.status, 404);
    const evaluation = await request(app, `/api/sos/evaluation?position=${position}&snapshotId=${data[position].snapshotId}`);
    assert.equal(evaluation.status, 200);
    assert.equal(evaluation.body.position, position);
    const bundle = await request(app, `/api/sos/bundle?position=${position}`);
    assert.equal(bundle.body.horizons.NFL_ROS.snapshotId, data[position].snapshotId);
  }
  assert.equal((await request(app, '/api/sos')).body.snapshotId, data.WR.snapshotId);
});

test('RB coverage, tied ranks and frozen history retain the positional gates', async () => {
  const { frozenPastSos } = await import('../scripts/sos-history.js');
  const inputs = rbInput();
  inputs.dvp.byDefense.get('ARI|RB').allowedPerGame = 15;
  const tied = buildSosBundle(inputs, 'RB');
  assert.equal(tied.horizons.NFL_ROS.teams.filter(t => t.rank === 1).length, 2);
  inputs.dvp.byDefense.delete('ATL|RB');
  const missing = buildSosBundle(inputs, 'RB').horizons.NFL_ROS.teams.find(t => t.team === 'ARI');
  assert.equal(missing.rank, null);
  assert.equal(missing.sosScore, null);
  assert.equal(missing.reason, 'DVP_UNAVAILABLE');
  const currentInputs = rbInput();
  currentInputs.asOf = '2026-10-20T12:00:00Z';
  currentInputs.week = 7; currentInputs.lastCompletedWeek = 6;
  currentInputs.schedule.games[0].completed = true;
  const current = buildSosBundle(currentInputs, 'RB');
  const past = frozenPastSos(current, [tied, bundles().WR]);
  assert.deepEqual(past.archiveIds, [tied.snapshotId]);
  assert.equal(past.teams.find(t => t.team === 'ARI').opponents[0].opponentRbPprAllowed, 15);
  assert.equal(past.teams.find(t => t.team === 'ARI').opponents[0].opponentWrPprAllowed, undefined);
});

test('Tuesday SOS lines weight archives by sample and compare with the league-average baseline', () => {
  const lines = formatSosLines({ positions: {
    WR: { evaluations: [{ sample: 28, mae: 8.5, baselineMae: 7.8 }, { sample: 0, mae: null, baselineMae: null }] },
    RB: { evaluations: [] }, TE: { skipped: 'POSITION_UNAVAILABLE' } } });
  assert.deepEqual(lines, ['SOS WR : 28 prévisions · MAE 8.5 vs 7.8 (moyenne ligue) · skill -9 %', 'SOS RB : aucune prévision évaluée (n=0).', 'SOS TE : aucune prévision évaluée (n=0).']);
  assert.deepEqual(formatSosLines({ error: 'SOS_TRACKING_UNAVAILABLE' }), []);
});
