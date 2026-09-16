/**
 * Adineu Fantasy — small per-team metrics read straight off the Sleeper roster object
 * (settings.waiver_budget_used, metadata.streak). No fetch here — pure formatting only.
 */

/** FAAB dollars still available, given the league's total budget and Sleeper's `waiver_budget_used`. */
export function calculateFaabRemaining(totalBudget, budgetUsed) {
  const total = Number(totalBudget);
  const used = Number(budgetUsed ?? 0);
  if (!Number.isFinite(total)) return null;
  const remaining = total - (Number.isFinite(used) ? used : 0);
  return Math.max(0, remaining);
}

/** Turns Sleeper's roster.metadata.streak ("3W", "1L") into a French label, or null if absent/malformed. */
export function formatStreak(streak) {
  if (typeof streak !== "string") return null;
  const match = streak.match(/^(\d+)([WL])$/);
  if (!match) return null;
  const count = Number(match[1]);
  if (count === 0) return null;
  return match[2] === "W"
    ? `${count} victoire${count > 1 ? "s" : ""} de suite`
    : `${count} défaite${count > 1 ? "s" : ""} de suite`;
}

/** Numeric length of a current WIN streak ("3W" -> 3), or 0 if not currently on one (including "2L"). */
export function streakWinCount(streak) {
  if (typeof streak !== "string") return 0;
  const match = streak.match(/^(\d+)W$/);
  return match ? Number(match[1]) : 0;
}
