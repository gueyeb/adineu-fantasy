import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const OFFICIAL_HOSTS = ['nfl.com', 'azcardinals.com', 'atlantafalcons.com', 'baltimoreravens.com', 'buffalobills.com', 'panthers.com', 'chicagobears.com', 'bengals.com', 'clevelandbrowns.com', 'dallascowboys.com', 'denverbroncos.com', 'detroitlions.com', 'packers.com', 'houstontexans.com', 'colts.com', 'jaguars.com', 'chiefs.com', 'raiders.com', 'chargers.com', 'therams.com', 'miamidolphins.com', 'vikings.com', 'patriots.com', 'neworleanssaints.com', 'giants.com', 'newyorkjets.com', 'philadelphiaeagles.com', 'steelers.com', '49ers.com', 'seahawks.com', 'buccaneers.com', 'tennesseetitans.com', 'commanders.com'];
const STATUSES = [null, 'Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus', 'NA'];
const KINDS = ['STATUS', 'INJURY', 'RETURN', 'ROLE', 'NEWS'];
const fail = message => { throw Object.assign(Error(message), { status: 400 }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = row => JSON.stringify([row.leagueId, row.season, row.targetWeek, row.playerId, row.kind, row.source]);
const fingerprint = row => hash([row.value, row.certainty]);
const time = value => Date.parse(value);
const matches = (row, scope) => row.leagueId === String(scope.leagueId) && row.season === Number(scope.season) && row.targetWeek === scope.targetWeek;
const live = (row, scope) => matches(row, scope) && time(row.publishedAt) <= scope.now && time(row.expiresAt) > scope.now
  && (!row.reviewedAt || time(row.reviewedAt) <= scope.now) && (!row.revokedAt || time(row.revokedAt) > scope.now);

/** Only a trusted collector may assert CONFIRMED. A source URL alone is never verification. */
export function normalizePlayerObservation(input, { index, leagueId, season, targetWeek, now = Date.now(), extraHosts = [], internalSleeper = false } = {}) {
  if (!input || !matches(input, { leagueId, season, targetWeek })) fail('Observation scope mismatch');
  const player = index.get(String(input.playerId));
  if (!player || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(player.position)) fail('Unknown or unsupported player identity');
  if (!KINDS.includes(input.kind) || !['CONFIRMED', 'REPORTED'].includes(input.certainty)) fail('Invalid kind or certainty');
  let url;
  try { url = new URL(input.source); } catch { fail('Invalid source URL'); }
  const hosts = [...OFFICIAL_HOSTS, ...extraHosts];
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !(internalSleeper && url.hostname === 'api.sleeper.app' || hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)))) fail('Source host not allowed');
  const published = time(input.publishedAt), expires = time(input.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expires) || published > now || published < now - 7 * 86400000 || expires <= now || expires <= published || expires > now + 7 * 86400000) fail('Invalid observation dates');
  const raw = input.value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid value');
  const value = {};
  if (input.kind === 'STATUS') {
    if (Object.hasOwn(raw, 'injuryStatus')) {
      if (!STATUSES.includes(raw.injuryStatus)) fail('Invalid injury status');
      value.injuryStatus = raw.injuryStatus;
    }
    for (const key of ['rosterStatus', 'practiceParticipation', 'injuryBodyPart']) {
      if (Object.hasOwn(raw, key)) {
        if (raw[key] !== null && (typeof raw[key] !== 'string' || raw[key].length > 100)) fail('Invalid status field');
        value[key] = raw[key];
      }
    }
  } else if (input.kind === 'INJURY') {
    if (Object.hasOwn(raw, 'outThroughWeek')) {
      if (!Number.isInteger(raw.outThroughWeek) || raw.outThroughWeek < targetWeek || raw.outThroughWeek > 18) fail('Invalid absence window');
      value.outThroughWeek = raw.outThroughWeek;
    }
    if (raw.seasonEndingConfirmed === true) value.seasonEndingConfirmed = true;
  } else if (input.kind === 'RETURN') {
    if (raw.clearedForWeek !== targetWeek) fail('Return clearance must concern the current week');
    value.clearedForWeek = raw.clearedForWeek;
  } else if (input.kind === 'ROLE') {
    if (!['STARTER', 'STARTING_QB', 'BACKUP', 'COMMITTEE'].includes(raw.announcedRole)) fail('Invalid role');
    if (raw.announcedRole === 'STARTING_QB' && player.position !== 'QB') fail('Starting QB requires a QB identity');
    value.announcedRole = raw.announcedRole;
    if (Object.hasOwn(raw, 'roleWeeks')) {
      if (!Number.isInteger(raw.roleWeeks) || raw.roleWeeks < 1 || raw.roleWeeks > 18 - targetWeek + 1) fail('Invalid role duration');
      value.roleWeeks = raw.roleWeeks;
    }
  } else {
    if (input.certainty !== 'REPORTED' || typeof raw.headline !== 'string' || raw.headline.length < 1 || raw.headline.length > 500) fail('News must remain reported');
    value.headline = raw.headline;
  }
  if (!Object.keys(value).length || Object.keys(raw).some(key => !Object.hasOwn(value, key))) fail('Unsupported or empty value field');
  return { leagueId: String(leagueId), season: Number(season), targetWeek, playerId: String(input.playerId), kind: input.kind, value,
    certainty: input.certainty, source: url.href, publishedAt: new Date(published).toISOString(), expiresAt: new Date(expires).toISOString(),
    collectedAt: new Date(now).toISOString(), timestampBasis: internalSleeper ? 'COLLECTED_SNAPSHOT' : 'SOURCE_PUBLICATION',
    nflTeam: player.nflTeam, position: player.position, playerName: player.name };
}

