import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyAwards, resolveCompletedAwardsWeek } from '../public/assets/weekly-awards.js';
import { renderWeeklyAwards } from '../public/assets/weekly-awards-view.js';
import { loadPublicWeek } from '../public/assets/public-week.js';

function fixture(scores) {
  const rosters = scores.map((_, i) => ({ roster_id: i + 1, owner_id: `u${i}`, settings: { wins: 2, losses: 2, ties: 0, fpts: 400, fpts_decimal: 25 } }));
  const users = scores.map((_, i) => ({ user_id: `u${i}`, display_name: `Manager ${i}`, metadata: { team_name: `Team ${i}` } }));
  const rows = scores.map((points, i) => ({ roster_id: i + 1, matchup_id: Math.floor(i / 2) + 1, points }));
  return { rows, rosters, users, expectedTeamCount: scores.length, week: 4, completedThroughWeek: 4 };
}

test('12 teams have 11 all-play comparisons and symmetrical wins/losses; all award ties survive', () => {
  const data = fixture([160, 140, 160, 90, 130, 80, 120, 100, 110, 95, 100, 70]);
  const recap = buildWeeklyAwards(data);
  assert.equal(recap.ready, true);
  assert.equal(recap.awards.find(row => row.key === 'HIGH_SCORE').laureates.length, 2);
  assert.deepEqual(recap.allPlay.slice(0, 3).map(row => row.rank), [1, 1, 3]);
  for (const team of recap.allPlay) assert.equal(team.wins + team.losses + team.ties, 11);
  assert.equal(recap.allPlay.reduce((n, row) => n + row.wins, 0), recap.allPlay.reduce((n, row) => n + row.losses, 0));
  assert.equal(recap.allPlay[0].winRate, 10.5 / 11);
});

test('real zero and negative scores are included; tied matches receive no victory award', () => {
  const recap = buildWeeklyAwards(fixture([0, -2, 10, 10]));
  assert.equal(recap.awards.find(row => row.key === 'LOW_SCORE').laureates[0].actualScore, -2);
  assert.equal(recap.awards.find(row => row.key === 'NARROW_WIN').laureates[0].margin, 2);
  assert.equal(recap.teams.filter(row => row.result === 'T').length, 2);
  const allTies = buildWeeklyAwards(fixture([0, 0, 0, 0]));
  assert.ok(allTies.awards.every(row => ['HIGH_SCORE', 'LOW_SCORE'].includes(row.key)));
  assert.ok(allTies.allPlay.every(row => row.winRate === 0.5));
});

test('missing, duplicate, invalid and unpaired scores suppress awards; live week never publishes', () => {
  const data = fixture([100, 90, 80, 70]);
  for (const points of [null, undefined, NaN, '0']) {
    const changed = structuredClone(data); changed.rows[0].points = points;
    assert.equal(buildWeeklyAwards(changed).ready, false);
  }
  assert.equal(buildWeeklyAwards({ ...data, rows: data.rows.slice(1) }).ready, false);
  const duplicate = structuredClone(data); duplicate.rows[0].roster_id = duplicate.rows[1].roster_id;
  assert.equal(buildWeeklyAwards(duplicate).ready, false);
  const unpaired = structuredClone(data); unpaired.rows[0].matchup_id = 100;
  assert.equal(buildWeeklyAwards(unpaired).reason, 'INCOMPLETE_MATCHUP_COVERAGE');
  assert.equal(buildWeeklyAwards({ ...data, completedThroughWeek: 3 }).reason, 'WEEK_NOT_COMPLETED');
});

test('calendar awards require a win below 50 percent or loss above 50 percent all-play', () => {
  const recap = buildWeeklyAwards(fixture([100, 90, 160, 140]));
  assert.equal(recap.awards.find(row => row.key === 'LUCKY_WIN').laureates[0].actualScore, 100);
  assert.equal(recap.awards.find(row => row.key === 'UNLUCKY_LOSS').laureates[0].actualScore, 140);
  const normal = buildWeeklyAwards(fixture([160, 90, 140, 100]));
  assert.equal(normal.awards.some(row => row.key === 'LUCKY_WIN'), false);
});

test('completion gate rejects week one live, preseason and season mismatch; regular playoffs are excluded', () => {
  const league = { season: '2026', settings: { playoff_week_start: 15 } };
  const state = { season: '2026', season_type: 'regular', season_has_scores: true, week: 5 };
  assert.equal(resolveCompletedAwardsWeek({ league, state }), 4);
  assert.equal(resolveCompletedAwardsWeek({ league, state: { ...state, week: 1 } }), 0);
  assert.equal(resolveCompletedAwardsWeek({ league, state: { ...state, season: '2027' } }), 0);
  assert.equal(resolveCompletedAwardsWeek({ league, state: { ...state, season_type: 'pre' } }), 0);
  assert.equal(resolveCompletedAwardsWeek({ league, state: { ...state, week: 16 } }), 14);
});

test('public loader uses only public Sleeper resources and renders escaped names without identifiers', async () => {
  const data = fixture([100, 90, 160, 140]);
  data.users[0].metadata.team_name = '<script>unsafe</script>';
  const paths = [];
  const loaded = await loadPublicWeek({ leagueId: 'fixture', getCore: async () => ({ ...data,
    league: { season: '2026', total_rosters: 4, settings: { playoff_week_start: 15, playoff_teams: 2 }, scoring_settings: { rec: 1 } },
    state: { season: '2026', season_type: 'regular', season_has_scores: true, week: 5 }
  }), get: async path => { paths.push(path); return data.rows; } });
  assert.deepEqual(paths, ['/league/fixture/matchups/4', '/league/fixture/matchups/5']);
  assert.equal(loaded.standings[0].pointsFor, 400.25);
  assert.equal(loaded.nextMatchups.length, 2);
  const html = renderWeeklyAwards(loaded.recap);
  assert.doesNotMatch(html, /<script>|owner_id|rosterId|u0/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /All-play · semaine 4 uniquement/);
  assert.match(renderWeeklyAwards({ ready: false, reason: 'WEEK_NOT_COMPLETED' }), /pas encore terminée/);
});
