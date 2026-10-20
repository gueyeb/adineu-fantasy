import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { parseEcrData, matchExpertPlayers, spearman, benchmarkMetrics, scoreExpertSnapshot } from '../public/assets/expert-benchmark.js';
import { captureExperts, createExpertStore, scoreExperts, formatExpertBenchmark } from '../scripts/expert-benchmark.js';
import { createAppServer } from '../server.js';
const capturedAt = '2026-10-25T09:00:00Z';
const fixtures = Object.fromEntries(await Promise.all(['WR', 'DST'].map(async position => [position, await readFile(new URL(`./fixtures/fantasypros-ecr-${position.toLowerCase()}-w7.html`, import.meta.url), 'utf8')])));

test('ECR fixtures parse JSON safely and reject changed scope/format', () => {
  for (const position of ['WR', 'DST']) {
    const data = parseEcrData(fixtures[position], { season: 2026, week: 7, position });
    assert.ok(data.players.length > 0);
    assert.ok(data.total_experts > 0);
    assert.throws(() => parseEcrData(fixtures[position], { season: 2026, week: 8, position }), /SCOPE/);
  }
  assert.throws(() => parseEcrData('no data'), /MISSING/);
  assert.throws(() => parseEcrData('var ecrData = {broken};'), SyntaxError);
});

test('unique normalized name + team + position, DST team and strict kickoff cutoff', () => {
  const index = new Map([['1', { name: 'D’Andre Swift Jr.', nflTeam: 'CHI', position: 'RB' }], ['CHI', { name: 'Chicago Bears', nflTeam: 'CHI', position: 'DEF' }], ['2', { name: 'Duplicate', nflTeam: 'BUF', position: 'WR' }], ['3', { name: 'Duplicate', nflTeam: 'BUF', position: 'WR' }]]);
  const row = { name: 'DAndre Swift', team: 'CHI', position: 'RB', rank: 1, points: '12.4', kickoff: Date.parse(capturedAt) / 1000 + 1 };
  const result = matchExpertPlayers([row, { ...row, name: 'Duplicate', team: 'BUF', position: 'WR' }, { ...row, name: 'Bears', position: 'DST' }, { ...row, team: 'DET' }], index, capturedAt);
  assert.deepEqual(result.players.map(player => player.id), ['1', 'CHI']);
  assert.equal(result.excluded.identity, 2);
  assert.equal(matchExpertPlayers([{ ...row, kickoff: Date.parse(capturedAt) / 1000 }], index, capturedAt).excluded.kickoff, 1);
  assert.equal(matchExpertPlayers([{ ...row, kickoff: null }], index, capturedAt).excluded.kickoff, 1);
});

test('metrics cover ties, inverse order, missing point forecasts, empty and constant samples', () => {
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 2], [2, 2, 3]), 1);
  assert.equal(spearman([1, 1], [1, 2]), null);
  assert.equal(spearman([], []), null);
  const result = benchmarkMetrics([{ rank: 1, points: 12, actual: 10 }, { rank: 2, points: null, actual: 0 }], 1);
  assert.equal(result.mae, 2); assert.equal(result.pointsN, 1); assert.equal(result.topNHitRate, 1);
  assert.equal(benchmarkMetrics([], 12).mae, null);
});

test('paired and common cohorts keep inactive players as real zero', () => {
  const player = (id, rank) => ({ id, rank, points: 10, position: 'WR' });
  const snapshot = { sources: [
    { provider: 'fantasypros', position: 'WR', status: 'ACCEPTED', players: [player('1', 1), player('2', 2)] },
    { provider: 'sleeper', position: 'WR', status: 'ACCEPTED', players: [player('1', 1), player('2', 2), player('3', 3)] },
    { provider: 'adineu', position: 'WR', status: 'ACCEPTED', players: [player('1', 1), player('2', 2), player('3', 3)] },
    { provider: 'cbs', position: 'WR', status: 'ACCEPTED', players: [player('2', 1), player('3', 2)] },
    { provider: 'failed', position: 'WR', status: 'ABSENT' }
  ] };
  const rows = scoreExpertSnapshot(snapshot, { '1': { pts_ppr: 20 } });
  assert.ok(rows.filter(row => row.cohort === 'fantasypros').every(row => row.n === 2));
  assert.ok(rows.filter(row => row.cohort === 'common').every(row => row.n === 1));
  assert.equal(rows.find(row => row.provider === 'cbs').mae, 10);
  assert.ok(!rows.some(row => row.provider === 'failed'));
});

