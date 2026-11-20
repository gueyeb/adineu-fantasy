import { createPlayerIntelligenceStore, normalizePlayerObservation, mergePlayerObservations } from './player-intelligence.js';
import { resolveOperationalWeek } from '../public/assets/nfl-week.js';
import { findRosterByTeam } from '../public/assets/roster-view.js';

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
  return {
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
