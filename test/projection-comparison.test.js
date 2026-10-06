import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectionComparison, loadProjectionCapture, formatProjectionComparison } from '../scripts/projection-comparison.js';
import { collectProjections } from '../scripts/collect-projections.js';
import { createDecisionSnapshot, replayDecisionSnapshot } from '../scripts/decision-snapshot.js';

const asOf = '2026-10-07T08:00:00Z';
const player = { sleeperId: '100', name: 'Example Receiver', nflTeam: 'JAX', position: 'WR' };
const game = { week: 5, home_team: 'JAX', away_team: 'KC', kickoffAt: '2026-10-11T17:00:00Z' };
function fixture() {
  const common = { season: 2026, week: 5, position: 'WR', scoring: 'PPR', observed_at_ms: Date.parse(asOf), total_count: 122 };
  return { version: 1, season: 2026, week: 5, scoring: 'PPR', capturedAt: asOf, sources: [
    { provider: 'draftsharks-com', capability: 'fantasy-sports-rankings/weekly_rankings', position: 'WR', fetchedAt: asOf,
      data: { ...common, superflex: false, last_updated_at: asOf, source_url: 'https://www.draftsharks.com/weekly-rankings/',
        players: [{ name: player.name, team: 'JAC', position: 'WR', player_id: 20, projected_points: 12, consensus_points: 99, projected_3d: 98, opponent_id: 'KC' }] } },
    { provider: 'cbssports-com', capability: 'fantasy-sports-rankings/projections', position: 'WR', fetchedAt: asOf,
      data: { ...common, projection_type: 'weekly', source_url: 'https://www.cbssports.com/fantasy/football/',
        players: [{ name: player.name, team: 'JAX', position: 'WR', player_id: 30, fantasy_points: 14 }] } }
  ] };
}
const compare = capture => buildProjectionComparison({ capture, season: 2026, week: 5, asOf, players: [player], schedule: [game] });

test('two sources map exact player identity and retain partial coverage without double counting composites', () => {
  const report = compare(fixture());
  assert.equal(report.status, 'CONTEXT_ONLY');
  assert.equal(report.changesDecisionModel, false);
  assert.equal(report.rows[0].playerId, '100');
  assert.deepEqual(report.rows[0].values.map(value => value.points), [12, 14]);
  assert.equal(report.rows[0].spread, 2);
  assert.equal(report.sources[0].coverage, 'PARTIAL');
  assert.equal(report.sources[1].providerUpdatedAt, null);
  assert.match(formatProjectionComparison(report, ['100']).join('\n'), /barème complet non certifié/);
});

test('wrong week, scoring, ROS, unknown provider and invalid time quarantine sources', () => {
  for (const mutate of [
    source => { source.data.week = 4; }, source => { source.data.season = 2025; },
    source => { source.data.scoring = 'STD'; }, source => { source.data.position = 'TE'; },
    source => { source.data.observed_at_ms = Date.parse(asOf) + 1; },
    source => { source.fetchedAt = '2026-10-05T08:00:00Z'; },
    source => { source.data.last_updated_at = '2026-10-01T08:00:00Z'; },
    source => { source.provider = 'unknown'; }, source => { source.data.source_url = 'https://example.com'; }
  ]) {
    const capture = fixture(); mutate(capture.sources[0]);
    const report = compare(capture);
    assert.equal(report.sources[0].status, 'HELD');
    assert.equal(report.rows[0].values.length, 1);
    assert.equal(report.rows[0].spread, null);
  }
  const capture = fixture(); capture.sources[1].data.projection_type = 'ros';
  assert.equal(compare(capture).sources[1].status, 'HELD');
});

test('ambiguous identities, duplicate providers, null points and contradictory opponent cannot create consensus', () => {
  const capture = fixture(); capture.sources.push(structuredClone(capture.sources[0]));
  assert.equal(compare(capture).rows[0].values.length, 1);
  const bad = fixture(); bad.sources[0].data.players[0].opponent_id = 'BUF'; bad.sources[1].data.players[0].fantasy_points = null;
  assert.equal(compare(bad).status, 'HELD');
  const ambiguous = buildProjectionComparison({ capture: fixture(), season: 2026, week: 5, asOf,
    players: [player, { ...player, sleeperId: '101' }], schedule: [game] });
  assert.equal(ambiguous.status, 'HELD');
  const duplicates = fixture(); duplicates.sources[0].data.players.push(structuredClone(duplicates.sources[0].data.players[0]));
  assert.equal(compare(duplicates).rows[0].values.length, 1);
});

