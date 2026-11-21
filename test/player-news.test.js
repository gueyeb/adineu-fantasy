import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOfficialPlayerNews, matchPlayerNews, claimNewsDelivery } from '../scripts/player-news.js';
import { createPlayerIntelligenceService } from '../scripts/player-intelligence-service.js';
import { createPlayerIntelligenceStore } from '../scripts/player-intelligence.js';

const at = Date.parse('2026-11-21T02:00:00Z');
const card = (slug = 'report', title = 'Puka Nacua update', date = '2026-11-20T20:00:00Z') => `<a href="https://www.nfl.com/news/${slug}"><p>${title}</p><p>Official news summary</p><time dateTime="${date}">hours ago</time></a>`;
const index = new Map([['p', { name: 'Puka Nacua', position: 'WR', nflTeam: 'LAR' }], ['b', { name: 'Example Backup', position: 'WR', nflTeam: 'LAR' }], ['other', { name: 'Another Player', position: 'WR', nflTeam: 'BUF' }]]);

test('dated official cards decode entities, deduplicate links and reject foreign, future and stale news', () => {
  const html = card('report', 'Puka Nacua&#x27;s update') + card('report', 'Puka Nacua&#x27;s update') + card('future', 'Future', '2026-12-01T00:00:00Z') + card('old', 'Old', '2026-11-01T00:00:00Z') + card('foreign').replace('www.nfl.com', 'evil.example');
  const rows = parseOfficialPlayerNews(html, { now: at });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].headline, "Puka Nacua's update");
  assert.equal(rows[0].publishedAt, '2026-11-20T20:00:00.000Z');
  assert.throws(() => parseOfficialPlayerNews('<html>no dated news</html>', { now: at }), /No recent/);
  assert.throws(() => parseOfficialPlayerNews(card('report', 'Headline', '2026-11-20'), { now: at }), /No recent/);
});

test('matching requires a unique complete name and selected player, never a surname', () => {
  const articles = parseOfficialPlayerNews(card('report', 'Puka Nacua and Another Player'), { now: at });
  assert.deepEqual(matchPlayerNews(articles, index, new Set(['p'])).map(row => row.playerId), ['p']);
  assert.equal(matchPlayerNews([{ ...articles[0], headline: 'Nacua update', summary: '' }], index, new Set(['p'])).length, 0);
  const duplicate = new Map([...index, ['duplicate', { name: 'Puka Nacua', position: 'WR', nflTeam: 'LAR' }]]);
  assert.equal(matchPlayerNews(articles, duplicate, new Set(['p'])).length, 0);
});

test('persistent news collection suppresses baseline, deduplicates, leases delivery, retries and acknowledges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-news-'));
  let clock = at, html = card(), newsFetches = 0;
  const store = createPlayerIntelligenceStore({ directory });
  const fetchImpl = async url => {
    if (url === 'https://www.nfl.com/news') { newsFetches++; return new Response(html); }
    return { ok: true, json: async () => url.endsWith('/state/nfl') ? { season: '2026', week: 11 } : url.endsWith('/rosters') ? [{ roster_id: 1, owner_id: 'u', players: ['p'] }] : [{ user_id: 'u', display_name: 't0z' }] };
  };
  const options = { store, getIndex: async () => index, fetchImpl, now: () => clock, leagueId: 'L' };
  let service = createPlayerIntelligenceService(options);
  try {
    const first = await service.collectNews();
    assert.equal(first.baseline, true);
    assert.equal(first.notifyNews, false);
    assert.equal(first.shouldRecompute, false);
    assert.equal((await store.load()).observations[0].certainty, 'REPORTED');
    clock += 31 * 60000;
    html += card('new-report', 'Example Backup could start');
    const next = await service.collectNews();
    assert.equal(next.notifyNews, true);
    assert.match(next.message, /Example Backup/);
    assert.equal(next.shouldRecompute, false);
    assert.equal((await service.collectNews()).notifyNews, false);
    assert.equal(newsFetches, 2);
    // Restart + expired lease retries the same delivery without refetching.
    clock += 6 * 60000;
    service = createPlayerIntelligenceService({ ...options, store: createPlayerIntelligenceStore({ directory }) });
    const retry = await service.collectNews();
    assert.equal(retry.deliveryId, next.deliveryId);
    assert.equal(retry.notifyNews, true);
    await service.acknowledgeNews({ deliveryId: retry.deliveryId });
    assert.equal((await service.collectNews()).notifyNews, false);
    clock += 31 * 60000;
    assert.equal((await service.collectNews()).notifyNews, false);
    await assert.rejects(service.acknowledgeNews({ deliveryId: retry.deliveryId }), /Unknown/);
    await assert.rejects(service.acknowledgeNews({ deliveryId: 'invalid' }), /Invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('delivery excludes expired stories and respects Telegram message size', () => {
  const queue = { pending: Array.from({ length: 5 }, (_, i) => ({ id: String(i), playerName: 'A Player', headline: 'x'.repeat(500), source: 'https://www.nfl.com/news/' + 'a'.repeat(370), publishedAt: new Date(at).toISOString(), expiresAt: new Date(at + 1000).toISOString() })) };
  const state = { playerNewsQueues: { scope: queue } };
  const result = claimNewsDelivery(state, { scopeKey: 'scope', now: at });
  assert.equal(result.notifyNews, true);
  assert.ok(result.message.length < 4000);
  assert.equal(claimNewsDelivery(state, { scopeKey: 'scope', now: at + 2000 }).notifyNews, false);
});

test('source failure does not advance the collection cursor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adineu-news-error-'));
  const store = createPlayerIntelligenceStore({ directory });
  const service = createPlayerIntelligenceService({ store, getIndex: async () => index, now: () => at, fetchImpl: async url => url === 'https://www.nfl.com/news' ? new Response('unavailable', { status: 503 }) : { ok: true, json: async () => url.endsWith('/state/nfl') ? { season: '2026', week: 11 } : url.endsWith('/rosters') ? [{ roster_id: 1, owner_id: 'u', players: ['p'] }] : [{ user_id: 'u', display_name: 't0z' }] } });
  try {
    await assert.rejects(service.collectNews(), /NFL news unavailable/);
    assert.equal((await store.load()).playerNewsQueues, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
