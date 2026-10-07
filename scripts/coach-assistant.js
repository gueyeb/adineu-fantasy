import { formatLineupMovements } from "./lineup-movements.js";
import { summarizeDecisionProvenance, formatProvenanceSummary } from './decision-provenance.js';
import { formatTeRosterUtility } from './te-roster-utility.js';
import { formatClaimPortfolio } from '../public/assets/waiver-plan.js';
import { formatProjectionComparison } from './projection-comparison.js';
const ACTION_ORDER = ["ADD_NOW", "CLAIM_IF_CHEAP", "WATCH"];
const validPreferences = new Set(["LISTEN", "KEEP", "SHOP", "UNTOUCHABLE"]);
const blockerLabels = {
  INCOMPLETE_HORIZON: "projections incomplètes sur la durée du rôle",
  TARGET_WEEK_ELIGIBILITY_UNVERIFIED: "disponibilité cette semaine non vérifiée",
  ROLE_UNCONFIRMED: "promotion non confirmée",
  UNKNOWN_FAAB_BALANCE: "solde FAAB à vérifier",
  NO_LEGAL_TRANSACTION: "aucune transaction réalisable identifiée"
};

export function normalizeCoachPreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => key.length <= 80 && validPreferences.has(value))
    .slice(0, 40));
}

function compactWaiver(player) {
  return {
    provenance: player.provenance ?? null,
    weekProjection: player.weekProjection ?? null, rosPpg: player.rosPpg ?? null,
    usageScore: player.usageScore ?? null,
    dropCostComponents: player.dropCostComponents ?? player.modelMetrics?.dropCostComponents ?? null,
    modelMetrics: player.modelMetrics ?? null,
    teRosterUtility: player.teRosterUtility ?? null,
    starterVacancyScenario: player.starterVacancyScenario ?? null,
    sleeperId: player.sleeperId, name: player.name, position: player.position, nflTeam: player.nflTeam,
    decisionClass: player.decisionClass, recommendedAction: player.recommendedAction,
    immediateValue: player.immediateValue, strategicUpside: player.strategicUpside,
    availability: player.availability, roleConfirmation: player.roleConfirmation, horizonWeeks: player.horizonWeeks,
    targetWeekDelta: player.targetWeekDelta, grossGainTotal: player.grossGainTotal, netGainTotal: player.netGainTotal,
    weeklyLineupDeltas: player.weeklyLineupDeltas, coverageIssues: player.coverageIssues, suggestedBid: player.suggestedBid,
    netGain: player.netGain, lineupGain: player.lineupGain, dropCandidate: player.dropCandidate,
    dropCost: player.dropCost, faabMarket: player.faabMarket, maxForTeam: player.maxForTeam,
    preferencePenaltyTotal: player.preferencePenaltyTotal, preferenceOverridden: player.preferenceOverridden, appliedPreference: player.appliedPreference,
    interpretation: player.interpretation, reasons: player.reasons || [],
    actionBlockers: player.decision?.actionBlockers ?? player.actionBlockers ?? []
  };
}

// Show one candidate per vacant streaming slot before alternative players for that same slot.
function prioritizeVacancies(rows) {
  const ordered = [...rows].sort((a, b) =>
    Number(Boolean(b.starterVacancyScenario)) - Number(Boolean(a.starterVacancyScenario)) ||
    (a.starterVacancyScenario && b.starterVacancyScenario ? (b.targetWeekDelta ?? -Infinity) - (a.targetWeekDelta ?? -Infinity) : 0));
  const seen = new Set();
  const primary = [], alternatives = [], other = [];
  for (const row of ordered) {
    const slot = row.starterVacancyScenario?.slot;
    if (!slot) other.push(row);
    else if (seen.has(slot)) alternatives.push(row);
    else { seen.add(slot); primary.push(row); }
  }
  return [...primary, ...other, ...alternatives];
}

