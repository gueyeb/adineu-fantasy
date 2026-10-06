import { evaluateRosterFit, classifyWaiverDecision, LAST_REGULAR_WEEK } from '../public/assets/waiver-model.js';
import { GENERAL_SETTINGS_2026 } from '../public/assets/league-settings.js';
import { buildProjectedLineup } from '../public/assets/trade-score.js';

/** A vacant streaming slot is a weekly decision; the permanent cut is still priced by fit. */
export function evaluateStarterVacancyScenario({ row, rosterContext, week, rosFit }) {
  if (!rosterContext || !['QB', 'K', 'DEF'].includes(row.position)) return null;
  const active = rosterContext.myPlayers.filter(p => !rosterContext.reserveIds?.has(String(p.sleeperId)));
  const estimate = p => {
    const value = rosterContext.weeklyPaceOf ? rosterContext.weeklyPaceOf(p, week) : rosterContext.paceOf(p);
    return Number.isFinite(value) ? value : 0;
  };
  const before = buildProjectedLineup(active, { estimate, fixedSlots: rosterContext.frozenSlots || {} });
  if (!before.emptySlots.includes(row.position)) return null;
  const weeklyRow = { ...row, events: { ...row.events, roleWeeks: 1 } };
  const fit = evaluateRosterFit({ ...rosterContext, marketRow: weeklyRow, week });
  return { purpose: 'FILL_STARTER_SLOT', slot: row.position, startWeek: week, decisionHorizonWeeks: 1,
    roleDurationChanged: false, fit,
    rosFit: { horizonWeeks: rosFit?.horizonWeeks ?? null, horizonCovered: rosFit?.horizonCovered ?? false,
      netGainTotal: rosFit?.netGainTotal ?? null, coverageIssues: rosFit?.coverageIssues ?? [] } };
}

/** GAME_LOCKED blocks the target week only. The scenario below restarts the fit at the next
 * week, on that week's projections, and stays a review item: never an action, never a bid.
 * `horizonFor(row)` returns { startWeek, firstKickoffAt, bye, source } or null when the schedule
 * does not cover the next week. The unlock is verified only by dated operator evidence. */
export function evaluateNextUnlockScenario({ row, availability, rosterContext, week, horizonFor = () => null }) {
  if (availability?.availability !== "GAME_LOCKED") return null;
  const asOf = Date.parse(availability.availabilityAsOf);
  const processes = Date.parse(availability.waiverProcessesAt);
  const unlockVerified = Number.isFinite(processes) && Number.isFinite(asOf) && processes > asOf;
  const horizon = week + 1 <= LAST_REGULAR_WEEK ? horizonFor(row) : null;
  const base = { executableNow: false, reviewAction: "REVALIDATE_AT_UNLOCK", unlockVerified,
    unlockAt: unlockVerified ? availability.waiverProcessesAt : null, unlockSource: unlockVerified ? availability.evidence?.[0]?.source ?? null : null,
    startWeek: horizon?.startWeek ?? null, firstKickoffAt: horizon?.firstKickoffAt ?? null, byeAtStart: horizon?.bye ?? null,
    scheduleSource: horizon?.source ?? null, horizonWeeks: null, horizonCovered: false, coverageIssues: [], coverageBlockers: [],
    targetWeekDelta: null, grossGainTotal: null, netGainTotal: null, weeklyLineupDeltas: [], dropCandidate: null, cutSelection: null,
    indicativeMaxBid: null, indicativeMarketRange: row.faabMarket ?? null, marketRangeBasis: "CURRENT_WEEK_MARKET_ESTIMATE" };
  if (week + 1 > LAST_REGULAR_WEEK) return { ...base, status: "NO_REGULAR_SEASON_WEEK_LEFT" };
  if (!horizon) return { ...base, status: "HORIZON_UNKNOWN", coverageIssues: ["NEXT_WEEK_SCHEDULE_UNVERIFIED"] };
  if (!rosterContext) return { ...base, status: "NO_ROSTER_CONTEXT" };
  // The locked week consumes one week of a temporary role; nothing is extended beyond it.
  const remainingNow = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const roleWeeks = row.events?.roleWeeks > 0 ? row.events.roleWeeks : 0;
  const temporary = roleWeeks > 0 && roleWeeks < remainingNow;
  if (temporary && roleWeeks - (horizon.startWeek - week) <= 0) return { ...base, status: "ROLE_WINDOW_ENDS_BEFORE_UNLOCK", coverageIssues: ["NO_ROLE_WEEK_AFTER_UNLOCK"] };
  const futureRow = { ...row, events: { ...row.events, roleWeeks: temporary ? roleWeeks - (horizon.startWeek - week) : 0 } };
  const fit = evaluateRosterFit({ marketRow: futureRow, ...rosterContext, week: horizon.startWeek, frozenSlots: {}, lockedIds: new Set() });
  return { ...base, status: "EVALUATED", horizonWeeks: fit.horizonWeeks, horizonCovered: fit.horizonCovered,
    coverageIssues: [...fit.coverageIssues, ...(unlockVerified ? [] : ["UNLOCK_UNVERIFIED"])], coverageBlockers: fit.coverageBlockers,
    targetWeekDelta: fit.targetWeekDelta, grossGainTotal: fit.grossGainTotal, netGainTotal: fit.netGainTotal,
    weeklyLineupDeltas: fit.weeklyLineupDeltas, dropCandidate: fit.dropCandidate, cutSelection: fit.cutSelection,
    // Personal ceiling for that scenario, shown for planning only; the proposed bid stays 0.
    indicativeMaxBid: fit.horizonCovered && fit.legalTransaction ? fit.faabMaxForMe : null };
}

