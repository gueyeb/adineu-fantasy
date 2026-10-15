import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWrSos, SOS_TEAM_CODES, normalizeSosTeam } from '../public/assets/wr-ros-sos.js';

const codes = Object.keys(SOS_TEAM_CODES).sort();
const game = (week, away, home, kickoff = `2026-10-${String(week + 10).padStart(2, '0')}T17:00:00Z`, completed = false) =>
  ({ gameId: `${week}_${away}_${home}`, season: 2026, week, away_team: away, home_team: home, kickoffAt: kickoff, completed });
function fixture() {
  return { asOf: '2026-10-15T12:00:00Z', week: 6, lastCompletedWeek: 5,
    schedule: { source: 'nflverse fixture', fetchedAt: '2026-10-15T10:00:00Z', complete: true,
      games: codes.flatMap((team, i) => i % 2 ? [] : [game(6, team, codes[i + 1])]) },
    dvp: { source: 'Sleeper fixture', fetchedAt: '2026-10-15T10:00:00Z', scoring: 'FULL_PPR', completedWeeks: [1, 2, 3, 4, 5],
      byDefense: new Map(codes.map(team => [`${team}|WR`, { valid: true, games: 5, allowedPerGame: 30 }])) } };
}
const row = (output, team = 'ARI') => output.teams.find(row => row.team === team);

