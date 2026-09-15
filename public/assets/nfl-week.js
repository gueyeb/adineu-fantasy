export function resolveOperationalWeek(nflState = {}) {
  const week = Number(nflState.week);
  const displayWeek = Number(nflState.display_week);
  if (Number.isFinite(week) && week > 0) return week;
  if (Number.isFinite(displayWeek) && displayWeek > 0) return displayWeek;
  return 1;
}

export function resolveLastCompletedWeek(nflState = {}) {
  const operationalWeek = resolveOperationalWeek(nflState);
  return nflState.season_has_scores ? Math.max(1, operationalWeek - 1) : 0;
}
