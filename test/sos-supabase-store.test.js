import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseSosStore } from '../scripts/sos-store.js';
import { hashSos } from '../scripts/sos-sources.js';

// Exercise real supabase-js request generation against an isolated PostgREST test double.
// No production credentials or writes. DB uniqueness is the existing model_snapshots constraint.
test('Supabase store uses conflict-ignore, isolates SOS kinds and preserves first archived bundle', async () => {
  const rows = []; const writes = [];
  const fetchImpl = async (url, init) => {
    const query = new URL(url).searchParams;
    const headers = new Headers(init.headers);
    let result;
    if (init.method === 'POST') {
      const row = JSON.parse(init.body); writes.push(row);
      assert.match(headers.get('prefer'), /resolution=ignore-duplicates/);
      assert.equal(query.get('on_conflict'), 'season,week,kind');
      const existing = rows.find(r => r.season === row.season && r.week === row.week && r.kind === row.kind);
      if (!existing) rows.push(row);
      result = existing ? [] : [row];
    } else {
      result = rows.filter(row => [...query].every(([key, value]) => {
        if (!value.startsWith('eq.')) return true;
        const actual = key === 'settings->bundle->>snapshotId' ? row.settings.bundle?.snapshotId : row[key];
        return String(actual) === value.slice(3);
      }));
      if (headers.get('accept')?.includes('vnd.pgrst.object')) result = result[0] ?? null;
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const db = createClient('https://isolated-sos-test.supabase.co', 'test-only-key', { global: { fetch: fetchImpl }, auth: { persistSession: false } });
  const store = createSupabaseSosStore({ getSupabase: async () => db });
  const bundle = { snapshotId: hashSos('first'), season: 2026, week: 6, asOf: '2026-10-15T12:00:00Z', methodologyVersion: 'WR_TEMPORAL_V1', horizons: { FANTASY_ROS: { rankedTeams: 32 } } };
  assert.equal((await store.save(bundle)).published, true);
  const changed = { ...bundle, snapshotId: hashSos('second') };
  assert.equal((await store.save(changed)).snapshotId, bundle.snapshotId);
  assert.deepEqual(await store.load(bundle.snapshotId), bundle);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.load(changed.snapshotId), null);
  await store.saveEvaluation(bundle.snapshotId, { evaluatedAt: '2026-10-20T12:00:00Z', sample: 1 });
  assert.equal((await store.list()).length, 1);
  assert.ok(writes.every(row => row.kind.startsWith('sos-')));
  assert.ok(rows.length === 2);
});