test('missing or locked schedule, stale capture and unconfigured cache are explicit', async () => {
  assert.equal(compare(null).status, 'NOT_CONFIGURED');
  assert.equal(compare({ loadError: 'CAPTURE_UNREADABLE' }).status, 'HELD');
  assert.deepEqual(await loadProjectionCapture('/nonexistent/adineu-file'), { loadError: 'CAPTURE_UNREADABLE' });
  const capture = fixture(); capture.capturedAt = '2026-10-05T08:00:00Z';
  assert.equal(compare(capture).status, 'HELD');
  for (const schedule of [[], [{ ...game, kickoffAt: asOf }]]) assert.equal(buildProjectionComparison({ capture: fixture(), season: 2026, week: 5, asOf, players: [player], schedule }).status, 'HELD');
});


test('collector uses explicit contracts, preserves nested failures and writes private immutable capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projection-test-'));
  try {
    const output = join(directory, 'capture.json');
    const calls = [];
    const run = async (command, args) => {
      calls.push({ command, args });
      const provider = args[1].split('/')[0];
      const source = fixture().sources.find(source => source.provider === provider);
      await writeFile(args.at(-1), JSON.stringify({ success: true, data: { alexandria: [{ provider, capability: source.capability,
        ...(provider === 'cbssports-com' ? { error: 'not_found' } : { data: source.data }) }] } }));
    };
    assert.equal((await collectProjections({ season: 2026, week: 5, position: 'WR', output, run })).successfulSources, 1);
    const saved = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(saved.sources[1].error, 'COLLECTION_FAILED');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(calls[0].command, 'firecrawl');
    assert.equal(JSON.parse(calls[0].args[3]).week, 5);
    await assert.rejects(collectProjections({ season: 2026, week: 5, position: 'WR', output, run }), /already exists/);
    assert.equal(calls.length, 2);
    await assert.rejects(collectProjections({ season: 2026, week: 5, position: 'QB', output, run }), /Explicit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('frozen decision output retains comparison and refuses future source observations', () => {
  const report = { leagueId: 'league', season: 2026, week: 5, availabilityAsOf: asOf, byPosition: {}, projectionComparison: compare(fixture()) };
  const snapshot = createDecisionSnapshot(report, { recordedAt: asOf });
  assert.deepEqual(replayDecisionSnapshot(snapshot, { cutoff: asOf }).report.projectionComparison, report.projectionComparison);
  report.projectionComparison.rows[0].values[0].observedAt = '2026-10-08T08:00:00Z';
  assert.throws(() => replayDecisionSnapshot(createDecisionSnapshot(report, { recordedAt: asOf }), { cutoff: asOf }), /after replay cutoff/);
});

test('AI Context and Coach carry the same comparison for n8n without altering recommended actions', async () => {
  const { buildDecisionContext } = await import('../scripts/ai-context.js');
  const { buildCoachPlan, formatCoachPlan } = await import('../scripts/coach-assistant.js');
  const comparison = compare(fixture());
  const context = buildDecisionContext({ context: { week: 5, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { teamName: 'Boukki', starters: [], bench: [], ir: [], record: { wins: 1, losses: 3 } } }, waivers: { byPosition: {}, projectionComparison: comparison } });
  assert.equal(context.projectionComparison, comparison);
  const plan = buildCoachPlan({ decisionContext: { ...context, lineup: { optimal: { gain: 0.5, changes: [{ slot: 'WR', in: { ...player }, out: { name: 'Other' }, gain: 0.5 }] } } }, trades: { results: [] } });
  assert.equal(plan.projectionComparison, comparison);
  assert.match(formatCoachPlan(plan), /Example Receiver : draftsharks-com 12 ; cbssports-com 14/);
  assert.match(formatCoachPlan(plan), /Choix proche/);
  assert.equal(plan.waiverActions.ADD_NOW.length, 0);
});


test('malformed external rows and source arrays cannot fail the decision endpoint', () => {
  const capture = fixture(); capture.sources[0].data.players.push(null, 'invalid');
  assert.equal(compare(capture).rows[0].values.length, 2);
  assert.ok(compare(capture).sources[0].issues.includes('PLAYER_ROW_INVALID'));
  capture.sources.push(null);
  assert.equal(compare(capture).status, 'HELD');
});
