import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyAwards } from '../public/assets/weekly-awards.js';
import { computeOptimalLineupPoints } from '../public/assets/weekly-recap.js';
import { renderWeeklyAwards } from '../public/assets/weekly-awards-view.js';

function fixture() {
  const playerCatalog = { a: { name: '<A>', position: 'WR' }, b: { name: 'B', position: 'RB' },
    c: { name: 'C', position: 'WR' }, d: { name: 'D', position: 'RB' }, ir: { name: 'IR', position: 'WR' } };
  return { week: 4, completedThroughWeek: 4, expectedTeamCount: 2, rosterPositions: ['FLEX', 'BN', 'IR'], playerCatalog,
    rosters: [{ roster_id: 1 }, { roster_id: 2 }], rows: [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['a', 'b', 'ir'], starters: ['a'], reserve: ['ir'], players_points: { a: 10, b: 20, ir: 100 } },
      { roster_id: 2, matchup_id: 1, points: 10, players: ['c', 'd'], starters: ['c'], players_points: { c: 10, d: 20 } }
    ] };
}

test('starter MVP keeps ties and FLEX NFL positions; bench keeps ties and excludes historical IR', () => {
  const recap = buildWeeklyAwards(fixture());
  assert.deepEqual(recap.playerAwards.find(row => row.position === 'WR').laureates.map(row => row.playerId), ['a', 'c']);
  assert.deepEqual(recap.benchAwards.find(row => row.position === 'RB').laureates.map(row => row.playerId), ['b', 'd']);
  assert.equal(recap.benchAwards.find(row => row.position === 'WR').laureates.length, 0);
  assert.equal(recap.lineupPerformance[0].maximum, 20);
  assert.equal(recap.lineupPerformance[0].gap, 10);
  assert.equal(recap.lineupPerformance[0].efficiency, 50);
  const html = renderWeeklyAwards(recap);
  assert.match(html, /efficacité de lineup après match/i);
  assert.match(html, /&lt;A&gt;/);
  assert.match(html, /table-wrap/);
  assert.doesNotMatch(renderWeeklyAwards(recap, { compact: true }), /Maximum théorique|MVP par poste/);
});

test('zero is covered; max zero yields n/d; missing scores never become zero', () => {
  const data = fixture();
  for (const row of data.rows) {
    row.points = 0;
    for (const id of row.players) row.players_points[id] = 0;
  }
  let recap = buildWeeklyAwards(data);
  assert.equal(recap.playerAwards.find(row => row.position === 'WR').laureates.length, 2);
  assert.equal(recap.lineupPerformance[0].maximum, 0);
  assert.equal(recap.lineupPerformance[0].efficiency, null);
  for (const missing of [undefined, null, '0', NaN]) {
    data.rows[0].players_points.a = missing;
    recap = buildWeeklyAwards(data);
    assert.equal(recap.playerAwards.find(row => row.position === 'WR').laureates.length, 0);
    assert.equal(recap.lineupPerformance[0].maximum, null);
    assert.equal(recap.lineupPerformance[0].efficiency, null);
  }
});

test('mismatched official score suppresses ratio without clamping or hiding official score', () => {
  const data = fixture(); data.rows[0].points = 25;
  const team = buildWeeklyAwards(data).lineupPerformance[0];
  assert.equal(team.actualScore, 25);
  assert.equal(team.maximum, 20);
  assert.equal(team.gap, -5);
  assert.equal(team.efficiency, null);
});

test('missing historical bench coverage suppresses bench awards and maximum; current reserve is ignored', () => {
  const data = fixture();
  data.rosters[0].reserve = ['b'];
  assert.equal(buildWeeklyAwards(data).lineupPerformance[0].maximum, 20);
  delete data.rows[0].players_points.b;
  const recap = buildWeeklyAwards(data);
  assert.ok(recap.benchAwards.every(row => row.laureates.length === 0));
  assert.equal(recap.lineupPerformance[0].maximum, null);
  assert.equal(recap.playerAwards.find(row => row.position === 'WR').laureates.length, 2);
});

test('incomplete and live weeks publish nothing; unknown positions and slots suppress metrics', () => {
  const data = fixture();
  assert.equal(buildWeeklyAwards({ ...data, completedThroughWeek: 3 }).ready, false);
  assert.equal(buildWeeklyAwards({ ...data, rows: data.rows.slice(1) }).ready, false);
  assert.equal(buildWeeklyAwards({ ...data, rosterPositions: ['UNKNOWN'] }).lineupPerformance[0].maximum, null);
  delete data.playerCatalog.a;
  assert.equal(buildWeeklyAwards(data).lineupPerformance[0].efficiency, null);
});

test('shared optimizer honors overlapping slots, multi eligibility, decimals and real roster positions', () => {
  const playerCatalog = { a: { position: 'RB', fantasy_positions: ['RB', 'WR'] }, b: { position: 'RB' }, c: { position: 'QB' } };
  assert.equal(computeOptimalLineupPoints({ playerIds: ['a', 'b', 'c'], playersPoints: { a: 10.12, b: 9.13, c: 20.14 },
    playerCatalog, rosterPositions: ['WR', 'FLEX', 'SUPER_FLEX', 'BN', 'IR'] }), 39.39);
});

test('maximum fills required positions even with negative actual scores', () => {
  assert.equal(computeOptimalLineupPoints({ playerIds: ['def'], playersPoints: { def: -3 },
    playerCatalog: { def: { position: 'DEF' } }, rosterPositions: ['DEF'] }), -3);
});