export function activePlayerObservations(rows, scope) {
  return rows.filter(row => live(row, scope)).sort((a, b) => Number(a.timestampBasis !== 'COLLECTED_SNAPSHOT') - Number(b.timestampBasis !== 'COLLECTED_SNAPSHOT') || time(a.publishedAt) - time(b.publishedAt) || a.source.localeCompare(b.source));
}

export function applyPlayerIntelligence(index, rows, scope) {
  const result = new Map(index);
  for (const row of activePlayerObservations(rows, scope)) {
    if (row.certainty !== 'CONFIRMED' || !['STATUS', 'INJURY', 'RETURN'].includes(row.kind) || !result.has(row.playerId)) continue;
    const old = result.get(row.playerId);
    if (old.nflTeam !== row.nflTeam || old.position !== row.position) continue;
    const values = row.kind === 'STATUS' ? row.value : row.kind === 'RETURN' ? { injuryStatus: null } : row.value.seasonEndingConfirmed || row.value.outThroughWeek >= scope.targetWeek ? { injuryStatus: 'Out' } : {};
    result.set(row.playerId, { ...old, ...values, intelligence: { source: row.source, publishedAt: row.publishedAt, collectedAt: row.collectedAt,
      expiresAt: row.expiresAt, targetWeek: row.targetWeek, timestampBasis: row.timestampBasis } });
  }
  // A lack of platform alert cannot retract a separately confirmed absence.
  const absences = intelligenceEvidence(rows, scope).eventsById;
  for (const [id, event] of Object.entries(absences)) {
    const player = result.get(id);
    if (!player || player.nflTeam !== event.nflTeam || event.type !== 'INJURY') continue;
    if (event.seasonEndingConfirmed || event.outThroughWeek >= scope.targetWeek) result.set(id, { ...player, injuryStatus: 'Out',
      intelligence: { source: event.source, publishedAt: event.observedAt, expiresAt: event.expiresAt, targetWeek: event.targetWeek, timestampBasis: 'SOURCE_PUBLICATION' } });
  }
  return result;
}

