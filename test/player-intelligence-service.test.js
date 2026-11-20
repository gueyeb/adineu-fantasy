import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlayerIntelligenceService } from '../scripts/player-intelligence-service.js';
import { createPlayerIntelligenceStore } from '../scripts/player-intelligence.js';
const now = Date.parse('2026-11-20T20:00:00Z');
const index = new Map([['p', { id: 'p', name: 'Player', position: 'WR', nflTeam: 'LAR', injuryStatus: 'Out', rosterStatus: 'Active', practiceParticipation: 'DNP' }], ['backup', { id: 'backup', name: 'Backup', position: 'WR', nflTeam: 'LAR', injuryStatus: null }]]);
const fakeFetch = async url => ({ ok: true, json: async () => url.endsWith('/state/nfl') ? { season: '2026', week: 11, display_week: 11 } : url.endsWith('/rosters') ? [{ roster_id: 1, owner_id: 'u', players: ['p'] }] : [{ user_id: 'u', display_name: 't0z' }] });

test('daily collector monitors roster and same-position teammates, persists cooldown across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-intelligence-service-'));
  let calls = 0;
  const options = { store: createPlayerIntelligenceStore({ directory }), getIndex: async () => { calls++; return index; }, fetchImpl: fakeFetch, now: () => now, leagueId: 'L' };
  try {
    const service = createPlayerIntelligenceService(options);
    const first = await service.collect({ team: 't0z' });
    assert.equal(first.baseline, true);
    assert.equal(first.monitoredPlayers, 2);
    const restarted = createPlayerIntelligenceService({ ...options, store: createPlayerIntelligenceStore({ directory }) });
    assert.equal((await restarted.collect({ team: 't0z' })).status, 'DAILY_SOURCE_COOLDOWN');
    assert.equal(calls, 1);
    const rows = (await restarted.status()).observations;
    assert.equal(rows[0].timestampBasis, 'COLLECTED_SNAPSHOT');
    assert.equal(rows[0].value.practiceParticipation, 'DNP');
  } finally { await rm(directory, { force: true, recursive: true }); }
});

test('ingest is all-or-nothing, unchanged facts do not trigger recomputation, reported news remains informational', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-intelligence-service-'));
  const store = createPlayerIntelligenceStore({ directory });
  const service = createPlayerIntelligenceService({ store, getIndex: async () => index, fetchImpl: fakeFetch, now: () => now, leagueId: 'L' });
  const row = { leagueId: 'L', season: 2026, targetWeek: 11, playerId: 'p', source: 'https://www.nfl.com/news/report', kind: 'INJURY', value: { outThroughWeek: 14 }, certainty: 'CONFIRMED', publishedAt: '2026-11-20T19:00:00Z', expiresAt: '2026-11-21T19:00:00Z' };
  try {
    await assert.rejects(service.ingest({ observations: [row, { ...row, playerId: 'unknown' }] }));
    assert.equal((await store.load()).observations.length, 0);
    assert.equal((await service.ingest({ observations: [row] })).shouldRecompute, true);
    assert.equal((await service.ingest({ observations: [row] })).shouldRecompute, false);
    assert.equal((await service.ingest({ observations: [{ ...row, kind: 'NEWS', certainty: 'REPORTED', value: { headline: 'Return is possible' } }] })).shouldRecompute, false);
  } finally { await rm(directory, { force: true, recursive: true }); }
});
