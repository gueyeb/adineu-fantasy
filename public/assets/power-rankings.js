export const MINIMUM_COMPLETED_WEEKS = 2;

export const POWER_WEIGHTS = Object.freeze({
  winRate: 0.45,
  pointsPerGame: 0.35,
  recentMargin: 0.20
});

function percentileByManager(stats, selector) {
  if (stats.length === 1) return new Map([[stats[0].manager, 0.5]]);

  const ordered = [...stats].sort((a, b) => selector(a) - selector(b));
  const percentiles = new Map();
  let index = 0;

  while (index < ordered.length) {
    let last = index;
    while (last + 1 < ordered.length && selector(ordered[last + 1]) === selector(ordered[index])) last += 1;
    const percentile = ((index + last) / 2) / (ordered.length - 1);
    for (let tieIndex = index; tieIndex <= last; tieIndex += 1) {
      percentiles.set(ordered[tieIndex].manager, percentile);
    }
    index = last + 1;
  }

  return percentiles;
}

export function calculatePowerRankings(rows, options = {}) {
  const {
    currentWeek = null,
    expectedManagers = [],
    minimumWeeks = MINIMUM_COMPLETED_WEEKS
  } = options;
  const expected = [...new Set(expectedManagers.filter(Boolean))];
  const completedRows = rows.filter(row => {
    const week = Number(row.week);
    return !row.isPlayoff
      && row.manager
      && Number.isFinite(week)
      && Number.isFinite(Number(row.points))
      && Number.isFinite(Number(row.opponentPoints))
      && (currentWeek === null || week < currentWeek);
  }).map(row => ({
    ...row,
    week: Number(row.week),
    points: Number(row.points),
    opponentPoints: Number(row.opponentPoints)
  }));

  const completedWeeks = [...new Set(completedRows.map(row => row.week))].sort((a, b) => a - b);
  const managers = expected.length ? expected : [...new Set(completedRows.map(row => row.manager))];
  const rowsByManager = new Map(managers.map(manager => [manager, []]));
  for (const row of completedRows) {
    if (rowsByManager.has(row.manager)) rowsByManager.get(row.manager).push(row);
  }

  const teamsReady = managers.length > 0
    && managers.every(manager => rowsByManager.get(manager).length >= minimumWeeks);
  const reason = completedWeeks.length < minimumWeeks
    ? "insufficient_weeks"
    : teamsReady ? "ready" : "incomplete_coverage";

  if (reason !== "ready") {
    return {
      ready: false,
      reason,
      completedWeeks,
      completedWeekCount: completedWeeks.length,
      teamsReady: [...rowsByManager.values()].filter(managerRows => managerRows.length >= minimumWeeks).length,
      teamCount: managers.length,
      rankings: []
    };
  }

  const recentWeeks = completedWeeks.slice(-3);
  const stats = managers.map(manager => {
    const managerRows = rowsByManager.get(manager);
    const recentRows = managerRows.filter(row => recentWeeks.includes(row.week));
    const wins = managerRows.filter(row => row.points > row.opponentPoints).length;
    const losses = managerRows.filter(row => row.points < row.opponentPoints).length;
    const ties = managerRows.length - wins - losses;
    const pointsFor = managerRows.reduce((sum, row) => sum + row.points, 0);
    const pointsAgainst = managerRows.reduce((sum, row) => sum + row.opponentPoints, 0);
    const recentMargin = recentRows.reduce((sum, row) => sum + row.points - row.opponentPoints, 0) / recentRows.length;

    return {
      manager,
      team: managerRows.at(-1)?.team || manager,
      games: managerRows.length,
      wins,
      losses,
      ties,
      pointsFor,
      pointsAgainst,
      winRate: (wins + ties / 2) / managerRows.length,
      pointsPerGame: pointsFor / managerRows.length,
      recentMargin
    };
  });

  const winPercentiles = percentileByManager(stats, stat => stat.winRate);
  const scoringPercentiles = percentileByManager(stats, stat => stat.pointsPerGame);
  const marginPercentiles = percentileByManager(stats, stat => stat.recentMargin);
  const ranked = stats.map(stat => ({
    ...stat,
    powerScore: Number((100 * (
      POWER_WEIGHTS.winRate * winPercentiles.get(stat.manager)
      + POWER_WEIGHTS.pointsPerGame * scoringPercentiles.get(stat.manager)
      + POWER_WEIGHTS.recentMargin * marginPercentiles.get(stat.manager)
    )).toFixed(1))
  })).sort((a, b) => b.powerScore - a.powerScore
    || b.pointsPerGame - a.pointsPerGame
    || a.manager.localeCompare(b.manager, "fr"));

  let previousScore = null;
  let previousRank = 0;
  const rankings = ranked.map((stat, index) => {
    const rank = stat.powerScore === previousScore ? previousRank : index + 1;
    previousScore = stat.powerScore;
    previousRank = rank;
    return { ...stat, rank };
  });

  return {
    ready: true,
    reason,
    completedWeeks,
    completedWeekCount: completedWeeks.length,
    teamsReady: managers.length,
    teamCount: managers.length,
    rankings
  };
}
