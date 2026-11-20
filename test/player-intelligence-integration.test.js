import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlayersIndex } from '../scripts/league-context.js';
import { loadDecisionEvidence } from '../scripts/decision-evidence.js';
import { createPlayerIntelligenceStore, normalizePlayerObservation } from '../scripts/player-intelligence.js';

test('current ingestion overlays the cached player index and feeds scoped decision evidence without another catalog download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-intelligence-integrated-'));
  const previous = process.env.PLAYER_INTELLIGENCE_DIR;
  const now = Date.now();
  const scope = { leagueId: '1392715510830878721', season: 2026, targetWeek: 11 };
  let catalogCalls = 0;
  const fetchImpl = async url => ({ ok: true, json: async () => {
    if (url.endsWith('/state/nfl')) return { season: '2026', week: 11, display_week: 11 };
    catalogCalls++;
    return { p: { full_name: 'Player', position: 'WR', team: 'LAR', injury_status: null, active: true } };
  } });
  try {
    process.env.PLAYER_INTELLIGENCE_DIR = directory;
    const initial = await getPlayersIndex({ fetchImpl });
    assert.equal(initial.get('p').injuryStatus, null);
    const row = normalizePlayerObservation({ ...scope, playerId: 'p', kind: 'INJURY', value: { outThroughWeek: 14 }, certainty: 'CONFIRMED', source: 'https://www.nfl.com/news/report', publishedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }, { index: initial, now, ...scope });
    await createPlayerIntelligenceStore({ directory }).ingest([row]);
    const updated = await getPlayersIndex({ fetchImpl });
    assert.equal(updated.get('p').injuryStatus, 'Out');
    assert.equal(updated.get('p').intelligence.source, row.source);
    assert.equal(initial.get('p').injuryStatus, null);
    assert.equal(catalogCalls, 1);
    const evidence = await loadDecisionEvidence({ leagueId: scope.leagueId, season: 2026, week: 11 });
    assert.equal(evidence.eventsById.p.outThroughWeek, 14);
    const past = await loadDecisionEvidence({ leagueId: scope.leagueId, season: 2026, week: 11, asOf: new Date(now - 5000).toISOString() });
    assert.equal(past.eventsById.p, undefined);
  } finally {
    if (previous === undefined) delete process.env.PLAYER_INTELLIGENCE_DIR; else process.env.PLAYER_INTELLIGENCE_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
});
