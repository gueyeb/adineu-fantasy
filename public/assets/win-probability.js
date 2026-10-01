/**
 * Adineu Fantasy — pregame win estimate shared by the Game Center (matchups-live.js) and the
 * Weekly Recap (weekly-recap.js). Its own module so neither imports the other (that cycle used to
 * load two copies of matchups-live.js). Logistic on the projected-points gap, bounded to 5–95 %:
 * an Adineu estimate, never an official number.
 */
export function estimatePregameWinProbability(projectionA, projectionB) {
  if (!Number.isFinite(projectionA) || !Number.isFinite(projectionB)
    || projectionA <= 0 || projectionB <= 0) return null;
  const probabilityA = 100 / (1 + Math.exp((projectionB - projectionA) / 18));
  const boundedA = Math.min(95, Math.max(5, probabilityA));
  return {
    teamA: Number(boundedA.toFixed(1)),
    teamB: Number((100 - boundedA).toFixed(1))
  };
}
