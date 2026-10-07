const actionable = new Set(["ADD_NOW", "CLAIM_IF_CHEAP"]);

/** Greedy, conditional review plan. Recalculate each marginal gain on the assumed new roster.
 * It submits nothing and never estimates auction success. Every reserved bid may be spent. */
function runGreedyPlan({ candidates, myPlayers, faabRemaining, evaluateCandidate, rosterCapacity = myPlayers.length, maxAcquisitions = 3 }, { initialState = null, bannedIds = new Set(), forcedFirstPlayerId = null } = {}) {
  const budgetKnown = Number.isFinite(faabRemaining) && faabRemaining >= 0;
  const initialBudget = budgetKnown ? Math.floor(faabRemaining) : null;
  let remainingBudget = initialState ? initialState.remainingBudget : initialBudget;
  let players = [...(initialState?.players ?? myPlayers)];
  const committedIds = new Set(initialState?.committedIds ?? []);
  const steps = [...(initialState?.steps ?? [])];
  const stages = [];
  let forcedChoiceApplied = forcedFirstPlayerId === null;
  const conflicts = [];
  const usedCuts = new Set(initialState?.usedCuts ?? []);
  const initialEvaluations = candidates.map(candidate => evaluateCandidate(candidate, { myPlayers: players, faabRemaining: remainingBudget, protectedIds: committedIds, hasOpenRosterSlot: players.length < rosterCapacity }));
  const cuts = new Map();
  for (const row of initialEvaluations) {
    const id = row.waiver?.fit?.dropCandidate?.sleeperId;
    if (!id || !actionable.has(row.waiver?.decision?.recommendedAction)) continue;
    if (!cuts.has(String(id))) cuts.set(String(id), []);
    cuts.get(String(id)).push(String(row.sleeperId));
  }
  for (const [dropPlayerId, playerIds] of cuts) if (playerIds.length > 1) conflicts.push({ dropPlayerId, playerIds });
  for (let index = steps.length; index < maxAcquisitions; index++) {
    const evaluated = candidates.filter(row => !committedIds.has(String(row.sleeperId)) && !bannedIds.has(String(row.sleeperId)))
      .map(candidate => evaluateCandidate(candidate, { myPlayers: players, faabRemaining: remainingBudget, protectedIds: committedIds, hasOpenRosterSlot: players.length < rosterCapacity }))
      .filter(row => actionable.has(row.waiver?.decision?.recommendedAction) && row.waiver.fit?.legalTransaction &&
        row.waiver.fit.horizonCovered && (row.waiver.fit.selectionScore ?? row.waiver.fit.netGainTotal) > 0 && row.availability?.canStartTargetWeek === true &&
        (row.waiver.decision.recommendedAction === "ADD_NOW" ? row.availability.canAddNow === true : row.availability.availability === "WAIVER_LOCKED" && Number.isFinite(Date.parse(row.availability.waiverProcessesAt))) &&
        Number.isInteger(row.waiver.suggestedBid) && row.waiver.suggestedBid >= 0 &&
        (budgetKnown ? row.waiver.suggestedBid <= remainingBudget : row.waiver.decision.recommendedAction === "ADD_NOW" && row.waiver.suggestedBid === 0) &&
        (row.waiver.decision.recommendedAction !== "ADD_NOW" || row.waiver.suggestedBid === 0) &&
        (!row.waiver.fit.dropCandidate || (!usedCuts.has(String(row.waiver.fit.dropCandidate.sleeperId)) && !committedIds.has(String(row.waiver.fit.dropCandidate.sleeperId)) && players.some(player => String(player.sleeperId) === String(row.waiver.fit.dropCandidate.sleeperId)))))
      .sort((a, b) => {
        const time = row => row.waiver.decision.recommendedAction === "ADD_NOW" ? 0 : Date.parse(row.availability?.waiverProcessesAt) || Infinity;
        return time(a) - time(b) || Number(Boolean(b.starterVacancyScenario)) - Number(Boolean(a.starterVacancyScenario)) ||
          (b.waiver.fit.selectionScore ?? b.waiver.fit.netGainTotal) - (a.waiver.fit.selectionScore ?? a.waiver.fit.netGainTotal) || String(a.sleeperId).localeCompare(String(b.sleeperId));
      });
    const chosen = forcedFirstPlayerId === null ? evaluated[0] : evaluated.find(row => String(row.sleeperId) === forcedFirstPlayerId);
    if (forcedFirstPlayerId !== null && chosen) forcedChoiceApplied = true;
    forcedFirstPlayerId = null;
    if (!chosen) break;
    stages.push({ chosen, evaluated, state: { remainingBudget, players: [...players], committedIds: new Set(committedIds),
      usedCuts: new Set(usedCuts), steps: [...steps] } });
    const fit = chosen.waiver.fit;
    const cutId = fit.dropCandidate?.sleeperId;
    if (cutId && !players.some(p => String(p.sleeperId) === String(cutId))) break;
    const bid = Math.floor(chosen.waiver.suggestedBid);
    const dependsOnPlayerIds = steps.map(step => step.playerId);
    steps.push({ playerId: String(chosen.sleeperId), name: chosen.name, position: chosen.position,
      teRosterUtility: chosen.teRosterUtility ?? null,
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
  const plan = { steps, conflicts, initialFaab: initialBudget, reservedFaab: budgetKnown ? initialBudget - remainingBudget : 0,
    budgetKnown, budgetIssues: budgetKnown ? [] : ["UNKNOWN_FAAB_BALANCE"],
    remainingFaab: remainingBudget, algorithm: "GREEDY_MARGINAL_GAIN", optimalityGuaranteed: false,
    conditional: true, executionMode: "REVALIDATE_AFTER_EACH_RESULT", auctionWinProbability: null };
  return { plan, stages, players, forcedChoiceApplied };
}


const resourceOf = row => String(row.waiver.fit.dropCandidate?.sleeperId ?? 'OPEN_ROSTER_SLOT');
const processTime = row => Date.parse(row.availability.waiverProcessesAt);
const groupKey = row => JSON.stringify([resourceOf(row), processTime(row)]);
const claimView = row => ({ teRosterUtility: row.teRosterUtility ?? null, playerId: String(row.sleeperId), name: row.name, position: row.position,
  recommendedAction: row.waiver.decision.recommendedAction, decisionClass: row.waiver.decision.decisionClass ?? null,
  suggestedBid: row.waiver.suggestedBid, personalMaxBid: row.waiver.personalMaxBid,
  targetWeekDelta: row.waiver.fit.targetWeekDelta, netGainTotal: row.waiver.fit.netGainTotal,
  horizonWeeks: row.waiver.fit.horizonWeeks, dropCandidate: row.waiver.fit.dropCandidate,
  selectionScore: row.waiver.fit.selectionScore ?? row.waiver.fit.netGainTotal, availability: row.availability,
  roleConfirmation: row.waiver.roleConfirmation ?? 'NOT_APPLICABLE' });

/** Review branches, not platform submissions. The primary winning path keeps its greedy semantics.
 * Only alternatives absent from that path compete for the same cut/open spot at the same processing time.
 * Each winner/failure branch is recalculated; ordinary later steps still assume success. */
/** Candidates the plan considers per position: fixed, so a display limit never changes the plan. */
export const PLAN_CANDIDATES_PER_POSITION = 15;
export function selectPlanCandidates(marketRows, perPosition = PLAN_CANDIDATES_PER_POSITION) {
  const counts = {};
  return marketRows.filter(row => {
    counts[row.position] = (counts[row.position] || 0) + 1;
    return counts[row.position] <= perPosition || row.poolEntry?.pinned;
  });
}
/** Every player the plan names, steps and alternative claims included. */
export function planPlayerIds(plan) {
  const ids = new Set();
  JSON.stringify(plan ?? null, (key, value) => { if (key === "playerId" && value != null) ids.add(String(value)); return value; });
  return ids;
}

export function buildAcquisitionPlan(options) {
  const primary = runGreedyPlan(options);
  const maxScenarios = 16;
  const maxFallbacks = 2;
  const groups = [];
  const alternativeClaimGroups = [];
  const scenarios = [];
  let truncated = false;
  let evaluationChanged = false;
  let omittedFallbacks = 0;
  let primaryScenarioId = null;
  function explore(result, outcomes = [], resolved = new Set(), bannedIds = new Set(), primaryPath = true) {
    if (scenarios.length >= maxScenarios) { truncated = true; return; }
    const selectedIds = new Set(result.plan.steps.map(step => step.playerId));
    let selectedStage = null;
    let fallbackRows = [];
    for (const stage of result.stages) {
      if (stage.chosen.waiver.decision.recommendedAction !== 'CLAIM_IF_CHEAP' || resolved.has(groupKey(stage.chosen))) continue;
      const alternatives = stage.evaluated.filter(row => row.waiver.decision.recommendedAction === 'CLAIM_IF_CHEAP' &&
        !selectedIds.has(String(row.sleeperId)) && groupKey(row) === groupKey(stage.chosen));
      if (alternatives.length) { selectedStage = stage; fallbackRows = alternatives; break; }
    }
    if (!selectedStage) {
      const scenarioId = `scenario-${scenarios.length + 1}`;
      if (primaryPath) primaryScenarioId = scenarioId;
      scenarios.push({ scenarioId, outcomes, steps: result.plan.steps, reservedFaab: result.plan.reservedFaab,
        remainingFaab: result.plan.remainingFaab, endingRosterPlayerIds: result.players.map(player => String(player.sleeperId)),
        executionMode: 'REVALIDATE_AFTER_EACH_RESULT', assumesOtherClaimsWin: true });
      return;
    }
    const stage = selectedStage;
    const claimRows = [stage.chosen, ...fallbackRows.slice(0, maxFallbacks)];
    const groupId = `claim-group-${groups.length + 1}`;
    const group = { groupId, primaryPlayerId: String(stage.chosen.sleeperId),
      waiverProcessesAt: new Date(processTime(stage.chosen)).toISOString(), resource: resourceOf(stage.chosen),
      dropCandidate: stage.chosen.waiver.fit.dropCandidate ?? null, claims: claimRows.map(claimView),
      maximumBid: Math.max(...claimRows.map(row => row.waiver.suggestedBid)), budgetBefore: stage.state.remainingBudget,
      dependsOnPlayerIds: stage.state.steps.map(step => step.playerId), dependsOnOutcomes: outcomes,
      rosterBeforePlayerIds: stage.state.players.map(player => String(player.sleeperId)),
      ordering: 'EXECUTION_TIME_THEN_VACANCY_THEN_MARGINAL_UTILITY',
      omittedFallbackCount: Math.max(0, fallbackRows.length - maxFallbacks),
      failureReasons: ['OUTBID', 'CLAIM_REJECTED', 'PLAYER_UNAVAILABLE', 'CLAIM_SKIPPED'],
      actualFailureReason: null, reviewOnly: true, platformCancellationVerified: false };
    groups.push(group);
    if (primaryPath) alternativeClaimGroups.push(group);
    omittedFallbacks += group.omittedFallbackCount;
    const resolvedNext = new Set([...resolved, groupKey(stage.chosen)]);
    const allAlternativeIds = [stage.chosen, ...fallbackRows].map(row => String(row.sleeperId));
    for (let choice = 0; choice <= claimRows.length; choice++) {
      if (scenarios.length >= maxScenarios) { truncated = true; break; }
      const winner = claimRows[choice] ?? null;
      const winnerPlayerId = winner ? String(winner.sleeperId) : null;
      const nextBanned = new Set([...bannedIds, ...allAlternativeIds.filter(id => id !== winnerPlayerId)]);
      const earlierClaimFailures = claimRows.slice(0, choice).map(row => String(row.sleeperId));
      const outcome = { groupId, winnerPlayerId, earlierClaimFailures, failureReason: earlierClaimFailures.length ? 'UNKNOWN_UNTIL_PLATFORM_RESULT' : null,
        notAttemptedPlayerIds: winner ? claimRows.slice(choice + 1).map(row => String(row.sleeperId)) : [], assumed: true };
      const next = runGreedyPlan(options, { initialState: stage.state, bannedIds: nextBanned, forcedFirstPlayerId: winnerPlayerId });
      if (winner && !next.forcedChoiceApplied) { evaluationChanged = true; continue; }
      explore(next, [...outcomes, outcome], resolvedNext, nextBanned, primaryPath && choice === 0);
    }
  }
  explore(primary);
  const budgetKnown = primary.plan.budgetKnown;
  const complete = !truncated && !evaluationChanged;
  const evaluatedScenarioMaxFaab = Math.max(0, ...scenarios.map(scenario => scenario.reservedFaab));
  return { ...primary.plan, alternativeClaimGroups, claimPortfolio: {
    primaryScenarioId, groups, scenarios, coverage: complete ? 'COMPLETE_REVIEWED_SCENARIOS' : 'PARTIAL_REVIEWED_SCENARIOS',
    scope: 'ALTERNATIVE_GROUP_OUTCOMES_OTHER_STEPS_ASSUME_SUCCESS',
    maximumReviewedFaabExposure: budgetKnown && complete ? evaluatedScenarioMaxFaab : null,
    evaluatedScenarioMaxFaab: budgetKnown ? evaluatedScenarioMaxFaab : null,
    budgetUpperBound: primary.plan.initialFaab, simultaneousSubmissionExposure: null,
    platformCancellationVerified: false, submitsAutomatically: false,
    limits: { maxScenarios, maxFallbacksPerGroup: maxFallbacks, omittedFallbackOccurrences: omittedFallbacks },
    issues: [...(truncated ? ['SCENARIO_LIMIT_REACHED'] : []), ...(evaluationChanged ? ['NON_DETERMINISTIC_EVALUATION'] : []), ...(omittedFallbacks ? ['FALLBACK_OPTIONS_LIMITED'] : [])]
  } };
}

/** Human-readable groups shared by Waiver, AI Context and the Coach message consumed by n8n. */
export function formatClaimPortfolio(plan) {
  if (!plan?.alternativeClaimGroups?.length) return [];
  const names = new Map(plan.steps.map(step => [step.playerId, step.name]));
  const lines = ['CLAIMS ALTERNATIFS — UN SEUL SUCCÈS PAR GROUPE'];
  for (const group of plan.alternativeClaimGroups) {
    const order = group.claims.map((claim, index) => `${index ? 'puis ' : ''}${claim.name} (${claim.suggestedBid} $)${index ? ' seulement si les choix précédents échouent ou sont écartés' : ''}`).join(' ; ');
    const prior = group.dependsOnPlayerIds.length ? ` · suppose les ajouts précédents : ${group.dependsOnPlayerIds.map(id => names.get(id) ?? id).join(', ')}` : '';
    lines.push(`• ${order} · coupe ${group.dropCandidate?.name ?? 'une place libre'} · maximum de ce groupe ${group.maximumBid} $${prior}${group.omittedFallbackCount ? ` · ${group.omittedFallbackCount} autre(s) option(s) hors de ce groupe détaillé` : ''}`);
  }
  const portfolio = plan.claimPortfolio;
  lines.push(portfolio.maximumReviewedFaabExposure === null
    ? `Scénarios partiels ou budget inconnu : maximum global n/d ; maximum observé parmi les scénarios détaillés ${portfolio.evaluatedScenarioMaxFaab ?? 'n/d'} $.`
    : `FAAB maximal parmi les scénarios détaillés : ${portfolio.maximumReviewedFaabExposure} $ ; les enchères d’un même groupe ne s’additionnent pas dans une branche.`);
  lines.push('Si toutes les options échouent : aucune dépense pour ce groupe, autres étapes recalculées. Annulation automatique non vérifiée : choisir une branche et revalider après chaque résultat.');
  return lines;
}