test('injected capture: exactly six FP pages, fresh PPR projections, absent providers and immutable retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'expert-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createExpertStore({ directory });
  const data = parseEcrData(fixtures.WR, { season: 2026, week: 7, position: 'WR' });
  const raw = Object.fromEntries(data.players.slice(0, 2).map((row, i) => [String(i), { full_name: row.player_name, team: row.player_team_id, position: 'WR' }]));
  let pages = 0, projections = 0;
  const fetchImpl = async (url, options) => {
    if (url.includes('/players/nfl')) return { ok: true, json: async () => raw };
    if (url.includes('/projections/')) { projections++; return { ok: true, json: async () => ({ 0: { pts_ppr: 15 }, 1: { pts_ppr: 12 } }) }; }
    if (url.includes('fantasypros.com')) {
      pages++; assert.match(options.headers['User-Agent'], /Mozilla/);
      return { ok: true, text: async () => url.includes('ppr-wr') ? fixtures.WR : 'format changed' };
    }
    throw Error(`Unexpected URL ${url}`);
  };
  const result = await captureExperts({ season: 2026, week: 7, fetchImpl, now: () => new Date(capturedAt), store, firecrawlKey: '' });
  assert.equal(pages, 6); assert.equal(projections, 1); assert.equal(result.published, true);
  assert.equal(result.coverage.absent, 11);
  const [bundle] = await store.list(2026);
  assert.equal(bundle.sources.find(source => source.provider === 'fantasypros' && source.status === 'ACCEPTED').players.length, 2);
  assert.equal((await captureExperts({ season: 2026, week: 7, fetchImpl: () => { throw Error('must not fetch'); }, store })).published, false);
  const report = await scoreExperts({ season: 2026, week: 7, store, fetchImpl: async () => ({ ok: true, json: async () => ({ 0: { pts_ppr: 20 } }) }) });
  assert.equal(report.status, 'SCORED'); assert.ok(report.weekly.every(row => row.n === 2));
  assert.match(formatExpertBenchmark(report).join('\n'), /n=2/);
  await assert.rejects(scoreExperts({ season: 2026, week: 7, store, fetchImpl: async () => { throw Error('stats failed'); } }));
});

test('private local store first writer wins under concurrent calls; public directory rejected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'expert-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createExpertStore({ directory });
  const writes = await Promise.all([store.save({ season: 2026, week: 7, marker: 'a' }), store.save({ season: 2026, week: 7, marker: 'b' })]);
  assert.equal(writes.filter(row => row.published).length, 1);
  assert.equal((await store.list(2026)).length, 1);
  assert.throws(() => createExpertStore({ directory: 'public/data/experts' }), /PRIVATE/);
});

test('capture job uses existing bearer guard without a socket', async () => {
  let calls = 0;
  async function request(token, configured = 'secret') {
    const server = createAppServer({ modelJobToken: configured, runExpertsJob: async () => { calls++; return { published: true }; } });
    const req = new EventEmitter();
    Object.assign(req, { url: '/api/model/experts/capture', method: 'POST', headers: { authorization: token } });
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await server.listeners('request')[0](req, res);
    return res;
  }
  assert.equal((await request('Bearer secret', '')).status, 503);
  assert.equal((await request('Bearer wrong')).status, 401);
  assert.equal(calls, 0);
  assert.equal((await request('Bearer secret')).body.published, true);
  assert.equal(calls, 1);
});

