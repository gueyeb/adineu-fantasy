import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.js';

async function serve(options, run) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const headers = { authorization: 'Bearer intelligence-only', 'content-type': 'application/json' };
test('private ingestion requires its own credential and rejects malformed, oversized or unsupported requests', async () => {
  let writes = 0;
  await serve({ playerIntelligenceToken: 'intelligence-only', coachToken: 'coach', playerIntelligenceService: { ingest: async () => { writes++; return { changed: true }; } } }, async base => {
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { method: 'POST', headers: { authorization: 'Bearer coach' } })).status, 401);
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { method: 'POST', headers, body: '{bad' })).status, 400);
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { headers })).status, 405);
    assert.equal((await fetch(`${base}/api/player-intelligence/other`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { method: 'POST', headers, body: 'x'.repeat(130 * 1024) })).status, 413);
    assert.equal(writes, 0);
    assert.equal((await fetch(`${base}/api/player-intelligence/ingest`, { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal(writes, 1);
  });
});