export function buildCoachPlan({ decisionContext, trades, preferences = {} }) {
  const context = decisionContext;
  const team = context.myTeam;
  const normalizedPreferences = normalizeCoachPreferences(preferences);
  const waiverActions = Object.fromEntries(ACTION_ORDER.map(action => [action,
    prioritizeVacancies(context.waiverActions?.[action] || []).slice(0, action === "WATCH" ? 4 : 3).map(compactWaiver)
  ]));
  const ownedIds = new Set(['starters', 'bench', 'ir'].flatMap(group => (team[group] || [])
    .map(entry => String((entry?.player || entry)?.sleeperId || '')).filter(Boolean)));
  const tradeConflict = (trades.results?.[0]?.proposals || []).some(proposal =>
    (proposal.receive || []).some(player => ownedIds.has(String(player.sleeperId || ''))));
  const trade = (trades.results?.[0]?.proposals || []).find(proposal =>
    !(proposal.receive || []).some(player => ownedIds.has(String(player.sleeperId || '')))) || null;
  const optimal = context.lineup?.optimal || null;
  const priorities = [];

  if (context.lineup?.alerts?.length || optimal?.gain > 0) priorities.push({
    type: "LINEUP", level: context.lineup?.alerts?.length ? "URGENT" : "ACTION",
    title: context.lineup?.alerts?.length ? "Sécuriser la lineup" : "Optimiser la lineup",
    detail: optimal?.gain > 0 ? `+${optimal.gain} pts projetés` : `${context.lineup.alerts.length} alerte(s)`
  });
  const planSteps = context.acquisitionPlan?.steps;
  const immediateCount = planSteps ? planSteps.filter(step => step.recommendedAction === "ADD_NOW").length : waiverActions.ADD_NOW.length;
  const claimCount = planSteps ? planSteps.filter(step => step.recommendedAction === "CLAIM_IF_CHEAP").length : waiverActions.CLAIM_IF_CHEAP.length;
  if (immediateCount) priorities.push({ type: "WAIVERS", level: "URGENT", title: "Ajouter maintenant", detail: `${immediateCount} étape(s) à vérifier` });
  else if (claimCount) priorities.push({ type: "WAIVERS", level: "OPTION", title: "Enchérir seulement au bon prix", detail: `${claimCount} étape(s) conditionnelle(s)` });
  if (trade) priorities.push({ type: "TRADE", level: "OPTION", title: "Explorer un trade", detail: trade.partnerName });
  if (!priorities.length) priorities.push({ type: "HOLD", level: "OK", title: "Conserver le roster", detail: "Aucun gain net identifié" });

  const rosterNames = new Map(['starters', 'bench', 'ir'].flatMap(group => team[group] || [])
    .map(entry => entry.player || entry).filter(Boolean).map(player => [String(player.sleeperId), player.name]));
  const projectionCoverage = summarizeDecisionProvenance({
    roster: (context.rosterProvenance || []).map(row => ({ ...row, name: rosterNames.get(String(row.playerId)) })),
    candidates: context.candidateProvenance || []
  });

  return {
    decisionScope: context.decisionScope ?? null,
    coherence: context.coherence ?? null,
    publishable: context.coherence?.publishable ?? null,
    generatedAt: new Date().toISOString(), week: context.week, team: team.teamName, owner: team.owner, rosterId: team.rosterId,
    teamState: {
      record: team.record, rank: team.standingsRank, leagueTeams: context.league.teams, faab: team.faab,
      playoffContext: context.strategyState?.playoffContext ?? null,
      playoffProbability: context.strategyState?.playoffProbability ?? null,
      playoffUrgency: context.strategyState?.playoffUrgency || "UNKNOWN",
      faabPosture: context.strategyState?.faabPosture || "UNKNOWN",
      benchFlexibility: context.strategyState?.benchFlexibility || "UNKNOWN"
    },
    priorities: priorities.slice(0, 3),
    roster: { starters: team.starters || [], bench: team.bench || [], ir: team.ir || [] },
    projectionCoverage,
    projectionDiagnostics: ['roster', 'candidates'].flatMap(scope => projectionCoverage[scope].gaps.map(row => ({ ...row, scope }))),
    lineup: { alerts: context.lineup?.alerts || [], optimal },
    waiverActions,
    acquisitionPlan: context.acquisitionPlan ?? null,
    projectionComparison: context.projectionComparison ?? null,
    rosterPreferences: context.rosterPreferences ?? [],
    scenariosAreAlternatives: true,
    recentTransactions: context.recentTransactions ?? [],
    snapshotIssues: [...(context.snapshotIssues ?? []), ...(tradeConflict ? ['TRADE_RECEIVE_ALREADY_OWNED'] : [])],
    watchlist: waiverActions.WATCH,
    cutCandidates: context.teamDiagnosis?.dropCandidates || [],
    tradeTarget: trade,
    nextMatchup: context.nextMatchup || null,
    preferences: normalizedPreferences,
    modelCoverage: context.modelCoverage,
    dataThroughWeek: context.dataThroughWeek
  };
}

