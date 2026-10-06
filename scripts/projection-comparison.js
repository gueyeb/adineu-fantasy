import { readFile } from 'node:fs/promises';

export const PROJECTION_PROVIDERS = {
  'draftsharks-com': { capability: 'fantasy-sports-rankings/weekly_rankings', field: 'projected_points', host: 'www.draftsharks.com' },
  'cbssports-com': { capability: 'fantasy-sports-rankings/projections', field: 'fantasy_points', host: 'www.cbssports.com' }
};
const teamCode = value => ({ JAC: 'JAX', LVR: 'LV', WSH: 'WAS' }[value] ?? value);
const identity = player => JSON.stringify([String(player.name ?? '').normalize('NFKC').toLowerCase().trim(), teamCode(player.nflTeam ?? player.team), player.position]);
const time = value => typeof value === 'number' ? value : Date.parse(value);
const round = value => Math.round(value * 100) / 100;

/** File only: HTTP consumers never call Firecrawl or accept a client-supplied path. */
export async function loadProjectionCapture(path = process.env.PROJECTION_COMPARISON_FILE) {
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.length > 5_000_000) throw Error('Capture too large');
    return JSON.parse(bytes.toString('utf8'));
  } catch { return { loadError: 'CAPTURE_UNREADABLE' }; }
}