export function intelligenceEvidence(rows, scope) {
  const result = { eventsById: {}, rolesById: {} };
  for (const row of activePlayerObservations(rows, scope)) {
    if (row.certainty !== 'CONFIRMED') continue;
    const base = { leagueId: row.leagueId, season: row.season, targetWeek: row.targetWeek, source: row.source,
      observedAt: row.publishedAt, expiresAt: row.expiresAt, nflTeam: row.nflTeam, positions: [row.position], ...row.value };
    if (row.kind === 'INJURY') result.eventsById[row.playerId] = { ...base, type: 'INJURY' };
    if (row.kind === 'RETURN') result.eventsById[row.playerId] = { ...base, type: 'RETURN' };
    if (row.kind === 'ROLE') result.rolesById[row.playerId] = { ...base, roleConfirmation: ['STARTER', 'STARTING_QB'].includes(row.value.announcedRole) ? 'CONFIRMED' : 'UNCONFIRMED' };
  }
  return result;
}

const queues = new Map();
export function createPlayerIntelligenceStore({ directory = process.env.PLAYER_INTELLIGENCE_DIR } = {}) {
  const root = directory ? resolve(directory) : null;
  const publicRoot = resolve(new URL('../public/', import.meta.url).pathname);
  if (root && (root === publicRoot || root.startsWith(`${publicRoot}${sep}`))) throw Error('Intelligence directory must be private');
  const path = root && join(root, 'state.json');
  const load = async () => {
    if (!path) return { version: 1, observations: [], lastSleeperFetchAt: null };
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.observations)) throw Error('Invalid intelligence store');
      return state;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, observations: [], lastSleeperFetchAt: null }; throw error; }
  };
  const update = work => {
    if (!path) return Promise.reject(Object.assign(Error('PLAYER_INTELLIGENCE_DIR not configured'), { status: 503 }));
    const pending = (queues.get(path) || Promise.resolve()).then(async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      // Cross-process exclusion; a crashed writer requires explicit lock recovery.
      const lock = join(root, 'writer.lock');
      try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code === 'EEXIST') throw Object.assign(Error('Intelligence writer busy'), { status: 409 }); throw error; }
      const scratch = `${path}.${randomUUID()}.tmp`;
      try {
        const state = await load();
        const result = await work(state);
        await writeFile(scratch, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(scratch, path);
        return result;
      } finally { await rm(scratch, { force: true }); await rm(lock, { force: true }); }
    });
    const settled = pending.catch(() => {});
    queues.set(path, settled);
    settled.finally(() => { if (queues.get(path) === settled) queues.delete(path); });
    return pending;
  };
  return { load, update, ingest: rows => update(state => {
    return mergePlayerObservations(state, rows);
  }) };
}

export function mergePlayerObservations(state, rows, now = Date.now()) {
  const changes = [];
  for (const row of rows) {
    const i = state.observations.findIndex(old => identity(old) === identity(row));
    const old = state.observations[i];
    // Replaying an already withdrawn publication must not silently restore it.
    if (old?.revokedAt && time(row.publishedAt) <= time(old.publishedAt)) continue;
    if (old && time(old.publishedAt) > time(row.publishedAt)) continue;
    if (old && time(old.publishedAt) === time(row.publishedAt) && fingerprint(old) !== fingerprint(row)) throw Object.assign(Error('Conflicting observation at identical publication time'), { status: 409 });
    const changed = !old || fingerprint(old) !== fingerprint(row) || time(old.expiresAt) <= now;
    if (old && !changed && time(row.expiresAt) < time(old.expiresAt)) continue;
    if (changed && old) { (state.history ??= []).push(old); state.history = state.history.slice(-10000); }
    if (i < 0) state.observations.push(row); else state.observations[i] = old.reviewedAt && time(old.publishedAt) === time(row.publishedAt)
      ? { ...row, reviewedAt: old.reviewedAt, reviewedBy: old.reviewedBy, originNewsId: old.originNewsId } : row;
    if (changed) changes.push({ playerId: row.playerId, kind: row.kind, certainty: row.certainty, source: row.source });
  }
  state.observations = state.observations.filter(row => time(row.expiresAt) > now - 7 * 86400000).slice(-10000);
  state.updatedAt = new Date(now).toISOString();
  return { changed: changes.length > 0, changes, accepted: rows.length };
}