export function formatCoachPlan(plan) {
  const record = plan.teamState.record || { wins: 0, losses: 0, ties: 0 };
  const lines = [
    `🧠 COACH ${plan.team.toUpperCase()} — SEMAINE ${plan.week}`,
    `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""} · #${plan.teamState.rank}/${plan.teamState.leagueTeams} · FAAB ${plan.teamState.faab?.remaining ?? "n/d"} $ · urgence playoffs ${plan.teamState.playoffUrgency}`
  ];
  const optimal = plan.lineup.optimal;
  if (plan.coherence?.decisionStatus?.status === "DEGRADED") {
    lines.push(`⚠ Décision dégradée : ${plan.coherence.warnings.filter(row => plan.coherence.decisionStatus.reasons.includes(row.code)).map(row => row.message).join(" ") || plan.coherence.decisionStatus.reasons.join(", ")}`);
  }
  if (plan.publishable === false) {
    lines.push("⛔ Contrôle de cohérence : NON publiable — envoi automatique refusé. À corriger avant toute action :",
      ...plan.coherence.warnings.filter(row => row.category === "CALCULATION_INCONSISTENCY").map(row => `• ${row.code} — ${row.message}`));
  }
  if (plan.snapshotIssues.includes('TRADE_RECEIVE_ALREADY_OWNED')) lines.push("⚠ Trade incohérent écarté : un joueur à recevoir appartient déjà au roster.");
  if (plan.lineup.alerts.length || optimal?.gain > 0) {
    lines.push("", "🏈 LINEUP — À FAIRE");
    lines.push(...formatLineupMovements(optimal).map(line => `• ${line}`));
    for (const alert of plan.lineup.alerts) lines.push(`• ${alert.slot}: ${alert.reason}${alert.advice ? ` — ${alert.advice}` : ""}`);
  }
  for (const action of ["ADD_NOW", "CLAIM_IF_CHEAP"]) {
    const targets = plan.acquisitionPlan ? [] : plan.waiverActions[action];
    if (!targets.length) continue;
    lines.push("", action === "ADD_NOW" ? "🎯 WAIVERS — AJOUTER MAINTENANT" : "💸 WAIVERS — SEULEMENT AU BON PRIX");
    targets.forEach(player => lines.push(`• ${player.name} (${player.position})${player.starterVacancyScenario ? ` · compléter ${player.starterVacancyScenario.slot} en S${plan.week}` : ""} · gain net ${player.netGain} pt/sem ${player.starterVacancyScenario ? `sur S${plan.week}` : "sur le rôle"} · coupe ${player.dropCandidate?.name || "n/d"} · max ${player.maxForTeam ?? "n/d"} $ · S${plan.week}: ${player.targetWeekDelta ?? "n/d"} pt · total net ${player.netGainTotal ?? "n/d"} pt / ${player.horizonWeeks ?? "n/d"} sem`));
  }
  if (plan.acquisitionPlan?.steps.length) {
    lines.push("", "PLAN CONDITIONNEL — VÉRIFIER APRÈS CHAQUE RÉSULTAT");
    for (const step of plan.acquisitionPlan.steps) lines.push(`• ${step.name} · coupe ${step.dropCandidate?.name || "place libre"} · réserver ${step.suggestedBid} $ · budget après ${step.budgetAfter} $ · gain marginal ${step.netGainTotal} pts${step.preferenceOverridden ? ` · préférence temporaire dépassée (${step.preferencePenaltyTotal} points d’utilité)` : ""}${step.dependsOnPlayerIds.length ? ` · suppose les ajouts précédents (${step.dependsOnPlayerIds.join(", ")})` : ""}`);
    lines.push(`Total réservé ${plan.acquisitionPlan.reservedFaab} $ ; aucune probabilité de gagner ni soumission automatique.`);
  }
  const claimLines = formatClaimPortfolio(plan.acquisitionPlan);
  if (claimLines.length) lines.push('', ...claimLines);
  if (!plan.acquisitionPlan && plan.waiverActions.ADD_NOW.length + plan.waiverActions.CLAIM_IF_CHEAP.length > 1) lines.push("Scénarios alternatifs : deux claims avec la même coupe ne peuvent pas être exécutés ensemble.");
  if (plan.watchlist.length) {
    lines.push("", "👀 WATCHLIST");
    plan.watchlist.forEach(player => lines.push(`• ${player.name} (${player.position})${player.starterVacancyScenario ? ` · compléter ${player.starterVacancyScenario.slot} en S${plan.week} (${player.targetWeekDelta ?? "n/d"} pts projetés) · ROS évalué séparément` : ""} · ${player.actionBlockers?.length
      ? `à surveiller, action bloquée : ${player.actionBlockers.map(code => blockerLabels[code] || code.replaceAll('_', ' ')).join(' ; ')}`
      : player.interpretation}`));
  }
  const teRowsById = new Map();
  const standaloneActions = plan.acquisitionPlan ? [] : [...plan.waiverActions.ADD_NOW, ...plan.waiverActions.CLAIM_IF_CHEAP];
  for (const player of [...(plan.acquisitionPlan?.steps ?? []), ...standaloneActions, ...plan.watchlist]) {
    const id = String(player.playerId ?? player.sleeperId);
    if (player.teRosterUtility && !teRowsById.has(id)) teRowsById.set(id, player);
  }
  const teRows = [...teRowsById.values()];
  if (teRows.length) lines.push('', '🏈 UTILITÉ DU TE', ...teRows.slice(0, 3).map(player => `• ${player.name} · ${formatTeRosterUtility(player.teRosterUtility)}`));
  if (plan.tradeTarget) lines.push("", "🤝 TRADE À EXPLORER", `${plan.tradeTarget.partnerName} · ${plan.tradeTarget.title}`);
  if (plan.priorities[0]?.type === "HOLD") lines.push("", "✅ Aucun mouvement prioritaire : conserve ton roster.");
  const comparisonIds = [...Object.values(plan.waiverActions).flat().map(player => player.sleeperId),
    ...(plan.lineup.optimal?.changes ?? []).flatMap(change => [change.in?.sleeperId, change.out?.sleeperId])].filter(Boolean);
  const comparisonLines = formatProjectionComparison(plan.projectionComparison, comparisonIds);
  if (comparisonLines.length) lines.push('', ...comparisonLines);
  const cutWarnings = [...(plan.acquisitionPlan?.steps || []), ...Object.values(plan.waiverActions).flat()]
    .filter(row => row.dropCostComponents?.unpricedCutPotential || row.modelMetrics?.dropCostComponents?.unpricedCutPotential);
  const cutNames = [...new Set(cutWarnings.map(row => row.dropCandidate?.name || 'coupe proposée'))];
  if (cutNames.length) lines.push('', `⚠ Potentiel de coupe non chiffré : ${cutNames.join(', ')}. Le gain net exclut ce potentiel ; comparer une autre coupe avant décision.`);
  if (plan.projectionCoverage) lines.push('', ...formatProvenanceSummary(plan.projectionCoverage));
  return lines.join("\n");
}
