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
test('operator reviews require the Coach session, enforce same-origin writes and keep ingestion credentials separate', async () => {
  let writes = 0;
  await serve({ coachToken: 'coach', coachPassword: 'test-only-password', secureCookies: false,
    playerIntelligenceToken: 'intelligence-only',
    playerIntelligenceService: {
      reviewList: async ({ team }) => ({ scope: { targetWeek: 11 }, team, observations: [] }),
      reviewNews: async () => { writes++; return { changed: true, shouldRecompute: true }; }
    }
  }, async base => {
    const path = `${base}/api/coach/player-intelligence`;
    assert.equal((await fetch(path)).status, 404);
    assert.equal((await fetch(path, { headers })).status, 404);
    assert.equal((await fetch(path, { headers: { authorization: 'Bearer coach' } })).status, 200);
    const login = await fetch(`${base}/api/coach-session`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-only-password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(path, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(path, { method: 'PUT', headers: { cookie }, body: '{}' })).status, 403);
    assert.equal((await fetch(path, { method: 'PUT', headers: { cookie, origin: 'https://foreign.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(path, { method: 'PUT', headers: { cookie, origin: base }, body: '{bad' })).status, 400);
    assert.equal((await fetch(path, { method: 'PUT', headers: { cookie, origin: base }, body: 'x'.repeat(5000) })).status, 413);
    assert.equal(writes, 0);
    assert.equal((await fetch(path, { method: 'PUT', headers: { cookie, origin: base }, body: '{}' })).status, 200);
    assert.equal(writes, 1);
  });
});
test('news collection and delivery acknowledgement use the dedicated private token', async () => {
  const calls = [];
  await serve({ playerIntelligenceToken: 'intelligence-only', playerIntelligenceService: {
    collectNews: async input => { calls.push(input); return { notifyNews: false, shouldRecompute: false }; },
    acknowledgeNews: async input => { calls.push(input); return { acknowledged: true }; }
  } }, async base => {
    assert.equal((await fetch(`${base}/api/player-intelligence/collect-news`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/player-intelligence/collect-news`, { headers })).status, 405);
    const collected = await fetch(`${base}/api/player-intelligence/collect-news?team=t0z`, { method: 'POST', headers, body: '{}' });
    assert.equal(collected.status, 200);
    assert.equal((await collected.json()).shouldRecompute, false);
    const ack = await fetch(`${base}/api/player-intelligence/news/ack`, { method: 'POST', headers, body: JSON.stringify({ deliveryId: 'delivery' }) });
    assert.equal(ack.status, 200);
    assert.deepEqual(calls, [{ team: 't0z' }, { deliveryId: 'delivery' }]);
  });
});
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
