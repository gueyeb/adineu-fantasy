import { formatProjectionComparison } from './projection-comparison.js';
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";
import { formatRecentTransactions } from "../public/assets/acquisition-availability.js";
import { formatPoolCoverage } from "./league-context.js";
import { formatCoherenceWarnings } from "../public/assets/decision-coherence.js";
import { classifyWaiverDecision } from "../public/assets/waiver-model.js";

const round = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(Number(value).toFixed(1)) : null;

function playerDecisionView(player, valuesById, projections, statuses) {
  if (!player) return null;
  const values = valuesById.get?.(player.sleeperId) || valuesById[player.sleeperId] || {};
  const projection = projections[player.sleeperId]?.pts_ppr;
  return {
    ...player,
    status: statuses.get?.(player.sleeperId) || statuses[player.sleeperId] || null,
    weekProjection: round(projection),
    rosPpg: round(values.rosPpg),
    rosSource: values.rosSource || null,
    actualPpg: round(values.actualPpg),
    usageScore: Number.isFinite(values.usageScore) ? values.usageScore : null,
    usageTrend: Number.isFinite(values.usageTrend) ? values.usageTrend : null,
    xfp: round(values.xfp),
    usageSignal: values.signal || null,
    byeWeek: BYE_WEEKS_2026[player.nflTeam] ?? null
  };
}

function waiverRows(report) {
  return Object.values(report?.byPosition || {}).flat()
    .filter(player => player?.waiver)
    .sort((a, b) => {
      const aFit = a.waiver.fit || {};
      const bFit = b.waiver.fit || {};
      return (Number(bFit.gainPerWeek || 0) - Number(aFit.gainPerWeek || 0)) ||
        (Number(bFit.fitScore || 0) - Number(aFit.fitScore || 0)) ||
        (Number(b.waiver.score || 0) - Number(a.waiver.score || 0));
    })
    .map(player => ({
      modelMetrics: player.modelMetrics ?? null,
      poolEntry: player.poolEntry ?? null,
      roleProfile: player.roleProfile ?? null,
      emergingRole: player.emergingRole ?? null,
      progressionGuard: player.waiver.fit?.progressionGuard ?? null,
      progressionSacrificeTotal: player.waiver.fit?.progressionSacrificeTotal ?? null,
      ripple: player.ripple ?? [],
      nextUnlockScenario: player.nextUnlockScenario ?? null,
      starterVacancyScenario: player.starterVacancyScenario ?? null,
      decisionHorizon: player.waiver.decisionHorizon ?? 'ROLE_WINDOW',
      cutSelection: player.waiver.fit?.cutSelection ?? null,
      cutExclusions: player.waiver.fit?.cutExclusions ?? [],
      dropCostComponents: player.waiver.fit?.dropCostComponents ?? null,
      coverageBlockers: player.waiver.fit?.coverageBlockers ?? [],
      decision: player.waiver.decision ?? null,
      horizonCovered: player.waiver.fit?.horizonCovered ?? false,
      preferencePenaltyTotal: player.waiver.fit?.preferencePenaltyTotal ?? 0,
      preferenceOverridden: player.waiver.fit?.preferenceOverridden ?? false,
      appliedPreference: player.waiver.fit?.appliedPreference ?? null,
      coverageIssues: player.waiver.fit?.coverageIssues ?? [],
      roleEvidence: player.waiver.roleEvidence ?? [],
      availability: player.availability ?? null,
      roleConfirmation: player.waiver.roleConfirmation ?? "UNCONFIRMED",
      legalTransaction: player.waiver.fit?.legalTransaction ?? false,
      horizonWeeks: player.waiver.fit?.horizonWeeks ?? null,
      targetWeekDelta: player.waiver.fit?.targetWeekDelta ?? null,
      grossGainTotal: player.waiver.fit?.grossGainTotal ?? null,
      postRoleCutCostTotal: player.waiver.fit?.postRoleCutCostTotal ?? null,
      postRoleCutDeltas: player.waiver.fit?.postRoleCutDeltas ?? [],
      netGainTotal: player.waiver.fit?.netGainTotal ?? null,
      weeklyLineupDeltas: player.waiver.fit?.weeklyLineupDeltas ?? [],
      sleeperId: player.sleeperId,
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      status: player.injuryStatus || null,
      weekProjection: round(player.weekProjection),
      rosPpg: round(player.waiver.rosPpg),
      rosSource: player.waiver.rosSource || null,
      usageScore: player.waiver.usageScore ?? null,
      usageSignal: player.waiver.usageSignal || null,
      xfp: round(player.waiver.xfp),
      provenance: player.provenance ?? null,
      usageDiagnostic: player.usageDiagnostic ?? null,
      marketEstimate: player.waiver.marketEstimate ?? null,
      marketMethod: player.waiver.marketMethod ?? null,
      marketScore: player.waiver.score,
      replacementPpg: round(player.replacementPpg),
      category: player.waiver.category,
      faabMarket: player.waiver.faabMarket,
      fitScore: player.waiver.fit?.fitScore ?? null,
      priorityScore: player.waiver.fit?.priorityScore ?? null,
      lineupGain: round(player.waiver.fit?.gainPerWeek),
      dropCandidate: player.waiver.fit?.dropCandidate || null,
      dropCandidates: player.waiver.fit?.dropCandidates || [],
      dropCost: round(player.waiver.fit?.dropCostPerWeek),
      dropOptionValue: round(player.waiver.fit?.dropOptionValuePerWeek),
      netGain: round(player.waiver.fit?.netGainAverage ?? player.waiver.fit?.netGainPerWeek),
      netGainRosAverage: round(player.waiver.fit?.netGainPerWeek),
      suggestedBid: player.waiver.suggestedBid ?? null,
      bidPctInitial: player.waiver.bidPctInitial ?? null,
      bidPctRemaining: player.waiver.bidPctRemaining ?? null,
      fitSlot: player.waiver.fit?.slot || null,
      maxForTeam: player.waiver.fit?.faabMaxForMe ?? null,
      opportunityDuration: player.waiver.duration || null,
      flags: player.waiver.flags || [],
      reasons: player.waiver.reasons || []
    }));
}

