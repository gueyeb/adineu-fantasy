const actionable = new Set(["ADD_NOW", "CLAIM_IF_CHEAP"]);

/** Greedy, conditional review plan. Recalculate each marginal gain on the assumed new roster.
 * It submits nothing and never estimates auction success. Every reserved bid may be spent. */
export function buildAcquisitionPlan({ candidates, myPlayers, faabRemaining, evaluateCandidate, rosterCapacity = myPlayers.length, maxAcquisitions = 3 }) {
  const budgetKnown = Number.isFinite(faabRemaining) && faabRemaining >= 0;
  const initialBudget = budgetKnown ? Math.floor(faabRemaining) : null;
  let remainingBudget = initialBudget;
  let players = [...myPlayers];
  const committedIds = new Set();
  const steps = [];
  const conflicts = [];
  const usedCuts = new Set();
  const initialEvaluations = candidates.map(candidate => evaluateCandidate(candidate, { myPlayers: players, faabRemaining: remainingBudget, protectedIds: committedIds, hasOpenRosterSlot: players.length < rosterCapacity }));
  const cuts = new Map();
  for (const row of initialEvaluations) {
    const id = row.waiver?.fit?.dropCandidate?.sleeperId;
    if (!id || !actionable.has(row.waiver?.decision?.recommendedAction)) continue;
    if (!cuts.has(String(id))) cuts.set(String(id), []);
    cuts.get(String(id)).push(String(row.sleeperId));
  }
  for (const [dropPlayerId, playerIds] of cuts) if (playerIds.length > 1) conflicts.push({ dropPlayerId, playerIds });
  for (let index = 0; index < maxAcquisitions; index++) {
    const evaluated = candidates.filter(row => !committedIds.has(String(row.sleeperId)))
      .map(candidate => evaluateCandidate(candidate, { myPlayers: players, faabRemaining: remainingBudget, protectedIds: committedIds, hasOpenRosterSlot: players.length < rosterCapacity }))
      .filter(row => actionable.has(row.waiver?.decision?.recommendedAction) && row.waiver.fit?.legalTransaction &&
        row.waiver.fit.horizonCovered && (row.waiver.fit.selectionScore ?? row.waiver.fit.netGainTotal) > 0 && row.availability?.canStartTargetWeek === true &&
        (row.waiver.decision.recommendedAction === "ADD_NOW" ? row.availability.canAddNow === true : row.availability.availability === "WAIVER_LOCKED" && Number.isFinite(Date.parse(row.availability.waiverProcessesAt))) &&
        Number.isInteger(row.waiver.suggestedBid) && row.waiver.suggestedBid >= 0 &&
        (budgetKnown ? row.waiver.suggestedBid <= remainingBudget : row.waiver.decision.recommendedAction === "ADD_NOW" && row.waiver.suggestedBid === 0) &&
        (row.waiver.decision.recommendedAction !== "ADD_NOW" || row.waiver.suggestedBid === 0) &&
        (!row.waiver.fit.dropCandidate || !usedCuts.has(String(row.waiver.fit.dropCandidate.sleeperId))))
      .sort((a, b) => {
        const time = row => row.waiver.decision.recommendedAction === "ADD_NOW" ? 0 : Date.parse(row.availability?.waiverProcessesAt) || Infinity;
        return time(a) - time(b) || (b.waiver.fit.selectionScore ?? b.waiver.fit.netGainTotal) - (a.waiver.fit.selectionScore ?? a.waiver.fit.netGainTotal) || String(a.sleeperId).localeCompare(String(b.sleeperId));
      });
    const chosen = evaluated[0];
    if (!chosen) break;
    const fit = chosen.waiver.fit;
    const cutId = fit.dropCandidate?.sleeperId;
    if (cutId && !players.some(p => String(p.sleeperId) === String(cutId))) break;
    const bid = Math.floor(chosen.waiver.suggestedBid);
    const dependsOnPlayerIds = steps.map(step => step.playerId);
    steps.push({ playerId: String(chosen.sleeperId), name: chosen.name, position: chosen.position,
      roleConfirmation: chosen.waiver.roleConfirmation ?? "NOT_APPLICABLE",
      recommendedAction: chosen.waiver.decision.recommendedAction, dropCandidate: fit.dropCandidate,
      suggestedBid: bid, personalMaxBid: chosen.waiver.personalMaxBid, budgetBefore: remainingBudget, budgetAfter: budgetKnown ? remainingBudget - bid : null,
      targetWeekDelta: fit.targetWeekDelta, netGainTotal: fit.netGainTotal, horizonWeeks: fit.horizonWeeks,
      preferencePenaltyTotal: fit.preferencePenaltyTotal ?? 0, preferenceOverridden: fit.preferenceOverridden ?? false, appliedPreference: fit.appliedPreference ?? null, dependsOnPlayerIds, assumesPriorWins: true,
      weeklyLineupDeltas: fit.weeklyLineupDeltas, availability: chosen.availability });
    if (cutId) usedCuts.add(String(cutId));
    const startWeek = fit.weeklyLineupDeltas[0]?.week;
    const plannedRoleWindow = Number.isInteger(startWeek) && Number.isFinite(fit.horizonWeeks)
      ? { startWeek, endWeekExclusive: startWeek + fit.horizonWeeks } : null;
    players = [...players.filter(p => !cutId || String(p.sleeperId) !== String(cutId)), { ...chosen, plannedRoleWindow }];
    committedIds.add(String(chosen.sleeperId));
    if (budgetKnown) remainingBudget -= bid;
  }
  return { steps, conflicts, initialFaab: initialBudget, reservedFaab: budgetKnown ? initialBudget - remainingBudget : 0,
    budgetKnown, budgetIssues: budgetKnown ? [] : ["UNKNOWN_FAAB_BALANCE"],
    remainingFaab: remainingBudget, algorithm: "GREEDY_MARGINAL_GAIN", optimalityGuaranteed: false,
    conditional: true, executionMode: "REVALIDATE_AFTER_EACH_RESULT", auctionWinProbability: null };
}
