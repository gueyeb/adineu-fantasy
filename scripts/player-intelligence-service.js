import { createPlayerIntelligenceStore, normalizePlayerObservation, mergePlayerObservations } from './player-intelligence.js';
import { resolveOperationalWeek } from '../public/assets/nfl-week.js';
import { findRosterByTeam } from '../public/assets/roster-view.js';
import { NFL_NEWS_URL, parseOfficialPlayerNews, matchPlayerNews, newsId, claimNewsDelivery } from './player-news.js';
import { listReviewableNews, reviewPlayerNews } from './player-intelligence-review.js';

/** No paid provider, credentials or automatic claims; sources enter through a validated contract. */
export function createPlayerIntelligenceService({ store = createPlayerIntelligenceStore(), getIndex, fetchImpl = fetch,
  leagueId = process.env.SLEEPER_LEAGUE_ID || '1392715510830878721', now = Date.now,
  extraHosts = (process.env.PLAYER_INTELLIGENCE_SOURCE_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) } = {}) {
  const get = async path => {
    const result = await fetchImpl(`https://api.sleeper.app/v1${path}`, { signal: AbortSignal.timeout(20000) });
    if (!result.ok) throw Error(`Sleeper source unavailable (${result.status})`);
    return result.json();
  };
  const scope = async () => {
    const state = await get('/state/nfl');
    const targetWeek = resolveOperationalWeek(state), season = Number(state.season);
    if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 18 || !Number.isInteger(season) || season < 2026) throw Error('NFL scope unavailable');
    return { leagueId: String(leagueId), season, targetWeek };
  };
  const reviewContext = async team => {
    const current = await scope();
    const [rosters, users, index] = await Promise.all([get(`/league/${leagueId}/rosters`), get(`/league/${leagueId}/users`), getIndex({ applyIntelligence: false })]);
    const { roster } = findRosterByTeam(rosters, users, team);
    const selected = new Set((roster.players || []).map(String));
    const groups = new Set([...selected].map(id => index.get(id)).filter(Boolean).map(p => `${p.nflTeam}:${p.position}`));
    for (const [id, player] of index) if (player.active !== false && groups.has(`${player.nflTeam}:${player.position}`)) selected.add(id);
    return { scope: current, selected, index, now: now() };
  };
  return {
    async reviewList({ team = 't0z' } = {}) {
      const context = await reviewContext(team);
      return { scope: context.scope, observations: listReviewableNews(await store.load(), context) };
    },
    async reviewNews(input, { team = 't0z' } = {}) {
      return store.update(async state => reviewPlayerNews(state, input, await reviewContext(team)));
    },
    async collectNews({ team = 't0z' } = {}) {
      return store.update(async state => {
        const at = now(), current = await scope();
        const [rosters, users, index] = await Promise.all([get(`/league/${leagueId}/rosters`), get(`/league/${leagueId}/users`), getIndex({ applyIntelligence: false })]);
        const { roster } = findRosterByTeam(rosters, users, team);
        const selected = new Set((roster.players || []).map(String));
        const groups = new Set([...selected].map(id => index.get(id)).filter(Boolean).map(p => `${p.nflTeam}:${p.position}`));
        for (const [id, player] of index) if (player.active !== false && groups.has(`${player.nflTeam}:${player.position}`)) selected.add(id);
        const scopeKey = `${leagueId}:${current.season}:${current.targetWeek}:${roster.roster_id}`;
        const queues = state.playerNewsQueues ??= {};
        // Retain current scope and a bounded number of previous team/week queues.
        for (const key of Object.keys(queues).filter(key => key !== scopeKey).slice(0, Math.max(0, Object.keys(queues).length - 11))) delete queues[key];
        const queue = queues[scopeKey] ??= { pending: [], lastFetchAt: null };
        queue.pending = queue.pending.filter(row => selected.has(row.playerId));
        if (queue.lastFetchAt && at - Date.parse(queue.lastFetchAt) < 30 * 60000) return { status: 'NEWS_SOURCE_COOLDOWN', changed: false, shouldRecompute: false, ...claimNewsDelivery(state, { scopeKey, now: at }) };
        const response = await fetchImpl(NFL_NEWS_URL, { signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw Error(`NFL news unavailable (${response.status})`);
        // Bounded stream: do not buffer an unexpectedly large upstream response.
        let html = '';
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          html += decoder.decode(chunk, { stream: true });
          if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw Error('NFL news response too large');
        }
        html += decoder.decode();
        const articles = parseOfficialPlayerNews(html, { now: at });
        const rows = matchPlayerNews(articles, index, selected).map(article => normalizePlayerObservation({ ...current,
          playerId: article.playerId, kind: 'NEWS', certainty: 'REPORTED', source: article.source, publishedAt: article.publishedAt,
          expiresAt: new Date(Date.parse(article.publishedAt) + 72 * 3600000).toISOString(), value: { headline: article.headline }
        }, { ...current, index, now: at }));
        const baseline = !queue.lastFetchAt, result = mergePlayerObservations(state, rows, at);
        if (!baseline) for (const row of rows) {
          if (!result.changes.some(change => change.playerId === row.playerId && change.source === row.source)) continue;
          const id = newsId([scopeKey, row.playerId, row.source, row.value.headline]);
          if (!queue.pending.some(item => item.id === id)) queue.pending.push({ id, playerId: row.playerId, playerName: row.playerName, headline: row.value.headline, source: row.source, publishedAt: row.publishedAt, expiresAt: row.expiresAt });
        }
        queue.pending = queue.pending.slice(-100);
        queue.lastFetchAt = new Date(at).toISOString();
        return { ...result, scope: current, baseline, status: 'NEWS_COLLECTED', shouldRecompute: false,
          articlesRead: articles.length, monitoredPlayers: selected.size, ...claimNewsDelivery(state, { scopeKey, now: at }) };
      });
    },
    async acknowledgeNews({ deliveryId } = {}) {
      if (typeof deliveryId !== 'string' || !/^[a-f0-9]{64}$/.test(deliveryId)) throw Object.assign(Error('Invalid deliveryId'), { status: 400 });
      return store.update(async state => {
        const queue = Object.values(state.playerNewsQueues || {}).find(item => item.delivery?.id === deliveryId);
        if (!queue) throw Object.assign(Error('Unknown news delivery'), { status: 409 });
        const delivered = new Set(queue.delivery.rowIds);
        queue.pending = queue.pending.filter(row => !delivered.has(row.id));
        queue.delivery = null;
        return { acknowledged: true, shouldRecompute: false };
      });
    },
    async ingest(input) {
      if (!Array.isArray(input?.observations) || !input.observations.length || input.observations.length > 100) throw Object.assign(Error('Expected 1–100 observations'), { status: 400 });
      const current = await scope();
      const index = await getIndex({ applyIntelligence: false });
      const rows = input.observations.map(row => normalizePlayerObservation(row, { ...current, index, now: now(), extraHosts }));
      const result = await store.ingest(rows);
      return { ...result, scope: current, shouldRecompute: result.changes.some(row => row.certainty === 'CONFIRMED') };
    },
    async collect({ team = 't0z', watchIds = [] } = {}) {
      if (!Array.isArray(watchIds) || watchIds.length > 100 || watchIds.some(id => typeof id !== 'string' || id.length > 80)) throw Object.assign(Error('Invalid watchIds'), { status: 400 });
      return store.update(async state => {
        const at = now();
        if (state.lastSleeperFetchAt && at - Date.parse(state.lastSleeperFetchAt) < 86400000) return { changed: false, shouldRecompute: false, status: 'DAILY_SOURCE_COOLDOWN', nextFetchAt: new Date(Date.parse(state.lastSleeperFetchAt) + 86400000).toISOString() };
        const current = await scope();
        const [rosters, users] = await Promise.all([get(`/league/${leagueId}/rosters`), get(`/league/${leagueId}/users`)]);
        const { roster } = findRosterByTeam(rosters, users, team);
        const index = await getIndex({ forceRefresh: true, applyIntelligence: false });
        const selected = new Set([...(roster.players || []).map(String), ...watchIds]);
        const groups = new Set([...selected].map(id => index.get(id)).filter(Boolean).map(p => `${p.nflTeam}:${p.position}`));
        for (const [id, p] of index) if (groups.has(`${p.nflTeam}:${p.position}`) && p.active !== false) selected.add(id);
        const rows = [...selected].filter(id => index.has(id) && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(index.get(id).position)).map(playerId => {
          const player = index.get(playerId);
          return normalizePlayerObservation({ ...current, playerId, kind: 'STATUS', certainty: 'CONFIRMED', source: 'https://api.sleeper.app/v1/players/nfl',
            publishedAt: new Date(at).toISOString(), expiresAt: new Date(at + 25 * 3600000).toISOString(), value: {
              injuryStatus: player.injuryStatus ?? null, rosterStatus: player.rosterStatus ?? null,
              practiceParticipation: player.practiceParticipation ?? null, injuryBodyPart: player.injuryBodyPart ?? null
            } }, { ...current, index, now: at, internalSleeper: true });
        });
        const baseline = !state.lastSleeperFetchAt;
        const result = mergePlayerObservations(state, rows, at);
        state.lastSleeperFetchAt = new Date(at).toISOString();
        return { ...result, baseline, scope: current, monitoredPlayers: rows.length, status: 'COLLECTED', shouldRecompute: result.changed };
      });
    },
    async status() {
      const current = await scope(), state = await store.load();
      return { scope: current, updatedAt: state.updatedAt ?? null, lastSleeperFetchAt: state.lastSleeperFetchAt,
        observations: state.observations.filter(row => row.leagueId === current.leagueId && row.season === current.season && row.targetWeek === current.targetWeek && Date.parse(row.expiresAt) > now()) };
    }
  };
}
