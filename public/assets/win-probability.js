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

const parisTime = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
};

/**
 * How a frozen pregame estimate may sit next to scores. `started`: true once a starter's game began,
 * false when verified not begun, null when unverified. Only `false` shows a percentage, labeled as
 * frozen with its read time and basis — never presented as a live probability.
 */
export function pregameEstimatePresentation({ chances = null, started = null, readAt = null } = {}) {
  if (started === true) return { show: false, reason: "STARTED", note: "Estimation avant match retirée : des matchs ont commencé ; aucun pourcentage live calculé." };
  if (started !== false) return { show: false, reason: "START_UNVERIFIED", note: "Estimation avant match masquée : début des matchs NFL non vérifié (voir l’onglet Live)." };
  if (!chances) return { show: false, reason: "NO_ESTIMATE", note: null };
  const time = parisTime(readAt);
  return { show: true, reason: null, teamA: chances.teamA, teamB: chances.teamB,
    label: `Estimation avant match (figée) · ${chances.teamA} % / ${chances.teamB} %`,
    basis: `Projections Sleeper lues ${time ? `le ${time} (Paris)` : "à une heure non indiquée"} ; écart projeté, borné 5–95 %. Pas une probabilité live : retirée au premier coup d’envoi.` };
}
