/** Operational checks on frozen recommendations; realized fantasy results are separate. */
export function auditDecisionReport(report) {
  const rows = Object.values(report.byPosition || {}).flat();
  const actions = rows.filter(row => ['ADD_NOW','CLAIM_IF_CHEAP'].includes(row.waiver?.decision?.recommendedAction));
  const failures = [];
  for (const row of actions) {
    const issues = [];
    const availability = row.availability || {};
    const fit = row.waiver.fit || {};
    const action = row.waiver.decision.recommendedAction;
    if (availability.canStartTargetWeek !== true) issues.push('CANNOT_START_TARGET_WEEK');
    if (action === 'ADD_NOW' && availability.canAddNow !== true) issues.push('CANNOT_ADD_NOW');
    if (action === 'CLAIM_IF_CHEAP' && (availability.availability !== 'WAIVER_LOCKED' || !Number.isFinite(Date.parse(availability.waiverProcessesAt)) || !(Date.parse(availability.waiverProcessesAt) < Date.parse(availability.kickoffAt)))) issues.push('CLAIM_NOT_BEFORE_KICKOFF');
    if (!fit.legalTransaction || !fit.horizonCovered) issues.push('ILLEGAL_OR_UNCOVERED_TRANSACTION');
    if (row.waiver.roleConfirmation === 'UNCONFIRMED') issues.push('ROLE_UNCONFIRMED');
    if (issues.length) failures.push({ playerId:row.sleeperId, issues });
  }
  const steps = report.acquisitionPlan?.steps || [];
  const cuts = steps.map(step => step.dropCandidate?.sleeperId).filter(Boolean);
  const planIssues = [];
  if (new Set(cuts).size !== cuts.length) planIssues.push('DUPLICATE_CUT');
  const bids = steps.map(step => step.suggestedBid);
  if (bids.some(bid => !Number.isInteger(bid) || bid < 0)) planIssues.push('INVALID_BID');
  const budget = report.acquisitionPlan?.initialFaab ?? report.faabRemaining;
  if (steps.length && (!Number.isFinite(budget) || bids.reduce((sum,bid)=>sum+bid,0) > budget)) planIssues.push('BUDGET_EXCEEDED_OR_UNKNOWN');
  return { evaluatedCandidates:rows.length, actionableCount:actions.length, invalidActionCount:failures.length,
    operationalValidityRate:actions.length ? (actions.length-failures.length)/actions.length : null,
    failures, planIssues, fantasyPerformanceEvaluated:false, auctionWinProbability:null };
}
