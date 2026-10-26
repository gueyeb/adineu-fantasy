import { computeOptimalLineupPoints } from './weekly-recap.js?v=9bbd9594d2';
import { sleeperManager } from './rivalry-week.js?v=714a861458';

const cents = value => Math.round(value * 100);
const points = value => value / 100;

export function resolveCompletedAwardsWeek({ league, state }) {
  const lastRegular = Number(league.settings?.playoff_week_start || 15) - 1;
  if (String(state.season) !== String(league.season)) return 0;
  if (state.season_type === 'post' || league.status === 'complete') return lastRegular;
  if (state.season_type !== 'regular' || !state.season_has_scores) return 0;
  return Math.max(0, Math.min(lastRegular, Number(state.week) - 1 || 0));
}

export function publicTeamIdentity(roster, users) {
  const user = users.find(entry => entry.user_id === roster?.owner_id);
  const manager = sleeperManager(user);
  return { teamName: user?.metadata?.team_name || manager || 'Équipe sans nom public', manager };
}

/** Completed regular-season scores only. No projections, private claims or current player rosters. */
export function buildWeeklyAwards({ rows = [], rosters = [], users = [], week, completedThroughWeek = 0, expectedTeamCount = 12, playerCatalog, rosterPositions }) {
  const unavailable = reason => ({ ready: false, reason, week, teams: [], matchups: [], awards: [], allPlay: [] });
  if (!Number.isInteger(week) || week < 1 || week > completedThroughWeek) return unavailable('WEEK_NOT_COMPLETED');
  const expectedIds = new Set(rosters.map(row => Number(row.roster_id)));
  if (!Number.isInteger(expectedTeamCount) || expectedTeamCount < 2 || expectedTeamCount % 2 ||
      rows.length !== expectedTeamCount || expectedIds.size !== expectedTeamCount ||
      new Set(rows.map(row => Number(row.roster_id))).size !== expectedTeamCount ||
      rows.some(row => !Number.isInteger(Number(row.roster_id)) || !expectedIds.has(Number(row.roster_id)) ||
        !Number.isFinite(row.points) || !Number.isInteger(row.matchup_id))) {
    return unavailable('INCOMPLETE_SCORE_COVERAGE');
  }
  const teams = rows.map(row => ({ rosterId: Number(row.roster_id), matchupId: row.matchup_id,
    ...publicTeamIdentity(rosters.find(roster => Number(roster.roster_id) === Number(row.roster_id)), users),
    scoreCents: cents(row.points), actualScore: points(cents(row.points)) }));
  const pairs = new Map();
  for (const team of teams) {
    if (!pairs.has(team.matchupId)) pairs.set(team.matchupId, []);
    pairs.get(team.matchupId).push(team);
  }
  if ([...pairs.values()].some(pair => pair.length !== 2)) return unavailable('INCOMPLETE_MATCHUP_COVERAGE');
  const matchups = [...pairs.values()].map(([a, b]) => {
    const tie = a.scoreCents === b.scoreCents;
    const winner = tie ? null : a.scoreCents > b.scoreCents ? a : b;
    const loser = tie ? null : winner === a ? b : a;
    a.result = tie ? 'T' : winner === a ? 'W' : 'L';
    b.result = tie ? 'T' : winner === b ? 'W' : 'L';
    return { teams: [a, b], winner, loser, tie, margin: points(Math.abs(a.scoreCents - b.scoreCents)) };
  });
  const allPlay = teams.map(team => {
    const opponents = teams.filter(other => other.rosterId !== team.rosterId);
    const wins = opponents.filter(other => team.scoreCents > other.scoreCents).length;
    const ties = opponents.filter(other => team.scoreCents === other.scoreCents).length;
    return { ...team, wins, ties, losses: opponents.length - wins - ties,
      winRate: (wins + ties * 0.5) / opponents.length };
  }).sort((a, b) => b.scoreCents - a.scoreCents || a.teamName.localeCompare(b.teamName, 'fr'));
  allPlay.forEach((row, index) => { row.rank = index && row.scoreCents === allPlay[index - 1].scoreCents ? allPlay[index - 1].rank : index + 1; });
  const extreme = (list, pick, high = true) => {
    if (!list.length) return [];
    const target = (high ? Math.max : Math.min)(...list.map(pick));
    return list.filter(row => pick(row) === target);
  };
  const decided = matchups.filter(row => !row.tie);
  const awards = [];
  const add = (key, label, laureates, metric) => { if (laureates.length) awards.push({ key, label, laureates, metric }); };
  add('HIGH_SCORE', 'Meilleur score', extreme(teams, row => row.scoreCents), 'score');
  add('LOW_SCORE', 'Plus faible score', extreme(teams, row => row.scoreCents, false), 'score');
  add('BLOWOUT', 'Victoire la plus large', extreme(decided, row => row.margin), 'matchup');
  add('NARROW_WIN', 'Victoire sur le fil', extreme(decided, row => row.margin, false), 'matchup');
  add('HIGH_LOSS', 'Meilleur score en défaite', extreme(teams.filter(row => row.result === 'L'), row => row.scoreCents), 'score');
  add('LOW_WIN', 'Plus faible score en victoire', extreme(teams.filter(row => row.result === 'W'), row => row.scoreCents, false), 'score');
  add('LUCKY_WIN', 'Calendrier favorable', extreme(allPlay.filter(row => row.result === 'W' && row.winRate < 0.5), row => row.winRate, false), 'allPlay');
  add('UNLUCKY_LOSS', 'Défaite malgré un bon score', extreme(allPlay.filter(row => row.result === 'L' && row.winRate > 0.5), row => row.winRate), 'allPlay');
  const players = buildPlayerAwards({ rows, teams, playerCatalog, rosterPositions });
  return { ready: true, reason: 'COMPLETE', week, teams, matchups, awards, allPlay, ...players };
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SLOT_POSITIONS = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'] };

function buildPlayerAwards({ rows, teams, playerCatalog, rosterPositions }) {
  const pools = { starters: [], bench: [] };
  let starterCoverage = true;
  let benchCoverage = true;
  const slots = rosterPositions?.filter(slot => !['BN', 'IR', 'RESERVE'].includes(slot));
  const legalSlots = slots?.length > 0 && slots.length < 20 && slots.every(slot => POSITIONS.includes(slot) || SLOT_POSITIONS[slot]);
  const lineupPerformance = rows.map(row => {
    const team = teams.find(team => team.rosterId === Number(row.roster_id));
    // Only fields from this historical matchup may exclude reserve players. Never current rosters/statuses.
    const reserve = new Set([...(row.reserve || []), ...(row.ir || [])].map(String));
    const ids = row.players?.map(String);
    const starters = row.starters?.map(String);
    let complete = Boolean(ids && starters && new Set(ids).size === ids.length);
    let startersComplete = Boolean(starters && ids && starters.every(id => id === '0' || ids.includes(id)));
    if (starters && new Set(starters.filter(id => id !== '0')).size !== starters.filter(id => id !== '0').length) startersComplete = false;
    const players = [];
    for (const id of ids || []) {
      if (reserve.has(id)) continue;
      const player = playerCatalog?.get ? playerCatalog.get(id) : playerCatalog?.[id];
      const value = row.players_points?.[id];
      const started = starters?.includes(id);
      if (!player || !POSITIONS.includes(player.position) || !Number.isFinite(value)) {
        complete = false;
        if (started) startersComplete = false;
        else benchCoverage = false;
        continue;
      }
      const entry = { ...team, playerId: id, name: player.full_name || player.name || id, position: player.position, points: value };
      pools[started ? 'starters' : 'bench'].push(entry);
      players.push(id);
    }
    if (!ids || !starters) benchCoverage = false;
    if (starters?.some(id => reserve.has(id))) startersComplete = false;
    starterCoverage &&= startersComplete && Boolean(legalSlots) && starters.length === slots.length;
    const legalStarters = legalSlots && starters?.length === slots.length && starters.every((id, i) => {
      if (id === '0') return true;
      const player = playerCatalog?.get ? playerCatalog.get(id) : playerCatalog?.[id];
      return (player?.fantasy_positions || [player?.position]).some(position => (SLOT_POSITIONS[slots[i]] || [slots[i]]).includes(position));
    });
    starterCoverage &&= Boolean(legalStarters);
    complete &&= startersComplete && Boolean(legalStarters);
    const maximum = complete ? computeOptimalLineupPoints({ playerIds: players, playersPoints: row.players_points, playerCatalog, rosterPositions }) : null;
    const sum = startersComplete ? starters.reduce((total, id) => total + (id === '0' ? 0 : row.players_points[id]), 0) : null;
    const consistent = sum !== null && cents(sum) === cents(team.actualScore);
    return { ...team, maximum, gap: maximum === null ? null : points(cents(maximum) - team.scoreCents),
      efficiency: complete && consistent && maximum > 0 ? team.actualScore / maximum * 100 : null };
  });
  const leaders = (pool, covered) => POSITIONS.map(position => {
    const candidates = pool.filter(player => player.position === position);
    const best = Math.max(...candidates.map(player => cents(player.points)));
    return { position, covered, laureates: covered ? candidates.filter(player => cents(player.points) === best) : [] };
  });
  return { playerAwards: leaders(pools.starters, starterCoverage), benchAwards: leaders(pools.bench, benchCoverage), lineupPerformance };
}