test('32 canonical teams, tied ranks and deterministic alphabetical order without input mutation', () => {
  const input = fixture();
  const before = structuredClone(input);
  const output = calculateWrSos(input);
  assert.equal(output.teams.length, 32);
  assert.equal(output.rankedTeams, 32);
  assert.deepEqual(output.teams.map(t => t.team), codes);
  assert.ok(output.teams.every(t => t.rank === 1 && t.sosScore === 30));
  assert.deepEqual(input, before);
  assert.deepEqual(calculateWrSos(input), output);
});
test('raw numerical values are regressed once using game-weighted NFL mean', () => {
  const input = fixture();
  input.dvp.byDefense = new Map([
    ['ATL|WR', { valid: true, games: 1, allowedPerGame: 60, adjusted: 999 }],
    ['ARI|WR', { valid: true, games: 5, allowedPerGame: 20 }]
  ]);
  const output = calculateWrSos(input);
  assert.equal(output.leagueAverage, 160 / 6);
  assert.equal(row(output).sosScore, 35);
  assert.ok(row(output).sosScore < 60);
  assert.equal(row(output).rank, 1);
});
test('partial coverage publishes indicative score only; missing DvP never becomes zero', () => {
  const input = fixture();
  input.schedule.games.push(game(7, 'ARI', 'BAL'));
  input.dvp.byDefense.delete('BAL|WR');
  const output = calculateWrSos(input);
  assert.equal(row(output).coverageStatus, 'PARTIAL');
  assert.equal(row(output).coveragePct, 50);
  assert.equal(row(output).sosScore, 30);
  assert.equal(row(output).rank, null);
  assert.equal(row(output).difficulty, null);
  assert.equal(row(output).opponents[1].adjustedDifficulty, null);
});
test('mixed week excludes completed and started games, past stops at completed week', () => {
  const input = fixture();
  input.schedule.games = [game(5, 'ARI', 'ATL', '2026-10-10T17:00:00Z', true),
    game(6, 'BAL', 'BUF', '2026-10-15T11:00:00Z'),
    game(6, 'CAR', 'CHI', '2026-10-15T10:00:00Z', true),
    game(6, 'ARI', 'ATL'), game(15, 'ARI', 'BAL')];
  assert.deepEqual(row(calculateWrSos(input)).opponents.map(g => g.week), [6]);
  assert.equal(row(calculateWrSos(input), 'BAL').gamesInWindow, 0);
  const past = calculateWrSos({ ...input, horizon: 'PAST' });
  assert.deepEqual(row(past).opponents.map(g => g.week), [5]);
  assert.equal(row(past, 'CAR').gamesInWindow, 0);
});
test('NEXT_3 counts games across byes, fantasy and NFL horizons differ', () => {
  const input = fixture();
  input.schedule.games = [game(6, 'ARI', 'ATL'), game(8, 'ARI', 'BAL'), game(14, 'ARI', 'BUF'),
    game(15, 'ARI', 'CAR'), game(17, 'ARI', 'CHI'), game(18, 'ARI', 'CIN')];
  const next = row(calculateWrSos({ ...input, horizon: 'NEXT_3' }));
  assert.deepEqual(next.opponents.map(g => g.week), [6, 8, 14]);
  assert.ok(next.byeWeeks.includes(7));
  assert.equal(next.coveredGames, 3);
  assert.deepEqual(row(calculateWrSos({ ...input, horizon: 'FANTASY_PLAYOFFS' })).opponents.map(g => g.week), [15, 17]);
  assert.equal(row(calculateWrSos({ ...input, horizon: 'NFL_ROS' })).gamesInWindow, 6);
});
test('empty validated window differs from unavailable DvP and unknown schedule', () => {
  const input = fixture();
  input.dvp.byDefense.clear();
  assert.equal(row(calculateWrSos(input)).reason, 'DVP_UNAVAILABLE');
  input.schedule.games = [];
  assert.equal(row(calculateWrSos(input)).reason, 'NO_REMAINING_GAMES');
  assert.equal(row(calculateWrSos(input)).coveragePct, 100);
  input.schedule.complete = false;
  const output = row(calculateWrSos(input));
  assert.equal(output.coverageStatus, 'UNAVAILABLE');
  assert.equal(output.coveragePct, 0);
  assert.deepEqual(output.byeWeeks, []);
});
test('unattested DvP, null and empty numeric values are not valid observations', () => {
  for (const change of [{ valid: false }, { valid: undefined }, { allowedPerGame: null }, { allowedPerGame: '' }, { games: 6 }]) {
    const input = fixture();
    Object.assign(input.dvp.byDefense.get('ATL|WR'), change);
    assert.equal(row(calculateWrSos(input)).sosScore, null);
  }
});
test('competition ranks preserve precision ties then skip occupied ranks', () => {
  const input = fixture();
  input.dvp.byDefense.get('ATL|WR').allowedPerGame = 40;
  input.dvp.byDefense.get('BUF|WR').allowedPerGame = 40.00001;
  const ranked = calculateWrSos(input).teams;
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[2].rank, 3);
});
test('reject unsupported horizons, future observations, incompatible scoring and malformed schedule', () => {
  for (const mutate of [
    input => { input.horizon = 'QB'; },
    input => { input.dvp.fetchedAt = '2026-10-16T00:00:00Z'; },
    input => { input.dvp.completedWeeks.push(6); },
    input => { input.dvp.scoring = 'HALF_PPR'; },
    input => { input.schedule.games[0].kickoffAt = null; },
    input => { input.schedule.games.push(input.schedule.games[0]); },
    input => { input.schedule.games[0].season = 2025; },
    input => { input.schedule.games[0].away_team = 'UNKNOWN'; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => calculateWrSos(input));
  }
});
test('explicit identity mapping, ROS alias and end-of-season empty window', () => {
  assert.equal(normalizeSosTeam('LA', 'nflverse'), 'LAR');
  assert.equal(normalizeSosTeam('LAR'), 'LAR');
  assert.throws(() => normalizeSosTeam('Rams'));
  assert.equal(calculateWrSos({ ...fixture(), horizon: 'ROS' }).window.horizon, 'FANTASY_ROS');
  const input = fixture();
  input.schedule.games = [];
  assert.equal(row(calculateWrSos({ ...input, week: 19, lastCompletedWeek: 18 })).rank, null);
});

test('shared nflverse loader preserves game identity, season and Eastern kickoff', async () => {
  const { getSchedule } = await import('../scripts/league-context.js');
  const games = await getSchedule({ season: '2026', fetchImpl: async () => ({ ok: true,
    text: async () => 'game_id,season,game_type,week,away_team,home_team,gameday,gametime,away_score,home_score,spread_line,total_line,away_qb_name,home_qb_name\n2026_06_LA_ATL,2026,REG,6,LA,ATL,2026-10-18,13:00,,,,,,\n' }) });
  assert.equal(games.length, 1);
  assert.equal(games[0].gameId, '2026_06_LA_ATL');
  assert.equal(games[0].season, 2026);
  assert.equal(games[0].away_team, 'LAR');
  assert.equal(games[0].kickoffAt, '2026-10-18T17:00:00.000Z');
  assert.equal(games[0].completed, false);
});
