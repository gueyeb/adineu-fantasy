#!/usr/bin/env node
/** Weekly private PPR benchmark; first capture wins. */
import { mkdir, readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { TOP_N, parseEcrData, matchExpertPlayers, scoreExpertSnapshot } from '../public/assets/expert-benchmark.js';
import { getPlayersIndex, getWeeklyProjections, getWeeklyStats, getSchedule } from './league-context.js';
import { PROJECTION_PROVIDERS, buildProjectionComparison } from './projection-comparison.js';
import { resolveOperationalWeek } from '../public/assets/nfl-week.js';

const KIND = 'expert-rankings-v1';
const PATHS = { QB: 'qb', RB: 'ppr-rb', WR: 'ppr-wr', TE: 'ppr-te', K: 'k', DST: 'dst' };
async function json(url, fetchImpl, options = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000), ...options });
  if (!response.ok) throw Error('EXPERT_FETCH_FAILED');
  return response.json();
}

export function createExpertStore({ supabase, directory = process.env.EXPERT_DATA_DIR || '.cache/experts', secret = process.env.EXPERT_BENCHMARK_KEY || process.env.MODEL_JOB_TOKEN } = {}) {
  const root = resolve(directory), publicRoot = fileURLToPath(new URL('../public', import.meta.url));
  if (root === publicRoot || root.startsWith(publicRoot + sep)) throw Error('EXPERT_ARCHIVE_MUST_BE_PRIVATE');
  const check = result => { if (result.error) throw Error('EXPERT_STORAGE_UNAVAILABLE'); return result.data; };
  const key = () => { if (!secret) throw Error('EXPERT_BENCHMARK_KEY ou MODEL_JOB_TOKEN requis'); return createHash('sha256').update(secret).digest(); };
  const pack = bundle => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(bundle)), cipher.final()]);
    return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  };
  const unpack = settings => {
    const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(settings.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(settings.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(settings.encrypted, 'base64')), cipher.final()]).toString());
  };
  return {
    async list(season) {
      if (supabase) return (check(await supabase.from('model_snapshots').select('settings').eq('season', season).eq('kind', KIND)) || []).map(row => unpack(row.settings));
      let files; try { files = await readdir(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return Promise.all(files.filter(name => new RegExp(`^${season}-\\d{1,2}\\.json$`).test(name)).map(async name => JSON.parse(await readFile(resolve(root, name), 'utf8'))));
    },
    async save(bundle) {
      if (supabase) {
        const data = check(await supabase.from('model_snapshots').upsert({ season: bundle.season, week: bundle.week, kind: KIND,
          taken_at: bundle.capturedAt, model_version: KIND, settings: pack(bundle), coverage: bundle.coverage },
        { onConflict: 'season,week,kind', ignoreDuplicates: true }).select('settings'));
        return { published: data.length > 0 };
      }
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = resolve(root, `.tmp-${randomUUID()}`);
      await writeFile(temporary, JSON.stringify(bundle), { flag: 'wx', mode: 0o600 });
      try { await link(temporary, resolve(root, `${bundle.season}-${bundle.week}.json`)); return { published: true }; }
      catch (error) { if (error.code === 'EEXIST') return { published: false }; throw error; }
      finally { await unlink(temporary); }
    }
  };
}

export async function captureExperts({ season, week, fetchImpl = fetch, now = () => new Date(), store, supabase, firecrawlKey = process.env.FIRECRAWL_API_KEY } = {}) {
  store ??= createExpertStore({ supabase });
  if (!season || !week) {
    const state = await json('https://api.sleeper.app/v1/state/nfl', fetchImpl);
    if (state.season_type !== 'regular') return { skipped: 'OUTSIDE_REGULAR_SEASON' };
    season = Number(state.season); week = resolveOperationalWeek(state);
  }
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18) throw Error('INVALID_EXPERT_WEEK');
  if ((await store.list(season)).some(bundle => bundle.week === week)) return { published: false, season, week };
  const index = await getPlayersIndex({ fetchImpl, forceRefresh: true });
  const sources = [], rawSources = [], kickoffById = new Map();
  for (const [position, path] of Object.entries(PATHS)) {
    try {
      const response = await fetchImpl(`https://www.fantasypros.com/nfl/rankings/${path}.php`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error('ECR_HTTP_FAILED');
      const data = parseEcrData(await response.text(), { season, week, position });
      rawSources.push({ provider: 'fantasypros', position, totalExperts: Number(data.total_experts), lastUpdated: data.last_updated,
        rows: data.players.map(row => ({ name: row.player_name, team: row.player_team_id, position: row.player_position_id, rank: row.rank_ecr, points: row.r2p_pts, kickoff: row.player_game_kickoff_ts })) });
    } catch { sources.push({ provider: 'fantasypros', position, status: 'ABSENT', reason: 'SOURCE_FAILED' }); }
  }
  let comparison = null;
  if (firecrawlKey) {
    const external = { version: 1, season, week, scoring: 'PPR', sources: [] };
    for (const position of ['RB', 'WR', 'TE']) for (const [provider, contract] of Object.entries(PROJECTION_PROVIDERS)) {
      try {
        const options = { position, scoring: 'PPR', week, limit: 100, ...(provider === 'draftsharks-com' ? { superflex: false } : { type: 'weekly' }) };
        const response = await json('https://api.firecrawl.dev/v2/scrape', fetchImpl, { method: 'POST', headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ alexandria: [{ provider, capability: contract.capability, options }], requestId: randomUUID() }) });
        const entries = response.data?.alexandria?.filter(entry => entry.provider === provider && entry.capability === contract.capability);
        if (response.success !== true || entries?.length !== 1 || entries[0].error) throw Error('PROVIDER_FAILED');
        external.sources.push({ provider, capability: contract.capability, position, fetchedAt: now().toISOString(), data: entries[0].data });
      } catch { sources.push({ provider, position, status: 'ABSENT', reason: 'SOURCE_FAILED' }); }
    }
    external.capturedAt = now().toISOString();
    const schedule = await getSchedule({ season: String(season), fetchImpl }).catch(() => []);
    comparison = buildProjectionComparison({ capture: external, season, week, asOf: external.capturedAt, players: [...index.values()].map(player => ({ ...player, sleeperId: player.id })), schedule });
    for (const summary of comparison.sources) {
      if (summary.status !== 'ACCEPTED') { sources.push({ provider: summary.provider, position: summary.position, status: 'ABSENT', reason: 'SOURCE_INVALID' }); continue; }
      rawSources.push({ provider: summary.provider, position: summary.position, rows: comparison.rows.filter(row => row.position === summary.position).flatMap(row => row.values.filter(value => value.provider === summary.provider).map(value => ({ name: row.name, team: row.nflTeam, position: row.position, rank: value.rank ?? 1, points: value.points,
        kickoff: Date.parse(schedule.find(game => game.week === week && [game.home_team, game.away_team].includes(row.nflTeam))?.kickoffAt) / 1000 }))) });
    }
  } else for (const provider of Object.keys(PROJECTION_PROVIDERS)) for (const position of ['RB', 'WR', 'TE']) sources.push({ provider, position, status: 'ABSENT', reason: 'NOT_CONFIGURED' });
  const projections = await getWeeklyProjections({ season: String(season), week, fetchImpl, maxAgeMs: 0 });
  // End-of-collection cutoff conservatively excludes games that started during any request.
  const capturedAt = now().toISOString();
  for (const source of rawSources) {
    if (source.provider !== 'fantasypros') source.rows.sort((a, b) => b.points - a.points).forEach((row, i, rows) => { row.rank = 1 + rows.filter(other => other.points > row.points).length; });
    const matched = matchExpertPlayers(source.rows, index, capturedAt);
    for (const row of matched.players) kickoffById.set(row.id, row.kickoff);
    sources.push({ provider: source.provider, position: source.position, totalExperts: source.totalExperts, lastUpdated: source.lastUpdated, status: 'ACCEPTED', ...matched });
  }
  for (const position of Object.keys(TOP_N)) {
    const players = [...kickoffById].filter(([id]) => (index.get(id)?.position === 'DEF' ? 'DST' : index.get(id)?.position) === position && Number.isFinite(projections[id]?.pts_ppr)).map(([id, kickoff]) => ({ id, kickoff, position, points: projections[id].pts_ppr }));
    for (const row of players) row.rank = 1 + players.filter(other => other.points > row.points).length;
    // The existing model uses Sleeper directly at horizon zero (no usage blend).
    for (const provider of ['sleeper', 'adineu']) sources.push({ provider, position, status: 'ACCEPTED', players });
  }
  const coverage = { accepted: sources.filter(source => source.status === 'ACCEPTED').length, absent: sources.filter(source => source.status === 'ABSENT').length };
  const bundle = { season, week, capturedAt, scoring: 'PPR', sources, coverage };
  return { season, week, capturedAt, coverage, ...await store.save(bundle) };
}