function buildTeamDiagnosis(context, available) {
  const roster = [
    ...context.myTeam.starters.map(entry => entry.player),
    ...context.myTeam.bench,
    ...context.myTeam.ir
  ].filter(Boolean);
  const replacement = {};
  for (const player of available) {
    if (Number.isFinite(player.replacementPpg) && !Number.isFinite(replacement[player.position])) replacement[player.position] = player.replacementPpg;
  }
  const required = context.league.rosterSettings.starters;
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const positionMargins = positions.map(position => {
    const count = required[position] || 1;
    const values = roster.filter(player => player.position === position && Number.isFinite(player.rosPpg))
      .map(player => player.rosPpg).sort((a, b) => b - a).slice(0, count);
    if (!values.length || !Number.isFinite(replacement[position])) return null;
    const starterLevel = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { position, margin: round(starterLevel - replacement[position]), starterLevel: round(starterLevel), replacement: replacement[position] };
  }).filter(Boolean);
  const strengths = positionMargins.filter(row => row.margin >= 3).sort((a, b) => b.margin - a.margin);
  const weaknesses = positionMargins.filter(row => row.margin <= 1).sort((a, b) => a.margin - b.margin);
  const dropCandidates = [...new Map(available.flatMap(player => player.dropCandidates || []).map(player => [player.sleeperId, player])).values()]
    .sort((a, b) => (a.totalCostPerWeek || 0) - (b.totalCostPerWeek || 0)).slice(0, 3);
  return {
    strengths,
    weaknesses,
    rosterPressure: {
      bench: `${context.myTeam.bench.length}/${context.league.rosterSettings.benchSlots}`,
      ir: `${context.myTeam.ir.length}/${context.league.rosterSettings.reserveSlots}`
    },
    dropCandidates,
    // A cut list built while most of the roster is locked is a constraint, not a ranking.
    cutPoolNote: available.some(player => player.cutSelection === "ONLY_ELIGIBLE_CUT")
      ? "Target-week cuts limited to unlocked players (others GAME_LOCKED); see NextUnlock scenarios for the full comparison."
      : available.length && available.every(player => player.cutSelection === "UNRANKED_INCOMPLETE_COVERAGE") ? "No cut designated: horizon coverage incomplete." : null
  };
}

