/**
 * Adineu Fantasy — Record Watch: compares a manager's live 2026 numbers to the Yahoo-era
 * (2019-2025) record book (public/assets/record-book.js). Pure comparison logic only — no I/O,
 * no rendering. Always a raw gap ("14.3 pts from the record"), never a fabricated percentage or
 * "odds of breaking it" — same anti-fabrication discipline as Power Rankings / All-Play.
 */

/**
 * The highest single-week score a manager has actually posted this season, from completed
 * (non-playoff, non-live-week) rows only — a live/in-progress score isn't final, so it doesn't
 * get compared against a historical record yet.
 */
export function highestCompletedScore(matchupRows, manager, currentWeek) {
  return (matchupRows || [])
    .filter(row => row.manager === manager
      && !row.isPlayoff
      && Number.isFinite(Number(row.points))
      && (currentWeek === null || Number(row.week) < currentWeek))
    .reduce((max, row) => Math.max(max, Number(row.points)), 0);
}

function watchEntry(label, recordValue, holder, liveValue) {
  if (!Number.isFinite(recordValue) || !Number.isFinite(liveValue)) return null;
  return {
    label,
    recordValue,
    holder,
    liveValue,
    broken: liveValue > recordValue,
    gap: Math.abs(recordValue - liveValue)
  };
}

/**
 * Builds the Record Watch panel's entries. Any input that's missing or not ready (record book
 * failed to load, season points record unavailable, etc.) is simply skipped — never a fabricated
 * placeholder row.
 */
export function buildRecordWatchEntries({ recordBook, seasonPointsRecord, liveHighScore, liveStreakWins, livePointsFor }) {
  const entries = [];
  if (recordBook?.highScore) {
    entries.push(watchEntry(
      "Score le plus haut sur un match",
      recordBook.highScore.points,
      `${recordBook.highScore.manager} · ${recordBook.highScore.year} S${recordBook.highScore.week}`,
      liveHighScore
    ));
  }
  if (recordBook?.topStreaks?.[0]) {
    entries.push(watchEntry(
      "Plus longue série de victoires",
      recordBook.topStreaks[0].wins,
      `${recordBook.topStreaks[0].manager} · ${recordBook.topStreaks[0].year}`,
      liveStreakWins
    ));
  }
  if (seasonPointsRecord) {
    entries.push(watchEntry(
      "Points marqués sur une saison",
      seasonPointsRecord.pf,
      `${seasonPointsRecord.team} · ${seasonPointsRecord.year}`,
      livePointsFor
    ));
  }
  return entries.filter(Boolean);
}
