import { evaluateRosterFit, classifyWaiverDecision } from '../public/assets/waiver-model.js';
import { GENERAL_SETTINGS_2026 } from '../public/assets/league-settings.js';

/** Shared by live reports and offline recalculation; no I/O. */
export function createWaiverEvaluator({ fitContext, week, availabilityFor, ownershipRechecked, transactionsComplete }) {
  return (row, state = null) => {
    const rosterContext = fitContext && state ? { ...fitContext, ...state,
      protectedIds: new Set([...fitContext.protectedIds, ...state.protectedIds]) } : fitContext;
    const fit = rosterContext ? evaluateRosterFit({ marketRow: row, week, ...rosterContext }) : null;
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
    // A personal willingness-to-pay ceiling is not the cost of a free-agent add.
    const suggestedBid = decision.recommendedAction === "CLAIM_IF_CHEAP" ? personalMaxBid : 0;
    return {
      ...row,
      availability,
      modelMetrics: { playerId: row.sleeperId, targetWeek: week, marketScore: row.marketScore, faabMarket: row.faabMarket,
        immediateValue: decision.immediateValue, strategicUpside: decision.strategicUpside, decisionClass: decision.decisionClass,
        horizonWeeks: fit?.horizonWeeks ?? null, targetWeekDelta: fit?.targetWeekDelta ?? null,
        grossGainTotal: fit?.grossGainTotal ?? null, netGainTotal: fit?.netGainTotal ?? null,
        dropCostTotal: fit?.dropCostTotal ?? null, postRoleCutCostTotal: fit?.postRoleCutCostTotal ?? null,
        weeklyLineupDeltas: fit?.weeklyLineupDeltas ?? [], dropCandidate: fit?.dropCandidate ?? null,
        suggestedBid, personalMaxBid, availability, roleConfirmation: row.events.roleConfirmation },
      waiver: {
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
