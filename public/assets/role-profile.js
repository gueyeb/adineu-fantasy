/**
 * Adineu Fantasy — role profile and emerging-role option (docs/decision-engine-live-state-backlog-2026-10-05.md, P1).
 *
 * Pure functions. The profile says *why* a role exists; it is a third dimension next to
 * DecisionClass (what to do) and the confirmed horizon (how long). Nothing here confirms a role.
 * Thresholds are review triggers, never calibrated weights: they wait for the P2 evaluation.
 */
export const ROLE_PROFILES = ["PURE_RENTAL", "INJURY_PROMOTION_WITH_EXISTING_ROLE", "ROLE_EXPANSION", "BREAKOUT", "UNCERTAIN"];
export const ROLE_PROFILE_THRESHOLDS = { existingSnapShare: 0.3, existingOpportunities: 5, risingXfpDelta: 1, expansionRises: 2, calibrated: false };

const round = (value, digits = 1) => Number(value.toFixed(digits));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const delta = (last, previous) => Number.isFinite(last) && Number.isFinite(previous) ? last - previous : null;

/** Dated, comparable trends of one player over completed weeks (oldest -> newest).
 * `series` comes from buildOpportunitySignals; `xfpByWeek` from the usage model ({ week: points }).
 * Routes are not published by the source: they stay null, snaps are never used as a proxy.
 * `absenceTriggers` are the team/position ripple entries: a rise that coincides with a teammate's
 * absence cannot be called organic. */
export function buildEmergingRole({ series = [], xfpByWeek = {}, absenceTriggers = [] } = {}) {
  const played = series.filter(week => week.played);
  const last = played.at(-1) ?? null;
  const previous = played.slice(0, -1);
  const xfpOf = week => Number.isFinite(xfpByWeek?.[week?.week]) ? xfpByWeek[week.week] : null;
  const base = { weeksCompared: played.map(week => week.week), comparable: played.length >= 2,
    snapShareDelta: null, targetsDelta: null, opportunitiesDelta: null, xfpDelta: null,
    routesDelta: null, routesSource: null, consecutiveRises: 0, progression: "INSUFFICIENT_DATA",
    progressionSource: null, optionValuePerWeek: null, basis: "XFP_TREND_LAST_VS_PREVIOUS_WEEKS", calibrated: false };
  if (!base.comparable) return base;
  const previousMean = pick => mean(previous.map(pick).filter(Number.isFinite));
  const snapShareDelta = delta(last.snapShare, previousMean(week => week.snapShare));
  const targetsDelta = delta(last.targets, previousMean(week => week.targets));
  const opportunitiesDelta = delta(last.opportunities, previousMean(week => week.opportunities));
  const xfpDelta = delta(xfpOf(last), previousMean(xfpOf));
  // Week-over-week rises of expected points, counted back from the last game.
  let consecutiveRises = 0;
  for (let i = played.length - 1; i > 0; i--) {
    const step = delta(xfpOf(played[i]), xfpOf(played[i - 1]));
    if (!(step > 0)) break;
    consecutiveRises++;
  }
  const volumeUp = (opportunitiesDelta ?? 0) > 0 || (snapShareDelta ?? 0) > 0;
  const progression = xfpDelta === null ? "INSUFFICIENT_DATA"
    : xfpDelta >= ROLE_PROFILE_THRESHOLDS.risingXfpDelta && volumeUp ? "RISING"
    : xfpDelta <= -ROLE_PROFILE_THRESHOLDS.risingXfpDelta ? "FALLING" : "STABLE";
  const coincides = absenceTriggers.some(row => row.trigger === "SNAPSHOT_STATUS" || row.type === "INJURY");
  return { ...base,
    snapShareDelta: snapShareDelta === null ? null : round(snapShareDelta, 3), targetsDelta: targetsDelta === null ? null : round(targetsDelta),
    opportunitiesDelta: opportunitiesDelta === null ? null : round(opportunitiesDelta), xfpDelta: xfpDelta === null ? null : round(xfpDelta),
    consecutiveRises, progression,
    progressionSource: progression !== "RISING" ? null : coincides ? "COINCIDES_WITH_TEAMMATE_ABSENCE" : "ORGANIC",
    // Expected points gained by the trend and not yet in a projection; 0 unless rising.
    optionValuePerWeek: progression === "INSUFFICIENT_DATA" ? null : progression === "RISING" ? round(Math.max(0, xfpDelta)) : 0 };
}

/** Why the role exists. Returns { profile, basis, thresholds } with profile null when no role story applies. */
export function classifyRoleProfile({ flags = [], signals = {}, emergingRole = null } = {}) {
  const basis = [];
  const done = profile => ({ profile, basis, thresholds: ROLE_PROFILE_THRESHOLDS, calibrated: false });
  const surge = flags.some(flag => ["SNAP_SURGE", "USAGE_SURGE"].includes(flag));
  if (flags.includes("PROMOTION")) {
    const hasBaseline = (signals.gamesPlayed ?? 0) >= 2 && (Number.isFinite(signals.prevSnapShare) || Number.isFinite(signals.prevOpportunities));
    if (!hasBaseline) { basis.push("NO_USAGE_BASELINE_BEFORE_ABSENCE"); return done("UNCERTAIN"); }
    const existing = (signals.prevSnapShare ?? 0) >= ROLE_PROFILE_THRESHOLDS.existingSnapShare ||
      (signals.prevOpportunities ?? 0) >= ROLE_PROFILE_THRESHOLDS.existingOpportunities;
    basis.push(existing ? "ROLE_BEFORE_ABSENCE" : "NO_ROLE_BEFORE_ABSENCE");
    return done(existing ? "INJURY_PROMOTION_WITH_EXISTING_ROLE" : "PURE_RENTAL");
  }
  const rising = emergingRole?.progression === "RISING";
  if (rising && emergingRole.progressionSource !== "ORGANIC") {
    basis.push("RISE_COINCIDES_WITH_TEAMMATE_ABSENCE");
    return done("UNCERTAIN");
  }
  if (rising && emergingRole.consecutiveRises >= ROLE_PROFILE_THRESHOLDS.expansionRises) {
    basis.push(`XFP_RISING_${emergingRole.consecutiveRises}_WEEKS`);
    return done("ROLE_EXPANSION");
  }
  if (surge || rising) {
    basis.push(surge ? "SINGLE_WEEK_SURGE" : "SINGLE_WEEK_XFP_RISE");
    return done("BREAKOUT");
  }
  return done(null);
}
