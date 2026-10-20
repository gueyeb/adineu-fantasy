/** Pure private-benchmark calculations. Never render third-party rankings on public pages. */
export const TOP_N = { QB: 12, RB: 24, WR: 36, TE: 12, K: 12, DST: 12 };
export const normalizeName = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(?:jr|sr|iii|ii|iv)$/, '');
export const teamCode = value => ({ JAC: 'JAX', LVR: 'LV', WSH: 'WAS', LA: 'LAR' }[value] ?? value);
const positionCode = value => value === 'DEF' ? 'DST' : value;
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));

export function parseEcrData(html, { season, week, position } = {}) {
  const start = html.match(/\bvar\s+ecrData\s*=\s*/);
  if (!start) throw Error('ECR_DATA_MISSING');
  // JSON scanner: braces inside quoted names must not terminate the object.
  const offset = start.index + start[0].length;
  let depth = 0, quoted = false, escaped = false, end = offset;
  for (; end < html.length; end++) {
    const char = html[end];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) break;
  }
  const data = JSON.parse(html.slice(offset, end + 1));
  if (data.sport !== 'NFL' || !String(data.type).toLowerCase().includes('weekly') || Number(data.year) !== season || Number(data.week) !== week || data.position_id !== position || data.scoring !== (['RB', 'WR', 'TE'].includes(position) ? 'PPR' : 'STD') || !Array.isArray(data.players) || !data.players.length || (!finite(data.total_experts) || Number(data.total_experts) <= 0) || data.players.some(row => !row || row.player_position_id !== position)) throw Error('ECR_SCOPE_INVALID');
  return data;
}

export function matchExpertPlayers(rows, index, capturedAt) {
  const identities = new Map();
  const key = (name, team, position) => JSON.stringify([position === 'DST' ? '' : normalizeName(name), teamCode(team), position]);
  for (const [id, player] of index) {
    const position = positionCode(player.position);
    const identity = key(player.name, player.nflTeam || (position === 'DST' ? id : null), position);
    const candidates = identities.get(identity) ?? [];
    candidates.push(String(id)); identities.set(identity, candidates);
  }
  const players = [], excluded = { identity: 0, kickoff: 0, invalid: 0 };
  const used = new Set();
  for (const row of rows) {
    const candidates = identities.get(key(row.name, row.team, row.position));
    if (candidates?.length !== 1 || used.has(candidates[0])) { excluded.identity++; continue; }
    if (!finite(row.kickoff) || row.kickoff * 1000 <= Date.parse(capturedAt)) { excluded.kickoff++; continue; }
    if (!finite(row.rank) || Number(row.rank) <= 0) { excluded.invalid++; continue; }
    used.add(candidates[0]);
    players.push({ id: candidates[0], position: row.position, rank: Number(row.rank), points: finite(row.points) ? Number(row.points) : null, kickoff: Number(row.kickoff) });
  }
  return { players, excluded };
}

function ranks(values) {
  return values.map(value => 1 + values.filter(other => other < value).length + (values.filter(other => other === value).length - 1) / 2);
}
export function spearman(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const a = ranks(left), b = ranks(right), mean = (left.length + 1) / 2;
  const numerator = a.reduce((sum, value, i) => sum + (value - mean) * (b[i] - mean), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - mean) ** 2, 0) * b.reduce((sum, value) => sum + (value - mean) ** 2, 0));
  return denominator ? numerator / denominator : null;
}
export function benchmarkMetrics(rows, topN) {
  const n = rows.length;
  const errors = rows.filter(row => Number.isFinite(row.points));
  const actualRanks = ranks(rows.map(row => -row.actual));
  const predictedRanks = ranks(rows.map(row => row.rank));
  const top = predictedRanks.map((rank, i) => rank <= Math.min(topN, n) ? i : -1).filter(i => i >= 0);
  return { n, spearman: spearman(rows.map(row => row.rank), rows.map(row => -row.actual)),
    mae: errors.length ? errors.reduce((sum, row) => sum + Math.abs(row.points - row.actual), 0) / errors.length : null, pointsN: errors.length,
    topN, topNHitRate: top.length ? top.filter(i => actualRanks[i] <= Math.min(topN, n)).length / top.length : null };
}

export function scoreExpertSnapshot(snapshot, actuals) {
  const results = [];
  for (const [position, topN] of Object.entries(TOP_N)) {
    const sources = snapshot.sources.filter(source => source.status === 'ACCEPTED' && source.position === position);
    const sleeper = sources.find(source => source.provider === 'sleeper');
    if (!sleeper?.players.length) continue;
    const maps = new Map(sources.map(source => [source.provider, new Map(source.players.map(row => [row.id, row]))]));
    const score = (provider, ids, cohort) => {
      const rows = ids.map(id => ({ ...maps.get(provider).get(id), actual: actuals[id]?.pts_ppr ?? 0 }));
      results.push({ position, provider, cohort, ...benchmarkMetrics(rows, topN) });
    };
    for (const source of sources.filter(source => !['sleeper', 'adineu'].includes(source.provider))) {
      const ids = source.players.map(row => row.id).filter(id => maps.get('sleeper').has(id));
      for (const provider of [source.provider, 'sleeper', 'adineu'].filter(provider => maps.has(provider))) score(provider, ids.filter(id => maps.get(provider).has(id)), source.provider);
    }
    const ids = sleeper.players.map(row => row.id).filter(id => sources.every(source => maps.get(source.provider).has(id)));
    for (const source of sources) score(source.provider, ids, 'common');
  }
  return results;
}
