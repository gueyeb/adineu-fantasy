import test from 'node:test';
import assert from 'node:assert/strict';
import { sosDifficultyFields, buildSosSummary } from '../public/assets/sos-insights.js';
import { filterSosTeams } from '../public/assets/sos-explorer.js';

test('relative cutoffs preserve official ties and unknown ranks, independent from absolute difficulty', () => {
  for (const [rank, relative] of [[1, 'FAVORABLE'], [10, 'FAVORABLE'], [11, 'NEUTRAL'], [22, 'NEUTRAL'], [23, 'DIFFICULT'], [32, 'DIFFICULT'], [null, null]]) {
    assert.deepEqual(sosDifficultyFields({ rank, difficulty: 'NEUTRAL' }), { relativeDifficulty: relative, absoluteDifficulty: 'NEUTRAL' });
  }
  const teams = [{ team: 'TEN', rank: 1, difficulty: 'NEUTRAL' }, { team: 'BUF', rank: 31, difficulty: 'NEUTRAL' }, { team: 'DEN', rank: 31, difficulty: 'NEUTRAL' }, { team: 'X', rank: null, difficulty: null }];
  const before = structuredClone(teams);
  assert.deepEqual(filterSosTeams(teams, { relativeDifficulty: 'DIFFICULT' }).map(t => t.team), ['BUF', 'DEN']);
  assert.equal(filterSosTeams(teams, { difficulty: 'NEUTRAL' }).length, 3);
  assert.equal(filterSosTeams(teams, { relativeDifficulty: 'FAVORABLE', difficulty: 'DIFFICULT' }).length, 0);
  assert.deepEqual(teams, before);
});

test('summary preserves matchup ties, missing data, historical lineage and signed rank movement', () => {
  const snapshot = { asOf: '2026-10-15T12:00:00Z', methodologyVersion: 'v1', window: { horizon: 'FANTASY_ROS' }, teams: [
    { team: 'TEN', rank: 1, sosScore: 34, opponents: [{ week: 6, opponent: 'A', adjustedDifficulty: 35 }, { week: 7, opponent: 'B', adjustedDifficulty: 35 }, { week: 8, opponent: 'C', adjustedDifficulty: null }] },
    { team: 'DEN', rank: null, sosScore: null, opponents: [] }
  ] };
  const trends = [{ snapshotId: 'old', asOf: '2026-10-10T12:00:00Z', methodologyVersion: 'v1', teams: [{ team: 'TEN', rank: 8 }] },
    { asOf: '2026-10-14T12:00:00Z', methodologyVersion: 'other', teams: [] }, { asOf: '2026-10-16T12:00:00Z', methodologyVersion: 'v1', teams: [] }];
  const summary = buildSosSummary(snapshot, snapshot.teams, trends);
  assert.equal(summary.previousSnapshotId, 'old');
  assert.equal(summary.teams[0].rankChange, 7);
  assert.equal(summary.teams[0].easiestMatchups.length, 2);
  assert.equal(summary.teams[1].rankChange, null);
  assert.deepEqual(summary.teams[1].hardestMatchups, []);
  assert.equal(buildSosSummary(snapshot).teams[0].rankChange, null);
});