function buildStrategyState(context, playoffContext) {
  const rank = context.myTeam.standingsRank;
  const record = context.myTeam.record || { wins: 0, losses: 0 };
  const playoffTeams = context.league.playoffTeams || 8;
  const outside = Number.isFinite(rank) && rank > playoffTeams;
  const playoffUrgency = outside && record.losses - record.wins >= 3 ? "HIGH" : outside ? "MODERATE" : "LOW";
  const faabRatio = context.myTeam.faab?.budget > 0 ? context.myTeam.faab.remaining / context.myTeam.faab.budget : null;
  const faabPosture = faabRatio === null ? "UNKNOWN" : faabRatio < 0.25 ? "CONSERVE" : faabRatio <= 0.7 ? "MODERATE" : "FLEXIBLE";
  const benchFlexibility = context.myTeam.bench.length >= context.league.rosterSettings.benchSlots ? "LOW" : "AVAILABLE";
  return { playoffUrgency, faabPosture, benchFlexibility, urgencyMethod: "RULE_BASED_STANDINGS", playoffProbability: playoffContext?.ready ? playoffContext.probability : null, playoffContext: playoffContext ?? { ready: false, reason: "NOT_LOADED" } };
}

export function buildDecisionContext({ context, playerValues = {}, statuses = new Map(), waivers = null, lineup = null, matchup = null, playoffContext = null }) {
  const valuesById = playerValues.byId || new Map();
  const projections = playerValues.weeklyProjections || {};
  const enrich = player => playerDecisionView(player, valuesById, projections, statuses);
  const enrichedTeam = {
    ...context.myTeam,
    starters: context.myTeam.starters.map(entry => ({ ...entry, player: enrich(entry.player) })),
    bench: context.myTeam.bench.map(enrich),
    ir: context.myTeam.ir.map(enrich)
  };
  const available = waiverRows(waivers).map(player => ({ ...player, ...(player.decision || classifyWaiverDecision({
    availability: player.availability,
    horizonCovered: player.horizonCovered,
    targetWeekDelta: player.targetWeekDelta,
    roleConfirmation: player.roleConfirmation,
    legalTransaction: player.legalTransaction,
    position: player.position,
    marketScore: player.marketScore,
    flags: player.flags,
    usageSignal: player.usageSignal,
    netGain: player.netGain || 0
  })) }));
  const immediateUpgrades = available.filter(player => player.recommendedAction === "ADD_NOW" && player.targetWeekDelta > 0)
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || (b.netGain || 0) - (a.netGain || 0)).slice(0, 6);
  const immediateIds = new Set(immediateUpgrades.map(player => player.sleeperId));
  const upsideStashes = available.filter(player => ["RB", "WR", "TE"].includes(player.position) && !immediateIds.has(player.sleeperId) && (
    player.opportunityDuration || player.usageSignal === "BUY_LOW" || player.reasons.length
  )).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || b.marketScore - a.marketScore).slice(0, 6);
  const waiverActions = Object.fromEntries(["ADD_NOW", "CLAIM_IF_CHEAP", "WATCH", "IGNORE"].map(action => [action,
    available.filter(player => player.recommendedAction === action)
      .sort((a, b) => b.immediateValue - a.immediateValue || b.strategicUpside - a.strategicUpside).slice(0, action === "IGNORE" ? 4 : 6)
  ]));
  return {
    ...context,
    mode: "decision",
    decisionScope: waivers?.decisionScope ?? null,
    acquisitionPlan: waivers?.acquisitionPlan ?? null,
    projectionComparison: waivers?.projectionComparison ?? null,
    rosterPreferences: waivers?.rosterPreferences ?? [],
    recentTransactions: waivers?.recentTransactions ?? [],
    transactionsTruncatedCount: waivers?.transactionsTruncatedCount ?? 0,
    availabilityAsOf: waivers?.availabilityAsOf ?? null,
    snapshotIssues: waivers?.snapshotIssues ?? [],
    dataThroughWeek: waivers?.lastCompletedWeek ?? null,
    candidateProvenance: available.map(player => ({ playerId: player.sleeperId, provenance: player.provenance, usageDiagnostic: player.usageDiagnostic })),
    rosterProvenance: waivers?.rosterProvenance ?? [],
    playerIndexProvenance: waivers?.playerIndexProvenance ?? null,
    candidateCoverage: { evaluated: waivers?.evaluatedCandidateCount ?? null, returned: waivers?.returnedCandidateCount ?? null },
    poolCoverage: waivers?.poolCoverage ?? null,
    coherence: waivers?.coherence ?? null,
    myTeam: enrichedTeam,
    lineup: lineup || { alerts: [], optimal: null },
    nextMatchup: matchup,
    teamDiagnosis: buildTeamDiagnosis({ ...context, myTeam: enrichedTeam }, available),
    strategyState: buildStrategyState(context, playoffContext),
    topAvailable: [...immediateUpgrades, ...upsideStashes],
    immediateUpgrades,
    upsideStashes,
    waiverActions,
    modelCoverage: waivers ? {
      degraded: Boolean(waivers.degraded),
      projections: waivers.coverage?.projectionWeeks || null,
      usageStats: waivers.coverage?.statsWeeks || null,
      playerIndex: Boolean(waivers.coverage?.playersIndex)
    } : { degraded: true, projections: null, usageStats: null, playerIndex: false }
  };
}

