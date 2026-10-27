/** A week boundary alone does not prove that the stored results were published. */
export function completedWeekCoverage(rows, { currentWeek = null, expectedManagers = [], requireOpponent = false } = {}) {
  const eligible = (rows || []).filter(row => !row.isPlayoff && Number.isInteger(Number(row.week)) && Number(row.week) >= 1 && (currentWeek === null || Number(row.week) < currentWeek));
  const managers = expectedManagers.length ? [...new Set(expectedManagers)] : [...new Set(eligible.map(row => row.manager).filter(Boolean))];
  const weeks = [...new Set(eligible.map(row => Number(row.week)))].sort((a, b) => a - b);
  const end = Number.isInteger(currentWeek) ? currentWeek - 1 : weeks.at(-1) || 0;
  const validWeeks = [];
  const issues = [];
  const numeric = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  for (let week = 1; week <= end; week++) {
    const batch = eligible.filter(row => Number(row.week) === week);
    if (batch.length !== managers.length || managers.some(manager => batch.filter(row => row.manager === manager).length !== 1) ||
        batch.some(row => !numeric(row.points) || (requireOpponent && !numeric(row.opponentPoints)))) {
      issues.push({ week, reason: "incomplete_coverage" });
    } else if (batch.length && batch.every(row => Number(row.points) === 0) && !batch.every(row => row.completed === true)) {
      // Preserve real individual zeroes and ties. All-zero league weeks need explicit completion evidence.
      issues.push({ week, reason: "score_completion_unverified" });
    } else if (batch.length) validWeeks.push(week);
  }
  return { validWeeks, issues, reason: issues.find(issue => issue.reason === "score_completion_unverified")?.reason || issues[0]?.reason || null };
}
