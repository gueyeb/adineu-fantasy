/**
 * Adineu Fantasy — Standings extras (docs/benchmark-fantasylife.md, lot 1).
 *
 * - calculateLuck: actual wins minus expected wins, where expected wins = all-play win rate ×
 *   games played. Same gate as All-Play / Power Rankings (completed regular-season weeks only,
 *   live week and playoffs excluded, full coverage): never a partial-coverage number.
 * - calculateRankHistory: league rank after each completed regular-season week (wins, then
 *   points-for, then name — the playoff-race.js tiebreak). Factual, no estimate involved.
 *
 * Pure functions, no DOM or network.
 */

import { calculateAllPlayRecords } from "./all-play.js?v=99514b7ee6";

function completedRegularRows(rows, currentWeek) {
  return (rows || []).filter(row => {
    const week = Number(row.week);
    return !row.isPlayoff && row.manager && Number.isFinite(week)
      && Number.isFinite(Number(row.points)) && Number.isFinite(Number(row.opponentPoints))
      && (currentWeek === null || currentWeek === undefined || week < currentWeek);
  }).map(row => ({ ...row, week: Number(row.week), points: Number(row.points), opponentPoints: Number(row.opponentPoints) }));
}

export function calculateLuck(rows, options = {}) {
  const allPlay = calculateAllPlayRecords(rows, options);
  if (!allPlay.ready) return { ready: false, reason: allPlay.reason, completedWeekCount: allPlay.completedWeekCount, records: [] };
  const completed = completedRegularRows(rows, options.currentWeek ?? null);
  const records = allPlay.records.map(record => {
    const games = completed.filter(row => row.manager === record.manager);
    const actualWins = games.reduce((sum, row) => sum + (row.points > row.opponentPoints ? 1 : row.points === row.opponentPoints ? 0.5 : 0), 0);
    const expectedWins = record.winPct * games.length;
    return {
      manager: record.manager,
      games: games.length,
      actualWins,
      expectedWins: Number(expectedWins.toFixed(2)),
      luck: Number((actualWins - expectedWins).toFixed(2))
    };
  });
  return { ready: true, reason: "ready", completedWeekCount: allPlay.completedWeekCount, records };
}

export function calculateRankHistory(rows, { currentWeek = null, expectedManagers = [] } = {}) {
  const completed = completedRegularRows(rows, currentWeek);
  const managers = [...new Set([...expectedManagers.filter(Boolean), ...completed.map(row => row.manager)])];
  // A week counts only once every manager has a completed score for it (no half-published week).
  const weeks = [...new Set(completed.map(row => row.week))].sort((a, b) => a - b)
    .filter(week => managers.every(manager => completed.some(row => row.week === week && row.manager === manager)));
  const totals = new Map(managers.map(manager => [manager, { wins: 0, pointsFor: 0 }]));
  const ranksByManager = new Map(managers.map(manager => [manager, []]));
  for (const week of weeks) {
    for (const row of completed.filter(entry => entry.week === week)) {
      const total = totals.get(row.manager);
      if (!total) continue;
      total.wins += row.points > row.opponentPoints ? 1 : row.points === row.opponentPoints ? 0.5 : 0;
      total.pointsFor += row.points;
    }
    const ordered = [...managers].sort((a, b) =>
      totals.get(b).wins - totals.get(a).wins || totals.get(b).pointsFor - totals.get(a).pointsFor || a.localeCompare(b, "fr"));
    ordered.forEach((manager, index) => ranksByManager.get(manager).push(index + 1));
  }
  return { weeks, series: managers.map(manager => ({ manager, ranks: ranksByManager.get(manager) })) };
}
