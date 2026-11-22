import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamSchedules, buildVirtualDuel, scheduleMessage } from '../public/assets/team-schedule.js';
const teams = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }, { id: '4', name: 'D' }];
const week = scores => scores.map((points, i) => ({ roster_id: i + 1, matchup_id: Math.floor(i / 2) + 1, points }));
const build = weeks => buildTeamSchedules({ teams, weeks, completedThroughWeek: 2, regularWeekCount: 4 });
test('actual opponent scores, ties, ranks and remaining opponent scoring stay separate', () => {
  const report = build({ 1: week([100, 120, 90, 90]), 2: week([0, 100, 110, 80]), 3: week([999, 999, 999, 999]), 4: week([0, 0, 0, 0]) });
  const [a, b, c] = report.teams;
  assert.equal(a.sos, 110);
  assert.equal(a.ppg, 50);
  assert.equal(a.ros, 110);
  assert.equal(a.losses, 2);
  assert.equal(b.wins, 2);
  assert.equal(c.ties, 1);
  assert.equal(a.sosRank, 1);
  assert.equal(a.games[2].result, null);
  assert.match(scheduleMessage([a, b], report.validWeeks), /A a encaissé 60,00/);
});
test('missing and all-zero past weeks are excluded league-wide; partial ROS is suppressed', () => {
  const report = build({ 1: week([0, 0, 0, 0]), 2: week([100, 120, 90, 80]).slice(0, 3), 3: week([0, 0, 0, 0]) });
  assert.deepEqual(report.validWeeks, []);
  assert.deepEqual(report.missingWeeks, [1, 2]);
  assert.ok(report.teams.every(t => t.sos === null && t.ros === null && t.ties === 0));
});
test('repeated opponents count once per scheduled meeting and tied ranks persist', () => {
  const report = build({ 1: week([100, 100, 100, 100]), 2: week([100, 100, 100, 100]), 3: week([0, 0, 0, 0]) });
  assert.ok(report.teams.every(t => t.sosRank === 1 && t.ties === 2 && t.ros === null));
});

// Ship signal: weekly head-to-head uses own scores, preserves ties and never scores future weeks.
test('virtual duel compares same-week own scores, independent of actual opponents or totals', () => {
  const { teams: rows } = build({ 1: week([100, 120, 99, 80]), 2: week([0, 100, 90, 80]), 3: week([999, 1, 1, 1]) });
  const duel = buildVirtualDuel(rows[0], rows[2]);
  assert.deepEqual(duel.recordA, { wins: 1, losses: 1, ties: 0 });
  assert.deepEqual(duel.recordB, { wins: 1, losses: 1, ties: 0 });
  assert.equal(duel.leaderId, null);
  assert.deepEqual(duel.weeks.map(row => row.week), [1, 2]);
  assert.equal(duel.weeks[0].resultA, 'V');
  assert.match(scheduleMessage([rows[0], rows[2]], [1, 2]), /Duel virtuel/);
});
test('virtual duel excludes missing, unverified, nonnumeric and playoff scores, retains zero and ties', () => {
  const a = { id: 'a', games: [
    { week: 1, points: 0, status: 'completed' },
    { week: 2, points: 100, status: 'completed' },
    { week: 3, points: 200, status: 'unverified' },
    { week: 4, points: null, status: 'completed' },
    { week: 5, points: 200, status: 'completed', isPlayoff: true }
  ] };
  const b = { id: 'b', games: [1, 2, 3, 4, 5].map(week => ({ week, points: week === 1 ? 0 : 90, status: 'completed' })) };
  const duel = buildVirtualDuel(a, b);
  assert.deepEqual(duel.recordA, { wins: 1, losses: 0, ties: 1 });
  assert.equal(duel.leaderId, 'a');
  assert.equal(buildVirtualDuel(a, a), null);
  assert.equal(buildVirtualDuel({ id: 'c', games: [] }, b).weeks.length, 0);
  assert.equal(buildVirtualDuel({ id: 'c', games: [] }, b).leaderId, null);
});

test('self-excluded reference removes the structural bias of strong and weak scorers', () => {
  // Every team faces every other team once: all adjusted schedules must be neutral.
  const scores = [200, 120, 100, 60];
  const batch = pairs => scores.map((points, i) => ({ roster_id: i + 1, points, matchup_id: pairs[i] }));
  const report = buildTeamSchedules({ teams, weeks: { 1: batch([1, 1, 2, 2]),
    2: batch([1, 2, 1, 2]), 3: batch([1, 2, 2, 1]),
    4: batch([1, 1, 2, 2]), 5: batch([1, 2, 1, 2]), 6: batch([1, 2, 2, 1]) },
    completedThroughWeek: 3, regularWeekCount: 6 });
  assert.ok(report.teams.every(t => t.sosAdjusted === 0 && t.rosAdjusted === 0));
  assert.ok(report.teams.every(t => t.sosAdjustedRank === 1 && t.rosAdjustedRank === 1));
  assert.ok(report.teams[0].ros < report.teams[3].ros);
  assert.equal(report.teams[0].opponentBaseline, (120 + 100 + 60) / 3);
});
test('own scores do not enter own reference; adjusted ROS requires complete coverage', () => {
  const before = build({ 1: week([100, 120, 90, 80]), 2: week([100, 120, 90, 80]),
    3: week([0, 0, 0, 0]), 4: week([0, 0, 0, 0]) });
  const after = build({ 1: week([300, 120, 90, 80]), 2: week([300, 120, 90, 80]),
    3: week([0, 0, 0, 0]), 4: week([0, 0, 0, 0]) });
  assert.equal(before.teams[0].rosAdjusted, after.teams[0].rosAdjusted);
  assert.equal(before.teams[0].opponentBaseline, after.teams[0].opponentBaseline);
  assert.ok(before.teams[0].rosAdjusted > 0);
  assert.equal(build({ 1: week([100, 120, 90, 80]) }).teams[0].rosAdjusted, null);
  assert.equal(build({}).teams[0].sosAdjusted, null);
});