export async function scoreExperts({ season, week, fetchImpl = fetch, supabase, store = createExpertStore({ supabase }) }) {
  const bundles = (await store.list(season)).filter(bundle => bundle.week <= week);
  const weeks = [];
  for (const bundle of bundles) {
    const actuals = await getWeeklyStats({ season: String(season), week: bundle.week, fetchImpl });
    if (!actuals || !Object.keys(actuals).length) throw Error('EXPERT_ACTUALS_UNAVAILABLE');
    weeks.push({ week: bundle.week, rows: scoreExpertSnapshot(bundle, actuals) });
  }
  const groups = new Map();
  for (const entry of weeks) for (const row of entry.rows) {
    const key = JSON.stringify([row.position, row.provider, row.cohort]);
    const group = groups.get(key) ?? { position: row.position, provider: row.provider, cohort: row.cohort, topN: row.topN, n: 0, pointsN: 0, weeks: 0, sums: {}, weights: {} };
    group.n += row.n; group.pointsN += row.pointsN; if (row.n) group.weeks++;
    for (const metric of ['mae', 'spearman', 'topNHitRate']) if (row[metric] !== null) {
      const weight = metric === 'mae' ? row.pointsN : row.n;
      group.sums[metric] = (group.sums[metric] || 0) + row[metric] * weight; group.weights[metric] = (group.weights[metric] || 0) + weight;
    }
    groups.set(key, group);
  }
  return { status: weeks.length ? 'SCORED' : 'NO_CAPTURE', week, coverage: bundles.map(bundle => ({ week: bundle.week, ...bundle.coverage, sources: bundle.sources.map(({ players, ...summary }) => summary) })), weekly: weeks.find(entry => entry.week === week)?.rows ?? [],
    cumulative: [...groups.values()].map(({ sums, weights, ...group }) => ({ ...group, ...Object.fromEntries(['mae', 'spearman', 'topNHitRate'].map(metric => [metric, weights[metric] ? sums[metric] / weights[metric] : null])) })),
    cumulativeMethod: 'sample-weighted weekly metrics', decisionChanges: false };
}