/** Descriptive, native PPR values only. No action, bid, model projection or confidence changes. */
export function buildProjectionComparison({ capture, season, week, asOf, players = [], schedule = [], maxAgeHours = 24 }) {
  const report = { status: 'NOT_CONFIGURED', changesDecisionModel: false, scoringCompatibility: 'PPR_LABEL_ONLY_UNVERIFIED_RULES',
    season, week, capturedAt: null, rows: [], sources: [], issues: [] };
  if (!capture) return report;
  report.status = 'HELD';
  const now = time(asOf);
  const fresh = value => Number.isFinite(time(value)) && time(value) <= now && now - time(value) <= maxAgeHours * 3600000;
  if (capture.loadError) { report.issues.push(capture.loadError); return report; }
  if (capture.version !== 1 || !Number.isFinite(now) || !fresh(capture.capturedAt) || String(capture.season) !== String(season) || capture.week !== week || capture.scoring !== 'PPR' || !Array.isArray(capture.sources) || capture.sources.length > 6 || capture.sources.some(source => !source || typeof source !== 'object' || Array.isArray(source))) {
    report.issues.push('CAPTURE_SCOPE_OR_TIME_INVALID'); return report;
  }
  report.capturedAt = capture.capturedAt;
  const identities = new Map();
  for (const player of players) {
    const key = identity(player);
    const matches = identities.get(key) ?? new Map();
    if (player.sleeperId) matches.set(String(player.sleeperId), player);
    identities.set(key, matches);
  }
  const rows = new Map();
  const sourceCounts = new Map();
  for (const source of capture.sources) {
    const key = `${source.provider}:${source.position}`;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  for (const source of capture.sources) {
    const contract = PROJECTION_PROVIDERS[source.provider];
    const data = source.data;
    const summary = { provider: source.provider, position: source.position, status: 'HELD', issues: [], matched: 0, excluded: 0 };
    report.sources.push(summary);
    const hold = code => summary.issues.push(code);
    if (!contract || source.capability !== contract.capability || sourceCounts.get(`${source.provider}:${source.position}`) !== 1) hold('UNKNOWN_OR_DUPLICATE_SOURCE');
    if (!['RB', 'WR', 'TE'].includes(source.position) || !data || source.error || !Array.isArray(data?.players)) hold('SOURCE_RESPONSE_INVALID');
    if (!fresh(source.fetchedAt) || !fresh(data?.observed_at_ms) || (data?.last_updated_at != null && !fresh(data.last_updated_at))) hold('SOURCE_TIME_INVALID');
    if (String(data?.season) !== String(season) || data?.week !== week || data?.scoring !== 'PPR' || data?.position !== source.position || (source.provider === 'cbssports-com' && data?.projection_type !== 'weekly') || (source.provider === 'draftsharks-com' && data?.superflex !== false)) hold('SOURCE_SCOPE_MISMATCH');
    try { if (new URL(data?.source_url).protocol !== 'https:' || new URL(data.source_url).hostname !== contract?.host) hold('SOURCE_URL_INVALID'); } catch { hold('SOURCE_URL_INVALID'); }
    if (summary.issues.length) continue;
    Object.assign(summary, { status: 'ACCEPTED', fetchedAt: source.fetchedAt, observedAt: new Date(data.observed_at_ms).toISOString(),
      providerUpdatedAt: data.last_updated_at ?? null, sourceUrl: data.source_url, field: contract.field,
      returned: data.players.length, total: Number.isInteger(data.total_count) ? data.total_count : null,
      coverage: data.total_count > data.players.length ? 'PARTIAL' : 'RETURNED_TABLE_ONLY' });
    const sourcePlayers = data.players.filter(player => player && typeof player === 'object' && !Array.isArray(player));
    summary.excluded += data.players.length - sourcePlayers.length;
    if (summary.excluded) summary.issues.push('PLAYER_ROW_INVALID');
    const counts = new Map();
    const idCounts = new Map();
    for (const player of sourcePlayers) {
      counts.set(identity(player), (counts.get(identity(player)) ?? 0) + 1);
      idCounts.set(String(player.player_id), (idCounts.get(String(player.player_id)) ?? 0) + 1);
    }
    for (const player of sourcePlayers) {
      const matches = identities.get(identity(player));
      const points = player[contract.field];
      const mapped = matches?.size === 1 ? [...matches.values()][0] : null;
      const game = schedule.find(game => game.week === week && [game.away_team, game.home_team].includes(teamCode(player.team)));
      const opponent = game && (game.home_team === teamCode(player.team) ? game.away_team : game.home_team);
      const claimedOpponent = player.opponent_id ?? (typeof player.opponent === 'string' ? player.opponent.replace(/^(vs\.?|at)\s+/i, '').trim() : null);
      const reason = !mapped || counts.get(identity(player)) !== 1 || player.player_id == null || idCounts.get(String(player.player_id)) !== 1 ? 'IDENTITY_UNVERIFIED'
        : !Number.isFinite(points) ? 'POINTS_MISSING'
          : !game || !Number.isFinite(time(game.kickoffAt)) || time(game.kickoffAt) <= now ? 'TARGET_GAME_UNVERIFIED_OR_STARTED'
            : claimedOpponent && teamCode(claimedOpponent) !== opponent ? 'OPPONENT_CONFLICT' : null;
      if (reason) { summary.excluded++; if (!summary.issues.includes(reason)) summary.issues.push(reason); continue; }
      const id = String(mapped.sleeperId);
      const row = rows.get(id) ?? { playerId: id, name: mapped.name, position: mapped.position, nflTeam: mapped.nflTeam ?? mapped.team, values: [], spread: null };
      row.values.push({ provider: source.provider, providerPlayerId: String(player.player_id), identityMethod: 'UNIQUE_EXACT_NAME_TEAM_POSITION',
        points, field: contract.field, unit: 'NATIVE_PPR_POINTS', rank: Number.isFinite(player.rank) ? player.rank : null,
        calendarCheck: claimedOpponent ? 'OPPONENT_MATCHED' : 'TEAM_GAME_MATCHED_OPPONENT_UNSPECIFIED', sourceUrl: data.source_url,
        fetchedAt: summary.fetchedAt, observedAt: summary.observedAt, providerUpdatedAt: summary.providerUpdatedAt });
      rows.set(id, row); summary.matched++;
    }
  }
  report.rows = [...rows.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)).map(row => ({ ...row,
    spread: row.values.length > 1 ? round(Math.max(...row.values.map(value => value.points)) - Math.min(...row.values.map(value => value.points))) : null }));
  report.status = report.rows.length ? 'CONTEXT_ONLY' : 'HELD';
  return report;
}

export function formatProjectionComparison(report, playerIds = []) {
  if (!report || report.status === 'NOT_CONFIGURED') return [];
  if (report.status !== 'CONTEXT_ONLY') return ['Comparaison externe indisponible : semaine, fraîcheur, calendrier ou identités non validés.'];
  const ids = new Set(playerIds.map(String));
  const rows = report.rows.filter(row => ids.has(row.playerId)).slice(0, 3);
  const sources = report.sources.filter(source => source.status === 'ACCEPTED').map(source => `${source.provider} ${source.returned}/${source.total ?? '?'}`).join(' ; ');
  return [`📊 PROJECTIONS EXTERNES — S${report.week} · ${sources}`, ...rows.map(row => `• ${row.name} : ${row.values.map(value => `${value.provider} ${value.points}`).join(' ; ')} pts PPR natifs${row.spread === null ? '' : ` · écart ${row.spread} pts`}`),
    'Comparaison indicative : barème complet non certifié, écart non calibré ; recommandations Adineu inchangées.'];
}
