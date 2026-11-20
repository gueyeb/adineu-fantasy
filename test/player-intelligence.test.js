import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlayerIntelligenceStore, normalizePlayerObservation, applyPlayerIntelligence, intelligenceEvidence } from '../scripts/player-intelligence.js';
const now = Date.parse('2026-11-20T20:00:00Z');
const scope = { leagueId: 'L', season: 2026, targetWeek: 11 };
const index = new Map([['p', { id: 'p', name: 'Player', position: 'WR', nflTeam: 'LAR', injuryStatus: null }]]);
const event = (over = {}) => ({ ...scope, playerId: 'p', kind: 'STATUS', value: { injuryStatus: 'Out', practiceParticipation: 'DNP' }, source: 'https://www.nfl.com/news/report', publishedAt: '2026-11-20T19:00:00Z', expiresAt: '2026-11-21T19:00:00Z', certainty: 'CONFIRMED', ...over });
const normalize = e => normalizePlayerObservation(e, { index, now, ...scope });

test('ingestion validates identity, scope, source and dates; practice remains distinct from status', () => {
  const row = normalize(event());
  assert.equal(row.value.practiceParticipation, 'DNP');
  for (const change of [{ playerId: 'unknown' }, { targetWeek: 10 }, { season: 2025 }, { source: 'https://untrusted.example/report' }, { publishedAt: '2026-11-21T00:00:00Z' }, { expiresAt: '2026-11-19T00:00:00Z' }, { kind: 'STATUS', value: { injuryStatus: 'Likely' } }]) {
    assert.throws(() => normalize(event(change)));
  }
  assert.throws(() => normalize(event({ value: { nflTeam: 'KC' } })), /field/i);
});

test('reported news never overrides a platform status; expired evidence stops applying', () => {
  const confirmed = normalize(event());
  const reported = normalize(event({ certainty: 'REPORTED', publishedAt: '2026-11-20T19:30:00Z', value: { injuryStatus: null } }));
  const applied = applyPlayerIntelligence(index, [confirmed, reported], { now, ...scope });
  assert.equal(applied.get('p').injuryStatus, 'Out');
  assert.equal(index.get('p').injuryStatus, null, 'cached source stays immutable');
  assert.equal(applyPlayerIntelligence(index, [confirmed], { now: now + 2 * 86400000, ...scope }).get('p').injuryStatus, null);
  assert.equal(applyPlayerIntelligence(index, [confirmed], { now, ...scope, targetWeek: 12 }).get('p').injuryStatus, null);
});

test('confirmed injury and role evidence feed the existing decision engine, not hypotheses', () => {
  const rows = [normalize(event({ kind: 'INJURY', value: { outThroughWeek: 14 } })), normalize(event({ kind: 'ROLE', value: { announcedRole: 'STARTER', roleWeeks: 2 } }))];
  const evidence = intelligenceEvidence(rows, { now, ...scope });
  assert.equal(evidence.eventsById.p.outThroughWeek, 14);
  assert.equal(evidence.rolesById.p.roleConfirmation, 'CONFIRMED');
  assert.equal(evidence.rolesById.p.announcedRole, 'STARTER');
  assert.deepEqual(intelligenceEvidence(rows.map(r => ({ ...r, certainty: 'REPORTED' })), { now, ...scope }).rolesById, {});
});

test('private atomic store serializes writers, deduplicates content, rejects old overwrites and preserves scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adineu-intelligence-test-'));
  try {
    const store = createPlayerIntelligenceStore({ directory: dir });
    const row = normalize(event());
    assert.equal((await store.ingest([row])).changed, true);
    assert.equal((await store.ingest([row])).changed, false);
    assert.equal((await store.ingest([{ ...row, publishedAt: '2026-11-20T18:00:00Z', value: { injuryStatus: 'Questionable' } }])).changed, false);
    await Promise.all([store.ingest([normalize(event({ kind: 'INJURY', value: { outThroughWeek: 14 } }))]), store.ingest([normalize(event({ kind: 'ROLE', value: { announcedRole: 'STARTER' } }))])]);
    assert.equal((await store.load()).observations.length, 3);
    assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).version, 1);
    const restarted = createPlayerIntelligenceStore({ directory: dir });
    assert.equal((await restarted.load()).observations.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('official published facts outrank a later daily snapshot, and conflicts at one timestamp are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-intelligence-priority-'));
  try {
    const official = normalize(event());
    const snapshot = { ...official, source: 'https://api.sleeper.app/v1/players/nfl', timestampBasis: 'COLLECTED_SNAPSHOT', publishedAt: '2026-11-20T19:30:00Z', value: { injuryStatus: null } };
    assert.equal(applyPlayerIntelligence(index, [official, snapshot], { now, ...scope }).get('p').injuryStatus, 'Out');
    const store = createPlayerIntelligenceStore({ directory });
    await store.ingest([official]);
    await assert.rejects(store.ingest([{ ...official, value: { injuryStatus: 'Questionable' } }]), /Conflicting/);
    assert.equal((await store.load()).observations[0].value.injuryStatus, 'Out');
  } finally { await rm(directory, { force: true, recursive: true }); }
});

test('a confirmed return supersedes old absence evidence and a demotion revokes prior starter confirmation', () => {
  const injury = normalize(event({ kind: 'INJURY', value: { outThroughWeek: 14 } }));
  const noAlert = normalize(event({ publishedAt: '2026-11-20T19:20:00Z', value: { injuryStatus: null } }));
  assert.equal(applyPlayerIntelligence(index, [injury, noAlert], { now, ...scope }).get('p').injuryStatus, 'Out');
  const returned = normalize(event({ kind: 'RETURN', publishedAt: '2026-11-20T19:30:00Z', value: { clearedForWeek: 11 } }));
  assert.equal(applyPlayerIntelligence(index, [injury, returned], { now, ...scope }).get('p').injuryStatus, null);
  assert.equal(intelligenceEvidence([injury, returned], { now, ...scope }).eventsById.p.type, 'RETURN');
  const starter = normalize(event({ kind: 'ROLE', value: { announcedRole: 'STARTER' } }));
  const demoted = normalize(event({ kind: 'ROLE', publishedAt: '2026-11-20T19:30:00Z', value: { announcedRole: 'BACKUP' } }));
  assert.equal(intelligenceEvidence([starter, demoted], { now, ...scope }).rolesById.p.roleConfirmation, 'UNCONFIRMED');
});