function metric(value, suffix = "") {
  return value === null || value === undefined ? "n/d" : `${value}${suffix}`;
}

function decisionPlayerLine(prefix, player) {
  if (!player) return `${prefix} EMPTY`;
  const fields = [
    `${prefix} ${player.name} ${player.nflTeam || "FA"}`,
    `status=${player.status || "No platform alert"}`,
    `proj=${metric(player.weekProjection)} [Sleeper]`,
    `ROS=${metric(player.rosPpg)} [${player.rosSource || "unknown"}]`,
    `usage=${metric(player.usageScore)} [Adineu]`,
    `trend=${metric(player.usageTrend)} composite-change ×100 [Adineu]`,
    `xFP=${metric(player.xfp)} [Adineu]`,
    `actual=${metric(player.actualPpg)} [Sleeper]`,
    `signal=${player.usageSignal || "none"}`,
    `bye=S${player.byeWeek ?? "n/d"}`
  ];
  return fields.join(" | ");
}

const dropCostText = components => components ? ` [usage ${components.usagePremiumPerWeek} + buyLow ${components.buyLowPremiumPerWeek} + projUpside ${components.projectionUpsidePerWeek} = option ${components.optionValuePerWeek}/w × ${components.horizonWeeks}w = ${components.optionTotal}; postRoleLineupLoss ${metric(components.postRoleLineupLossTotal)}; lineup loss already in gross; inputs ${components.optionCoverage}${components.missingInputs.length ? ` missing ${components.missingInputs.join(",")}` : ""}; uncalibrated]` : "";
const emergingText = emerging => !emerging?.comparable ? "" : ` | Trend W${emerging.weeksCompared.join("/")}: snaps ${metric(emerging.snapShareDelta)}, targets ${metric(emerging.targetsDelta)}, opportunities ${metric(emerging.opportunitiesDelta)}, xFP ${metric(emerging.xfpDelta)}, routes n/d -> ${emerging.progression}${emerging.progressionSource ? ` ${emerging.progressionSource}` : ""}, emerging option ${metric(emerging.optionValuePerWeek, " pts/w")} [uncalibrated]`;
const nextUnlockText = scenario => !scenario ? "" : scenario.status !== "EVALUATED" ? ` | NextUnlock=${scenario.status}`
  : ` | NextUnlock=scenario only, not executable: start W${scenario.startWeek}, unlock ${scenario.unlockVerified ? scenario.unlockAt : "UNVERIFIED"}, horizon ${metric(scenario.horizonWeeks, "w")}, net ${metric(scenario.netGainTotal, " pts")}, cut ${scenario.dropCandidate?.name || "n/d"}, indicative max ${metric(scenario.indicativeMaxBid, " $")}, coverage ${scenario.coverageIssues.join(",") || "complete"}`;

