const ACTION_ORDER = ["ADD_NOW", "CLAIM_IF_CHEAP", "WATCH"];
const validPreferences = new Set(["LISTEN", "KEEP", "SHOP", "UNTOUCHABLE"]);

export function normalizeCoachPreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => key.length <= 80 && validPreferences.has(value))
    .slice(0, 40));
}

function compactWaiver(player) {
  return {
    modelMetrics: player.modelMetrics ?? null,
    sleeperId: player.sleeperId, name: player.name, position: player.position, nflTeam: player.nflTeam,
    decisionClass: player.decisionClass, recommendedAction: player.recommendedAction,
    immediateValue: player.immediateValue, strategicUpside: player.strategicUpside,
    availability: player.availability, roleConfirmation: player.roleConfirmation, horizonWeeks: player.horizonWeeks,
    targetWeekDelta: player.targetWeekDelta, grossGainTotal: player.grossGainTotal, netGainTotal: player.netGainTotal,
    weeklyLineupDeltas: player.weeklyLineupDeltas, coverageIssues: player.coverageIssues, suggestedBid: player.suggestedBid,
    netGain: player.netGain, lineupGain: player.lineupGain, dropCandidate: player.dropCandidate,
    dropCost: player.dropCost, faabMarket: player.faabMarket, maxForTeam: player.maxForTeam,
    preferencePenaltyTotal: player.preferencePenaltyTotal, preferenceOverridden: player.preferenceOverridden, appliedPreference: player.appliedPreference,
    interpretation: player.interpretation, reasons: player.reasons || []
  };
}

export function buildCoachPlan({ decisionContext, trades, preferences = {} }) {
  const context = decisionContext;
  const team = context.myTeam;
  const normalizedPreferences = normalizeCoachPreferences(preferences);
  const waiverActions = Object.fromEntries(ACTION_ORDER.map(action => [action,
    (context.waiverActions?.[action] || []).slice(0, action === "WATCH" ? 4 : 3).map(compactWaiver)
  ]));
  const trade = trades.results?.[0]?.proposals?.[0] || null;
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

  return {
    decisionScope: context.decisionScope ?? null,
    generatedAt: new Date().toISOString(), week: context.week, team: team.teamName, owner: team.owner, rosterId: team.rosterId,
    teamState: {
      record: team.record, rank: team.standingsRank, leagueTeams: context.league.teams, faab: team.faab,
      playoffContext: context.strategyState?.playoffContext ?? null,
      playoffProbability: context.strategyState?.playoffProbability ?? null,
      playoffUrgency: context.strategyState?.playoffUrgency || "UNKNOWN",
      faabPosture: context.strategyState?.faabPosture || "UNKNOWN",
      benchFlexibility: context.strategyState?.benchFlexibility || "UNKNOWN"
    },
    priorities,
    lineup: { alerts: context.lineup?.alerts || [], optimal },
    waiverActions,
    acquisitionPlan: context.acquisitionPlan ?? null,
    rosterPreferences: context.rosterPreferences ?? [],
    scenariosAreAlternatives: true,
    recentTransactions: context.recentTransactions ?? [],
    snapshotIssues: context.snapshotIssues ?? [],
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
  if (plan.lineup.alerts.length || optimal?.gain > 0) {
    lines.push("", "🏈 LINEUP — À FAIRE");
    for (const change of optimal?.changes || []) lines.push(`• ${change.slot}: ${change.in?.name || "slot vide"} à la place de ${change.out?.name || "slot vide"} (${change.gain >= 0 ? "+" : ""}${change.gain} pts)`);
    for (const alert of plan.lineup.alerts) lines.push(`• ${alert.slot}: ${alert.reason}`);
  }
  for (const action of ["ADD_NOW", "CLAIM_IF_CHEAP"]) {
    const targets = plan.waiverActions[action];
    if (!targets.length) continue;
    lines.push("", action === "ADD_NOW" ? "🎯 WAIVERS — AJOUTER MAINTENANT" : "💸 WAIVERS — SEULEMENT AU BON PRIX");
    targets.forEach(player => lines.push(`• ${player.name} (${player.position}) · gain net ${player.netGain} pt/sem sur le rôle · coupe ${player.dropCandidate?.name || "n/d"} · max ${player.maxForTeam ?? 0} $ · S${plan.week}: ${player.targetWeekDelta ?? "n/d"} pt · total net ${player.netGainTotal ?? "n/d"} pt / ${player.horizonWeeks ?? "n/d"} sem`));
  }
  if (plan.acquisitionPlan?.steps.length) {
    lines.push("", "PLAN CONDITIONNEL — VÉRIFIER APRÈS CHAQUE RÉSULTAT");
    for (const step of plan.acquisitionPlan.steps) lines.push(`• ${step.name} · coupe ${step.dropCandidate?.name || "place libre"} · réserver ${step.suggestedBid} $ · budget après ${step.budgetAfter} $ · gain marginal ${step.netGainTotal} pts${step.preferenceOverridden ? ` · préférence temporaire dépassée (${step.preferencePenaltyTotal} points d’utilité)` : ""}${step.dependsOnPlayerIds.length ? ` · suppose les ajouts précédents (${step.dependsOnPlayerIds.join(", ")})` : ""}`);
    lines.push(`Total réservé ${plan.acquisitionPlan.reservedFaab} $ ; aucune probabilité de gagner ni soumission automatique.`);
  }
  lines.push("Scénarios alternatifs : deux claims avec la même coupe ne peuvent pas être exécutés ensemble.");
  if (plan.watchlist.length) {
    lines.push("", "👀 WATCHLIST");
    plan.watchlist.forEach(player => lines.push(`• ${player.name} (${player.position}) · ${player.interpretation}`));
  }
  if (plan.tradeTarget) lines.push("", "🤝 TRADE À EXPLORER", `${plan.tradeTarget.partnerName} · ${plan.tradeTarget.title}`);
  if (plan.priorities[0]?.type === "HOLD") lines.push("", "✅ Aucun mouvement prioritaire : conserve ton roster.");
  return lines.join("\n");
}