test('Supabase snapshots encrypt payloads, ignore duplicates and detect tampering', async () => {
  let saved;
  const supabase = { from(table) {
    assert.equal(table, 'model_snapshots');
    return {
      upsert(row, options) {
        assert.deepEqual(options, { onConflict: 'season,week,kind', ignoreDuplicates: true });
        const inserted = !saved; saved ??= row;
        return { select: async () => ({ data: inserted ? [saved] : [], error: null }) };
      },
      select() { const query = { eq() { return query; }, then(resolve) { resolve({ data: saved ? [saved] : [], error: null }); } }; return query; }
    };
  } };
  const store = createExpertStore({ supabase, secret: 'stable-private-test-key' });
  const bundle = { season: 2026, week: 7, capturedAt, sources: [{ provider: 'fantasypros', players: [{ id: '123', rank: 1 }] }], coverage: { accepted: 1 } };
  assert.equal((await store.save(bundle)).published, true);
  assert.equal(saved.kind, 'expert-rankings-v1');
  assert.ok(!JSON.stringify(saved.settings).includes('fantasypros'));
  assert.deepEqual(await store.list(2026), [bundle]);
  assert.equal((await store.save({ ...bundle, sources: [] })).published, false);
  assert.deepEqual(await store.list(2026), [bundle]);
  saved.settings.tag = Buffer.alloc(16).toString('base64');
  await assert.rejects(store.list(2026));
});

test('optional providers use Firecrawl HTTP Alexandria contract and validated PPR fields', async () => {
  let bundle, calls = 0;
  const store = { list: async () => [], save: async value => { bundle = value; return { published: true }; } };
  const row = parseEcrData(fixtures.WR, { season: 2026, week: 7, position: 'WR' }).players[0];
  const gameDate = new Date(row.player_game_kickoff_ts * 1000).toISOString();
  const fetchImpl = async (url, options) => {
    if (url.includes('/players/nfl')) return { ok: true, json: async () => ({ 1: { full_name: row.player_name, team: row.player_team_id, position: 'WR' } }) };
    if (url.includes('/projections/')) return { ok: true, json: async () => ({ 1: { pts_ppr: 15 } }) };
    if (url.includes('fantasypros.com')) return { ok: true, text: async () => url.includes('ppr-wr') ? fixtures.WR : 'absent' };
    if (url.includes('games.csv')) return { ok: true, text: async () => `season,week,game_type,home_team,away_team,gameday,gametime\n2026,7,REG,${row.player_team_id},LV,${gameDate.slice(0, 10)},${gameDate.slice(11, 16)}\n` };
    assert.equal(url, 'https://api.firecrawl.dev/v2/scrape');
    assert.equal(options.headers.Authorization, 'Bearer fake-api-key');
    const body = JSON.parse(options.body);
    assert.ok(body.requestId);
    const [{ provider, capability, options: scope }] = body.alexandria;
    calls++;
    return { ok: true, json: async () => ({ success: true, data: { alexandria: [{ provider, capability, data: {
      season: 2026, week: 7, position: scope.position, scoring: 'PPR', observed_at_ms: Date.parse(capturedAt),
      superflex: false, projection_type: 'weekly', source_url: provider === 'draftsharks-com' ? 'https://www.draftsharks.com/weekly-rankings/' : 'https://www.cbssports.com/fantasy/football/',
      players: scope.position === 'WR' ? [{ player_id: 'p1', name: row.player_name, team: row.player_team_id, position: 'WR', projected_points: 17, fantasy_points: 18 }] : []
    } }] } }) };
  };
  await captureExperts({ season: 2026, week: 7, now: () => new Date(capturedAt), fetchImpl, store, firecrawlKey: 'fake-api-key' });
  assert.equal(calls, 6);
  const external = bundle.sources.filter(source => ['draftsharks-com', 'cbssports-com'].includes(source.provider) && source.position === 'WR');
  assert.ok(external.every(source => source.status === 'ACCEPTED'));
  assert.deepEqual(external.map(source => source.players[0]?.points), [17, 18]);
});

test('weekly feedback isolates expert scoring failure and includes report plus Telegram section', async () => {
  const { buildWeeklyFeedback } = await import('../scripts/model-tracking.js');
  const result = await buildWeeklyFeedback({ season: 2026, week: 7, dryRun: true,
    fetchImpl: async url => ({ ok: true, json: async () => url.includes('/transactions/') ? [] : { 1: { pts_ppr: 0 } } }),
    scoreExpertBenchmark: async () => { throw Error('storage or stats unavailable'); } });
  assert.equal(result.report.experts.status, 'SCORING_FAILED');
  assert.match(result.message, /Experts vs Adineu/);
  assert.match(result.message, /SCORING_FAILED \(n=0\)/);
});