export function formatDecisionContext(context) {
  const league = context.league;
  const team = context.myTeam;
  const record = team.record || { wins: 0, losses: 0, ties: 0 };
  const recordText = `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
  const startersLabel = Object.entries(league.rosterSettings.starters).map(([pos, count]) => `${count}${pos}`).join(" ");
  const lines = [
    "ADINEU AI CONTEXT v2 — DECISION",
    `Generated: ${context.generatedAt}`,
    `Data through: ${context.dataThroughWeek ? `Week ${context.dataThroughWeek}` : "unknown"}`,
    `Forecast: Week ${context.week}`,
    "",
    "LEAGUE",
    `${league.name.toUpperCase()} | ${league.teams} teams | Full PPR | ${startersLabel} | ${league.rosterSettings.benchSlots} bench | ${league.rosterSettings.reserveSlots} IR`,
    `Waivers: ${league.waiverClear} | Trade deadline: Week ${league.tradeDeadlineWeek}`,
    "",
    `TEAM — ${team.teamName.toUpperCase()} (@${team.owner})`,
    `Record: ${recordText} | Rank: ${team.standingsRank ?? "n/d"}/${league.teams} | PF: ${team.pointsFor ?? "n/d"} | PA: ${team.pointsAgainst ?? "n/d"}`,
    `FAAB remaining: $${team.faab?.remaining ?? "n/d"} / $${team.faab?.budget ?? league.faab} | spent: $${team.faab?.used ?? "n/d"} | waiver tiebreaker: ${team.waiverPriority ?? "n/d"}${team.streak ? ` | streak: ${team.streak}` : ""}`,
    "",
    "TEAM DIAGNOSIS",
    `Strengths: ${context.teamDiagnosis.strengths.length ? context.teamDiagnosis.strengths.map(row => `${row.position} (+${row.margin} PPG vs replacement)`).join("; ") : "none detected"}`,
    `Weaknesses: ${context.teamDiagnosis.weaknesses.length ? context.teamDiagnosis.weaknesses.map(row => `${row.position} (${row.margin >= 0 ? "+" : ""}${row.margin} PPG vs replacement)`).join("; ") : "none detected"}`,
    `Roster pressure: bench ${context.teamDiagnosis.rosterPressure.bench}; IR ${context.teamDiagnosis.rosterPressure.ir}`,
    `Lowest marginal cuts: ${context.teamDiagnosis.dropCandidates.length ? context.teamDiagnosis.dropCandidates.map(player => `${player.name} (immediate ${metric(player.immediateValuePerWeek)}, option ${metric(player.optionValuePerWeek)}, total ${metric(player.totalCostPerWeek)} pts/w, usage ${metric(player.usageScore)}, bye S${player.byeWeek ?? "n/d"}, regret ${player.regretRisk})`).join("; ") : "n/d"}${context.teamDiagnosis.cutPoolNote ? ` | ${context.teamDiagnosis.cutPoolNote}` : ""}`,
    "",
    "STRATEGY STATE",
    `Playoff urgency: ${context.strategyState.playoffUrgency} (rule-based standings; distinct from simulated odds)`,
    `Playoff estimate (existing Monte Carlo; not official Sleeper): ${JSON.stringify(context.strategyState.playoffContext)}`,
    `Record: ${recordText} | Seed: ${team.standingsRank ?? "n/d"}/${league.teams} | Playoff spots: ${league.playoffTeams || 8}`,
    `FAAB posture: ${context.strategyState.faabPosture} | Bench flexibility: ${context.strategyState.benchFlexibility}`,
    "",
    "ROSTER — PROJECTIONS & USAGE"
  ];

  for (const starter of context.myTeam.starters) lines.push(decisionPlayerLine(starter.slot, starter.player));
  lines.push("", "BENCH");
  for (const player of context.myTeam.bench) lines.push(decisionPlayerLine(player.position || "FLEX", player));
  lines.push("", "IR");
  if (!context.myTeam.ir.length) lines.push("EMPTY");
  for (const player of context.myTeam.ir) lines.push(decisionPlayerLine(player.position || "FLEX", player));

  lines.push("", "LINEUP");
  lines.push(`Hard alerts: ${context.lineup?.alerts?.length || 0}`);
  if (!context.lineup?.alerts?.length) lines.push("No injury/bye/empty-slot alerts.");
  for (const alert of context.lineup?.alerts || []) {
    const replacement = alert.replacement?.player?.name ? ` | replacement=${alert.replacement.player.name}` : "";
    lines.push(`${alert.severity} | ${alert.slot} | ${alert.player?.name || "EMPTY"} | ${alert.reason}${replacement}`);
  }
  if (context.lineup?.optimal) {
    const optimal = context.lineup.optimal;
    lines.push(`Current projected total: ${metric(optimal.currentTotal)} [Sleeper]`);
    lines.push(`Optimal projected total: ${metric(optimal.optimalTotal)} [Sleeper]`);
    lines.push(`Potential gain: +${metric(optimal.gain, " pts")}`);
    lines.push(`Optimization opportunities: ${optimal.changes?.length ?? optimal.promote?.length ?? 0}`);
    (optimal.changes || []).forEach(change => {
      lines.push(`${change.slot}: ${change.in?.name || "EMPTY"} IN -> ${change.out?.name || "EMPTY"} OUT (${change.gain >= 0 ? "+" : ""}${change.gain} pts)`);
    });
  }

  lines.push("", "NEXT MATCHUP");
  if (!context.nextMatchup) {
    lines.push("Unavailable");
  } else {
    const matchup = context.nextMatchup;
    const opponentRecord = matchup.opponent.record;
    lines.push(`Opponent: ${matchup.opponent.teamName} (@${matchup.opponent.owner}) | Record: ${opponentRecord.wins}-${opponentRecord.losses}${opponentRecord.ties ? `-${opponentRecord.ties}` : ""}`);
    lines.push(`${context.myTeam.teamName}: ${metric(matchup.myProjection.total)} [Sleeper pregame projections] (${matchup.myProjection.coverage} required slots)`);
    lines.push(`${matchup.opponent.teamName}: ${metric(matchup.opponentProjection.total)} [Sleeper pregame projections] (${matchup.opponentProjection.coverage} required slots)`);
    lines.push(`Mixed total (actual + not-started projections): ${metric(matchup.myProjection.mixedTotal)} / ${metric(matchup.opponentProjection.mixedTotal)}; live remaining projections are unavailable.`);
    lines.push("Win estimate: not included (projection coverage and lineup completeness must be validated separately).");
  }

  lines.push("TEMPORARY ROSTER PREFERENCES", JSON.stringify(context.rosterPreferences || []));
  lines.push("CONDITIONAL ACQUISITION PLAN — REVALIDATE AFTER EACH RESULT", JSON.stringify(context.acquisitionPlan || null));
  const vacancyRows = Object.values(context.waiverActions || {}).flat().filter(player => player.starterVacancyScenario);
  if (vacancyRows.length) lines.push("TARGET WEEK — FILL STARTER SLOTS (ROS separate)", ...vacancyRows.map(player =>
    `${player.name}: ${player.starterVacancyScenario.slot} S${context.week} | target gain=${metric(player.targetWeekDelta)} | net after permanent cut cost=${metric(player.netGainTotal)} | ${player.recommendedAction} | availability=${player.availability?.availability || "UNKNOWN"}`));
  lines.push("RECENT TRANSACTIONS (72h)", ...formatRecentTransactions(context.recentTransactions || []), `Truncated: ${context.transactionsTruncatedCount || 0} | Availability as of: ${context.availabilityAsOf || "n/d"}`, ...(context.snapshotIssues || []));
  if (context.poolCoverage) lines.push("CANDIDATE POOL", ...formatPoolCoverage(context.poolCoverage));
  if (context.coherence) lines.push("COHERENCE CHECKS (before publication)", ...formatCoherenceWarnings(context.coherence));
  const waiverLine = (player, index) => `${index + 1}. ${player.name} ${player.position} ${player.nflTeam || "FA"} | Class=${player.decisionClass} | Immediate=${player.immediateValue} | Strategic=${player.strategicUpside} | Market=${player.marketScore} | GrossGain=${metric(player.lineupGain, " pts/w")} | Drop=${player.dropCandidate?.name || "none"} | DropCost=${metric(player.dropCost, " pts/w")} | NetGain=${metric(player.netGain, " pts/w over role horizon")} | Availability=${player.availability?.availability || "UNKNOWN"} | TargetWeekDelta=${metric(player.targetWeekDelta, " pts")} | Horizon=${metric(player.horizonWeeks, " weeks")} | GrossTotal=${metric(player.grossGainTotal, " pts")} | PostRoleCutLoss=${metric(player.postRoleCutCostTotal, " pts")} | NetTotal=${metric(player.netGainTotal, " pts")} | FAAB market estimate=${player.faabMarket?.join("–") || "n/d"} $ | SuggestedBid=${metric(player.suggestedBid, " $")} | PersonalMax=${metric(player.maxForTeam, " $")} | Budget=${metric(player.bidPctInitial, "% initial")}/${metric(player.bidPctRemaining, "% remaining")} | AuctionWinProbability=n/d | Role=${player.roleConfirmation} | Coverage=${player.coverageIssues.join(",") || "complete"}${player.coverageBlockers?.length ? ` (blocked by ${[...new Set(player.coverageBlockers.map(row => row.name || row.playerId))].join(", ")})` : ""} | Cut=${player.cutSelection || "n/d"}${dropCostText(player.dropCostComponents)} | RoleProfile=${player.roleProfile?.profile || "none"}${player.roleProfile?.profile ? ` [${player.roleProfile.basis.join(",")}; uncalibrated thresholds]` : ""}${emergingText(player.emergingRole)}${["JUSTIFIED", "NOT_JUSTIFIED", "UNPRICED"].includes(player.progressionGuard) ? ` | ProgressionGuard=${player.progressionGuard} (sacrifice ${metric(player.progressionSacrificeTotal, " pts")} vs net ${metric(player.netGainTotal, " pts")}; cutting an organic riser for a rental)` : ""} | Entry=${player.poolEntry?.reasons?.join("+") || "n/d"}${player.poolEntry && !player.poolEntry.valuationCovered ? " (no projection: no numeric gain)" : ""}${player.poolEntry?.recentDrop ? ` | RecentDrop=${player.poolEntry.recentDrop.droppedAt} clearance unverified` : ""}${player.ripple?.length ? ` | Ripple=${player.ripple.map(row => `${row.triggerName || row.triggerPlayerId} ${row.triggerStatus || row.type} ${row.group}`).join("; ")} (re-evaluate; no share or succession attributed)` : ""}${nextUnlockText(player.nextUnlockScenario)} | ${player.interpretation}${player.reasons.length ? ` | ${player.reasons.join("; ")}` : ""}`;
  lines.push("", "WAIVER — RECOMMENDED ACTIONS");
  for (const action of ["ADD_NOW", "CLAIM_IF_CHEAP", "WATCH", "IGNORE"]) {
    lines.push("", action.replaceAll("_", " "));
    const players = context.waiverActions[action] || [];
    if (!players.length) lines.push("None");
    players.forEach((player, index) => lines.push(waiverLine(player, index)));
  }

  const comparisonIds = [...context.myTeam.starters.map(entry => entry.player?.sleeperId),
    ...context.myTeam.bench.map(player => player.sleeperId), ...context.topAvailable.map(player => player.sleeperId)].filter(Boolean);
  const comparisonLines = formatProjectionComparison(context.projectionComparison, comparisonIds);
  if (comparisonLines.length) lines.push('', ...comparisonLines);
  const coverage = context.modelCoverage;
  lines.push(
    "",
    "MODEL NOTES",
    "Week projections and ROS: Sleeper, with Adineu usage blend on distant weeks when available.",
    `Player source coverage (source load dates; game completion unverified): ${JSON.stringify({ roster: context.rosterProvenance ?? [], candidates: context.candidateProvenance ?? [] })}`,
    "Usage/xFP/signals and waiver Market/Capture/Priority: Adineu estimates, not official NFL or Sleeper values.",
    `Coverage: projections ${coverage.projections || "n/d"}; usage ${coverage.usageStats || "n/d"}; player status ${coverage.playerIndex ? "available" : "unavailable"}; degraded=${coverage.degraded}.`,
    "SELL_HIGH/BUY_LOW describe production relative to estimated xFP; neither instructs a cut nor guarantees regression. WOPR is not xFP; no external chart is ingested without a numerical, versioned source and defined universe.",
    "No platform alert describes the platform status, not health clearance. Candidate transactions are alternatives; claims sharing a cut cannot both execute.",
    "Missing values are shown as n/d; no injury return date or auction-win probability is inferred."
  );
  return lines.join("\n");
}
