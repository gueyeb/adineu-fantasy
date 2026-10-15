import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSosBundle } from '../scripts/sos-service.js';
import { buildCoachSos, formatCoachSos } from '../scripts/sos-coach.js';
import { frozenPastSos } from '../scripts/sos-history.js';
import { filterSosTeams } from '../public/assets/sos-explorer.js';
import { trackSos } from '../scripts/sos-tracking.js';

const input = () => ({ season: 2026, week: 6, lastCompletedWeek: 5, asOf: '2026-10-15T12:00:00Z',
  schedule: { source: 'fixture', fetchedAt: '2026-10-15T11:00:00Z', complete: true, games: [
    { gameId: 'target', season: 2026, week: 6, away_team: 'ARI', home_team: 'ATL', kickoffAt: '2026-10-18T17:00:00Z', completed: false }] },
  dvp: { source: 'fixture', fetchedAt: '2026-10-15T11:00:00Z', completedWeeks: [1], scoring: 'FULL_PPR', observations: [], byDefense: new Map([
    ['ATL|WR', { valid: true, games: 1, allowedPerGame: 35 }], ['ARI|WR', { valid: true, games: 1, allowedPerGame: 25 }] ]) } });

test('Coach uses exactly Explorer team objects; explanation cannot mutate existing decisions', () => {
  const bundle = buildSosBundle(input());
  const context = { myTeam: { starters: [{ player: { sleeperId: '1', name: 'WR', position: 'WR', nflTeam: 'ARI', rosPpg: 12 } }], bench: [], ir: [] } };
  const waivers = { byPosition: { WR: [{ sleeperId: '2', name: 'waiver', position: 'WR', nflTeam: 'ATL', effectivePpg: 10, waiver: { score: 11 } }] }, coherence: { publishable: true } };
  const before = structuredClone({ context, waivers, bundle });
  const sos = buildCoachSos({ context, waivers, bundle, now: Date.parse(bundle.asOf) });
  assert.equal(sos.snapshotId, bundle.snapshotId);
  assert.strictEqual(sos.players[0].sos, bundle.horizons.FANTASY_ROS.teams.find(t => t.team === 'ARI'));
  assert.equal(sos.players[1].scope, 'WAIVER');
  assert.match(formatCoachSos(sos), /projections et décisions inchangées/);
  const absent = buildCoachSos({ context, waivers, bundle: null });
  assert.equal(absent.players[0].sos, null);
  assert.equal(absent.players[0].reason, 'SOS_UNAVAILABLE');
  const stale = buildCoachSos({ context, waivers, bundle, now: Date.parse(bundle.asOf) + 900000 });
  assert.equal(stale.reason, 'SOS_STALE');
  assert.deepEqual({ context, waivers, bundle }, before);
});

test('Past frozen selects authentic latest pregame archives, never current DvP or late archives', () => {
  const archived = buildSosBundle(input());
  const data = input();
  data.asOf = '2026-10-20T12:00:00Z'; data.week = 7; data.lastCompletedWeek = 6;
  data.schedule.games[0].completed = true;
  data.dvp.byDefense.get('ATL|WR').allowedPerGame = 100;
  const current = buildSosBundle(data);
  const missing = frozenPastSos(current, []);
  assert.equal(missing.teams.find(t => t.team === 'ARI').reason, 'NO_PREGAME_ARCHIVE');
  assert.equal(missing.teams.find(t => t.team === 'ARI').sosScore, null);
  const frozen = frozenPastSos(current, [archived, current]);
  const past = frozen.teams.find(t => t.team === 'ARI');
  assert.equal(past.sosScore, archived.horizons.NFL_ROS.teams.find(t => t.team === 'ARI').sosScore);
  assert.notEqual(past.sosScore, current.horizons.PAST.teams.find(t => t.team === 'ARI').sosScore);
  assert.equal(past.opponents[0].predictionSnapshotId, archived.snapshotId);
});

test('display filters preserve all score and ranking fields', () => {
  const rows = buildSosBundle(input()).horizons.FANTASY_ROS.teams;
  const before = structuredClone(rows);
  assert.equal(filterSosTeams(rows, { team: 'ARI', coverage: 'COMPLETE' }).length, 1);
  assert.equal(filterSosTeams(rows, { team: 'ARI', coverage: 'UNAVAILABLE' }).length, 0);
  assert.deepEqual(rows, before);
});

test('weekly tracking dry-run never writes and normal run evaluates before publication', async () => {
  const bundle = buildSosBundle(input()); const actions = [];
  const service = { getBundle: async () => bundle };
  const store = { list: async () => [{ snapshotId: bundle.snapshotId }], load: async () => bundle,
    saveEvaluation: async () => { actions.push('feedback'); return 'revision'; }, save: async () => { actions.push('publish'); return { published: true }; } };
  await trackSos({ service, store, dryRun: true }); assert.deepEqual(actions, []);
  await trackSos({ service, store }); assert.deepEqual(actions, ['feedback', 'publish']);
});

test('Explorer, Coach and AI HTTP responses share snapshot and keep decision outputs unchanged without SOS', async t => {
  const { createAppServer } = await import('../server.js');
  const data = input();
  data.asOf = new Date(Date.now() - 1000).toISOString();
  data.schedule.fetchedAt = data.dvp.fetchedAt = new Date(Date.now() - 2000).toISOString();
  data.schedule.games[0].kickoffAt = new Date(Date.now() + 86400000).toISOString();
  const bundle = buildSosBundle(data);
  let available = true;
  const context = { week: 6, league: { id: 'fixture', name: 'Adineu fixture', teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { rosterId: 1, owner: 't0z', teamName: 'Boukki', starters: [], bench: [{ sleeperId: '1', name: 'Receiver', nflTeam: 'ARI', position: 'WR' }], ir: [],
      record: { wins: 2, losses: 3 }, standingsRank: 8, faab: { remaining: 500, budget: 1000 } } };
  const app = createAppServer({ coachToken: 'test-only', getSosBundle: async () => available ? bundle : null,
    getContext: async () => context, getInjuryStatuses: async () => new Map(), getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 5, byPosition: {} }), getMatchupContext: async () => null, analyze: async () => ({ results: [] }) });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const explorer = await (await fetch(`${base}/api/sos`)).json();
  const withSos = await (await fetch(`${base}/api/coach`, { headers: { authorization: 'Bearer test-only' } })).json();
  const ai = await (await fetch(`${base}/api/context?mode=decision`)).json();
  assert.equal(withSos.sos.snapshotId, explorer.snapshotId);
  assert.equal(ai.sos.snapshotId, explorer.snapshotId);
  assert.deepEqual(withSos.sos.players[0].sos, explorer.teams.find(t => t.team === 'ARI'));
  assert.deepEqual(ai.sos.players[0].sos, withSos.sos.players[0].sos);
  available = false;
  const withoutSos = await (await fetch(`${base}/api/coach`, { headers: { authorization: 'Bearer test-only' } })).json();
  for (const key of ['waiverActions', 'cutCandidates', 'acquisitionPlan', 'coherence', 'priorities', 'lineup']) assert.deepEqual(withoutSos[key], withSos[key]);
  assert.equal(withoutSos.sos.players[0].sos, null);
});