/** Compact Telegram section: season-to-date, common cohort, one line per position (full detail stays in the report). */
export function formatExpertBenchmark(report) {
  const lines = ['Experts vs Adineu — PPR, cohorte commune, cumul saison (Adineu = Sleeper à horizon 0)'];
  if (report?.status !== 'SCORED') return [...lines, `Indisponible : ${report?.status || 'NO_CAPTURE'} (n=0).`];
  const label = { fantasypros: 'FP', sleeper: 'Sleeper', 'draftsharks-com': 'DS', 'cbssports-com': 'CBS' };
  const fixed = (value, digits = 2) => value == null ? 'n/d' : value.toFixed(digits);
  const pct = value => value == null ? 'n/d' : `${Math.round(value * 100)} %`;
  for (const position of Object.keys(TOP_N)) {
    const rows = report.cumulative.filter(row => row.position === position && row.cohort === 'common' && label[row.provider] && row.n);
    if (!rows.length) continue;
    const metric = (name, format) => rows.map(row => `${label[row.provider]} ${format(row[name])}`).join(' / ');
    lines.push(`${position} (n=${rows[0].n}, ${rows[0].weeks} sem.) · ρ ${metric('spearman', fixed)} · top-${rows[0].topN} ${metric('topNHitRate', pct)} · MAE ${metric('mae', value => fixed(value, 1))}`);
  }
  if (lines.length === 1) lines.push('Semaine sans capture exploitable (n=0).');
  lines.push('ρ = corrélation de rang (1 = parfait). Aucune décision avant ≥ 4 semaines.');
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // No top-level await: model-tracking imports this module, so awaiting it here would deadlock.
  import('./model-tracking.js')
    .then(async ({ createSupabaseFromEnv }) => captureExperts({ supabase: process.env.SUPABASE_URL ? await createSupabaseFromEnv() : undefined }))
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