/** Shared by live reports and offline recalculation; no I/O. */
export function createWaiverEvaluator({ fitContext, week, availabilityFor, ownershipRechecked, transactionsComplete, horizonFor = () => null }) {
  return (row, state = null) => {
    const rosterContext = fitContext && state ? { ...fitContext, ...state,
      protectedIds: new Set([...fitContext.protectedIds, ...state.protectedIds]) } : fitContext;
    const rosFit = rosterContext ? evaluateRosterFit({ marketRow: row, week, ...rosterContext }) : null;
    const starterVacancyScenario = evaluateStarterVacancyScenario({ row, rosterContext, week, rosFit });
    const fit = starterVacancyScenario?.fit ?? rosFit;
    const positionWeight = ({ RB: 1.2, WR: 1.15, TE: 1, QB: 0.65, K: 0.45, DEF: 0.5 })[row.position] || 1;
    const durationWeight = ({ SEASON_LONG: 1.2, BREAKOUT: 1.15, SHORT_2_4W: 0.9, RENTAL_1W: 0.65, UNCERTAIN: 0.75 })[row.events.duration] || 0.85;
    const priorityScore = fit ? Math.round(Math.max(0, Math.min(100,
      18 * Math.max(0, fit.netGainPerWeek) * positionWeight +
      0.35 * row.marketScore * durationWeight * positionWeight
    ))) : null;
    const availability = availabilityFor(row);
    const decision = classifyWaiverDecision({
      availability,
      roleConfirmation: row.events.roleConfirmation,
      legalTransaction: (fit?.legalTransaction ?? false) && ownershipRechecked && transactionsComplete,
      horizonCovered: fit?.horizonCovered ?? false,
      targetWeekDelta: fit?.targetWeekDelta ?? null,
      position: row.position,
      marketScore: row.marketScore,
      flags: row.events.flags,
      usageSignal: row.usageSignal,
      netGain: fit?.selectionScore !== null && fit?.selectionScore !== undefined ? fit.selectionScore / fit.horizonWeeks : 0
    });
    const personalMaxBid = fit?.faabMaxForMe ?? null;
    if (decision.recommendedAction === "CLAIM_IF_CHEAP" && personalMaxBid === null) {
      decision.recommendedAction = "WATCH";
      decision.actionBlockers.push("UNKNOWN_FAAB_BALANCE");
      decision.interpretation = "Positive roster value; verify the FAAB balance before bidding.";
    }
    const nextUnlockScenario = evaluateNextUnlockScenario({ row, availability, rosterContext, week, horizonFor });
    if (availability?.availability === "GAME_LOCKED" && !decision.actionBlockers.includes("GAME_LOCKED")) decision.actionBlockers.push("GAME_LOCKED");
    if (availability?.coverageIssues?.includes("RECENT_DROP_CLEARANCE_UNVERIFIED")) decision.actionBlockers.push("RECENT_DROP_CLEARANCE_UNVERIFIED");
    if (row.valuationCovered === false) decision.actionBlockers.push("NO_PROJECTION");
    // Not an absolute ban: the cut is allowed as soon as the documented net gain pays for it.
    if (fit && ["NOT_JUSTIFIED", "UNPRICED"].includes(fit.progressionGuard)) {
      decision.actionBlockers.push(`PROGRESSION_SACRIFICE_${fit.progressionGuard}`);
      if (["ADD_NOW", "CLAIM_IF_CHEAP"].includes(decision.recommendedAction)) {
        decision.recommendedAction = "WATCH";
        decision.interpretation = "Rental gain does not document the cost of cutting an organically rising role.";
      }
    }
    // A personal willingness-to-pay ceiling is not the cost of a free-agent add.
    const suggestedBid = decision.recommendedAction === "CLAIM_IF_CHEAP" ? personalMaxBid : 0;
    return {
      ...row,
      availability,
      nextUnlockScenario,
      starterVacancyScenario,
      modelMetrics: { playerId: row.sleeperId, targetWeek: week, marketScore: row.marketScore, faabMarket: row.faabMarket,
        decisionHorizon: starterVacancyScenario ? 'TARGET_WEEK_SLOT_FILL' : 'ROLE_WINDOW',
        immediateValue: decision.immediateValue, strategicUpside: decision.strategicUpside, decisionClass: decision.decisionClass,
        horizonWeeks: fit?.horizonWeeks ?? null, targetWeekDelta: fit?.targetWeekDelta ?? null,
        grossGainTotal: fit?.grossGainTotal ?? null, netGainTotal: fit?.netGainTotal ?? null,
        dropCostTotal: fit?.dropCostTotal ?? null, postRoleCutCostTotal: fit?.postRoleCutCostTotal ?? null,
        weeklyLineupDeltas: fit?.weeklyLineupDeltas ?? [], dropCandidate: fit?.dropCandidate ?? null,
        suggestedBid, personalMaxBid, availability, roleConfirmation: row.events.roleConfirmation,
        cutSelection: fit?.cutSelection ?? null, dropCostComponents: fit?.dropCostComponents ?? null,
        poolEntryReasons: row.poolEntry?.reasons ?? [], nextUnlockScenario, starterVacancyScenario,
        roleProfile: row.roleProfile?.profile ?? null, progressionGuard: fit?.progressionGuard ?? null,
        progressionSacrificeTotal: fit?.progressionSacrificeTotal ?? null },
      waiver: {
        decisionHorizon: starterVacancyScenario ? 'TARGET_WEEK_SLOT_FILL' : 'ROLE_WINDOW',
        starterVacancyScenario,
        poolEntry: row.poolEntry ?? null,
        roleProfile: row.roleProfile ?? null,
        emergingRole: row.emergingRole ?? null,
        ripple: row.ripple ?? [],
        nextUnlockScenario,
        roleConfirmation: row.events.roleConfirmation,
        roleEvidence: row.events.evidence ?? [],
        announcedRole: row.events.announcedRole ?? null,
        suggestedBid,
        personalMaxBid,
        bidPctInitial: Number.isFinite(suggestedBid) ? Number((suggestedBid / GENERAL_SETTINGS_2026.waiver.budget * 100).toFixed(1)) : null,
        bidPctRemaining: rosterContext?.faabRemaining > 0 ? Number((suggestedBid / rosterContext.faabRemaining * 100).toFixed(1)) : null,
        marketMethod: "Projection window (ROS or labeled rank fallback), surplus over replacement × PRICE_PER_POINT; not observed rival bids",
        marketEstimate: row.marketEstimate,
        auctionWinProbability: null,
        score: row.marketScore,
        category: row.category,
        projectedPpg: row.weekProjection ?? row.rosPpg,
        rosPpg: row.rosPpg,
        rosSource: row.rosSource,
        recentPpg: row.signals.recentPpg,
        faabPct: row.faabPct,
        faabMarket: row.faabMarket,
        newsOverride: row.events.newsOverride,
        flags: row.events.flags,
        reasons: row.events.reasons,
        duration: row.events.duration,
        snapShare: row.signals.last?.snapShare ?? null,
        opportunities: row.signals.last?.opportunities ?? null,
        usageScore: row.usageScore,
        usageSignal: row.usageSignal,
        xfp: row.xfp,
        decision,
        ...(fit ? { fit: { ...fit, priorityScore } } : {})
      }
    };
  };
}
