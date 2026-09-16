/**
 * Adineu Fantasy — All-Play Record
 *
 * "Combien d'équipes tu aurais battues chaque semaine, si tu avais joué contre les 11 autres."
 * Same activation gate and completed-weeks filtering as calculatePowerRankings (reuses the same
 * matchup rows and MINIMUM_COMPLETED_WEEKS) — never shown before the ranking itself is ready,
 * for the same reason: no partial-coverage stat presented as a real number.
 *
 * Deliberately narrow: this does not recompute each manager's actual win/loss record — that
 * number already exists (Supabase v_standings, shown elsewhere on the page) and duplicating it
 * from a second data path risks the two disagreeing. All-play here is purely descriptive.
 */

import { MINIMUM_COMPLETED_WEEKS } from "./power-rankings.js?v=1";

export function calculateAllPlayRecords(rows, options = {}) {
  const {
    currentWeek = null,
    expectedManagers = [],
    minimumWeeks = MINIMUM_COMPLETED_WEEKS
  } = options;
  const expected = [...new Set(expectedManagers.filter(Boolean))];
  const completedRows = (rows || []).filter(row => {
    const week = Number(row.week);
    return !row.isPlayoff
      && row.manager
      && Number.isFinite(week)
      && Number.isFinite(Number(row.points))
      && (currentWeek === null || week < currentWeek);
  }).map(row => ({ ...row, week: Number(row.week), points: Number(row.points) }));

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
    return { ready: false, reason, completedWeekCount: completedWeeks.length, records: [] };
  }

  const byWeek = new Map();
  for (const row of completedRows) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, []);
    byWeek.get(row.week).push(row);
  }

  const tally = new Map(managers.map(manager => [manager, { wins: 0, losses: 0, ties: 0, games: 0 }]));
  for (const weekRows of byWeek.values()) {
    for (const row of weekRows) {
      const entry = tally.get(row.manager);
      if (!entry) continue;
      entry.games += 1;
      for (const other of weekRows) {
        if (other === row) continue;
        if (row.points > other.points) entry.wins += 1;
        else if (row.points < other.points) entry.losses += 1;
        else entry.ties += 1;
      }
    }
  }

  const records = managers.map(manager => {
    const entry = tally.get(manager);
    const total = entry.wins + entry.losses + entry.ties;
    const winPct = total > 0 ? (entry.wins + entry.ties / 2) / total : 0;
    return {
      manager,
      games: entry.games,
      wins: entry.wins,
      losses: entry.losses,
      ties: entry.ties,
      winPct: Number(winPct.toFixed(3))
    };
  });

  return { ready: true, reason, completedWeekCount: completedWeeks.length, records };
}
