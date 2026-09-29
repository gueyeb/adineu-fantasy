/**
 * Shared rest-of-season pace for Trade Finder and Waiver Wire.
 * Sleeper remains authoritative for the next two weeks. Later weeks are deliberately less
 * trusted: RB/WR/TE projections are blended 50/50 with the player's recent volume-based xFP.
 */
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026 } from "./league-settings.js";

export const DIRECT_PROJECTION_WEEKS = 2;
export const FAR_WEEK_USAGE_WEIGHT = 0.5;
const LAST_REGULAR_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;
const round = value => Number(value.toFixed(1));

export function usageAdjustedRosPpg({
  playerId,
  position,
  nflTeam,
  projectionsByWeek,
  week,
  xfp = null,
  directWeeks = DIRECT_PROJECTION_WEEKS,
  usageWeight = FAR_WEEK_USAGE_WEIGHT
}) {
  const values = [];
  let projectedNonBye = 0;
  let loadedNonBye = 0;
  let usageWeeks = 0;
  const canUseUsage = ["RB", "WR", "TE"].includes(position) && Number.isFinite(xfp) && xfp >= 0;

  for (let w = week; w <= LAST_REGULAR_WEEK; w += 1) {
    const projections = projectionsByWeek[w];
    if (!projections) continue;
    if (BYE_WEEKS_2026[nflTeam] === w) {
      values.push(0);
      continue;
    }
    loadedNonBye += 1;
    const projected = projections[playerId]?.pts_ppr;
    if (Number.isFinite(projected)) projectedNonBye += 1;
    const isFarWeek = w >= week + directWeeks;
    if (isFarWeek && canUseUsage) {
      const baseline = Number.isFinite(projected) ? projected : xfp;
      values.push((1 - usageWeight) * baseline + usageWeight * xfp);
      usageWeeks += 1;
    } else if (Number.isFinite(projected)) {
      values.push(projected);
    }
  }

  const enoughProjection = loadedNonBye > 0 && projectedNonBye >= loadedNonBye / 2;
  if (!values.length || (!enoughProjection && !usageWeeks)) return null;
  return {
    ppg: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    source: usageWeeks ? "SLEEPER_USAGE_BLEND" : "SLEEPER_PROJECTIONS",
    usageWeeks,
    loadedWeeks: values.length
  };
}
