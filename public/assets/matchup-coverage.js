/** Slot denominator comes from league requirements, never from loaded player count. */
export function summarizeMatchupCoverage({ starters = [], requiredSlots = 9, projections = {}, actualPoints = {}, gameStateOf = () => "UNKNOWN" }) {
  let projectedTotal = 0;
  let pointsAcquired = 0;
  let projectionsRemaining = 0;
  const slots = Array.from({ length: requiredSlots }, (_, index) => {
    const playerId = starters[index] && starters[index] !== "0" ? String(starters[index]) : null;
    if (!playerId) return { index, playerId: null, status: "EMPTY", projection: null, actual: null };
    const projection = Number.isFinite(projections[playerId]?.pts_ppr) ? projections[playerId].pts_ppr : null;
    const actual = Number.isFinite(actualPoints[playerId]) ? actualPoints[playerId] : null;
    const gameState = gameStateOf(playerId);
    if (projection !== null) projectedTotal += projection;
    if (["FINAL", "LIVE"].includes(gameState) && actual !== null) pointsAcquired += actual;
    if (gameState === "PREGAME" && projection !== null) projectionsRemaining += projection;
    return { index, playerId, status: gameState, projection, actual };
  });
  const covered = slots.filter(slot => slot.status === "FINAL" ? slot.actual !== null : slot.playerId && slot.projection !== null).length;
  const mixedCovered = slots.every(slot => slot.status === "FINAL" ? slot.actual !== null : slot.status === "PREGAME" && slot.projection !== null);
  const round = value => Number(value.toFixed(1));
  return { total: slots.some(slot => slot.projection !== null) ? round(projectedTotal) : null,
    totalKind: "PREGAME_PROJECTIONS", coverage: `${covered}/${requiredSlots}`,
    emptySlots: slots.filter(slot => slot.status === "EMPTY").length,
    missingProjections: slots.filter(slot => slot.playerId && slot.status !== "FINAL" && slot.projection === null).length,
    lockedWithActual: slots.filter(slot => ["FINAL", "LIVE"].includes(slot.status) && slot.actual !== null).length,
    pointsAcquired: round(pointsAcquired), projectionsRemaining: round(projectionsRemaining),
    mixedTotal: mixedCovered ? round(pointsAcquired + projectionsRemaining) : null,
    mixedTotalKind: "ACTUAL_PLUS_NOT_STARTED_PROJECTIONS", mixedCoverageComplete: mixedCovered, slots };
}
