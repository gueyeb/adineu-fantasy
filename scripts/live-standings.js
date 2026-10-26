import { buildLiveStandings, parseNflLiveGames } from "../public/assets/live-standings.js";
import { getPlayersIndex, getWeeklyProjections } from "./league-context.js";
import { SLEEPER_API, SLEEPER_LEAGUE_ID } from "../public/assets/sleeper-client.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";

const caches = new WeakMap();
function cacheFor(fetchImpl) {
  if (!caches.has(fetchImpl)) caches.set(fetchImpl, new Map());
  return caches.get(fetchImpl);
}
function cached(key, ttl, fetchImpl, load) {
  const cache = cacheFor(fetchImpl);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const entry = { at: Date.now(), promise: Promise.resolve().then(load) };
  cache.set(key, entry);
  entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  return entry.promise;
}
async function json(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Live source HTTP ${response.status}`);
  return response.json();
}

/** Read-only service. Short shared cache for live inputs, five-minute history cache for corrections. */
export function getLiveStandings({ leagueId = SLEEPER_LEAGUE_ID, fetchImpl = fetch } = {}) {
  return cached(`live:${leagueId}`, 15_000, fetchImpl, async () => {
    const [league, state] = await Promise.all([json(`${SLEEPER_API}/league/${leagueId}`, fetchImpl), json(`${SLEEPER_API}/state/nfl`, fetchImpl)]);
    const week = resolveOperationalWeek(state);
    const season = String(league.season);
    const lastWeek = Number(league.settings?.playoff_week_start ?? 15) - 1;
    if (!Number.isInteger(week) || week < 1 || week > 18 || !/^\d{4}$/.test(season) || state.season_type !== "regular" || week > lastWeek || String(state.season) !== season) return { ready: false, reason: "OUTSIDE_REGULAR_SEASON", week, season, asOf: new Date().toISOString(), matchups: [], live: [], projected: [] };
    const start = Number(league.settings?.start_week ?? 1);
    if (!Number.isInteger(start) || start < 1 || start > week) return { ready: false, reason: "INVALID_LEAGUE_PERIOD", week, season, asOf: new Date().toISOString(), matchups: [], live: [], projected: [] };
    const nflUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`;
    const [rosters, users, currentRows, history, players, projections, nflBody] = await Promise.all([
      json(`${SLEEPER_API}/league/${leagueId}/rosters`, fetchImpl),
      json(`${SLEEPER_API}/league/${leagueId}/users`, fetchImpl),
      json(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`, fetchImpl),
      Promise.all(Array.from({ length: Math.max(0, week - start) }, (_, i) => start + i).map(w => cached(`history:${leagueId}:${season}:${w}`, 5 * 60_000, fetchImpl,
        async () => ({ week: w, rows: await json(`${SLEEPER_API}/league/${leagueId}/matchups/${w}`, fetchImpl) })).catch(() => ({ week: w, rows: null })))),
      getPlayersIndex({ fetchImpl }).catch(() => new Map()),
      getWeeklyProjections({ week, season, fetchImpl }).catch(() => ({})),
      json(nflUrl, fetchImpl).catch(() => null)
    ]);
    const asOf = new Date().toISOString();
    const nfl = parseNflLiveGames(nflBody, { season, week, fetchedAt: asOf });
    const report = buildLiveStandings({ league, state: { ...state, week }, rosters, users, currentRows, history, players, projections, nfl, asOf });
    return { ...report, refreshSeconds: 30, sources: { scores: `${SLEEPER_API}/league/${leagueId}/matchups/${week}`, nfl: nflUrl, projections: "Sleeper pregame projections, rescored at league settings" } };
  });
}
