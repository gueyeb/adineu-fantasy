import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";

const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(1)) : null;

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
      marketScore: player.waiver.score,
      replacementPpg: round(player.replacementPpg),
      category: player.waiver.category,
      faabMarket: player.waiver.faabMarket,
      fitScore: player.waiver.fit?.fitScore ?? null,
      priorityScore: player.waiver.fit?.priorityScore ?? null,
      lineupGain: round(player.waiver.fit?.gainPerWeek),
      dropCandidate: player.waiver.fit?.dropCandidate || null,
      dropCost: round(player.waiver.fit?.dropCostPerWeek),
      dropOptionValue: round(player.waiver.fit?.dropOptionValuePerWeek),
      netGain: round(player.waiver.fit?.netGainPerWeek),
      fitSlot: player.waiver.fit?.slot || null,
      maxForTeam: player.waiver.fit?.faabMaxForMe ?? null,
      opportunityDuration: player.waiver.duration || null,
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
  const dropCandidates = [...new Map(available.filter(player => player.dropCandidate).map(player => [player.dropCandidate.sleeperId, {
    ...player.dropCandidate,
    costPerWeek: player.dropCost,
    optionValuePerWeek: player.dropOptionValue
  }])).values()].sort((a, b) => (a.costPerWeek || 0) - (b.costPerWeek || 0)).slice(0, 3);
  return {
    strengths,
    weaknesses,
    rosterPressure: {
      bench: `${context.myTeam.bench.length}/${context.league.rosterSettings.benchSlots}`,
      ir: `${context.myTeam.ir.length}/${context.league.rosterSettings.reserveSlots}`
    },
    dropCandidates
  };
}

export function buildDecisionContext({ context, playerValues = {}, statuses = new Map(), waivers = null, lineup = null, matchup = null }) {
  const valuesById = playerValues.byId || new Map();
  const projections = playerValues.weeklyProjections || {};
  const enrich = player => playerDecisionView(player, valuesById, projections, statuses);
  const enrichedTeam = {
    ...context.myTeam,
    starters: context.myTeam.starters.map(entry => ({ ...entry, player: enrich(entry.player) })),
    bench: context.myTeam.bench.map(enrich),
    ir: context.myTeam.ir.map(enrich)
  };
  const available = waiverRows(waivers);
  const immediateUpgrades = available.filter(player => (player.netGain || 0) > 0.3)
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || (b.netGain || 0) - (a.netGain || 0)).slice(0, 6);
  const immediateIds = new Set(immediateUpgrades.map(player => player.sleeperId));
  const upsideStashes = available.filter(player => ["RB", "WR", "TE"].includes(player.position) && !immediateIds.has(player.sleeperId) && (
    player.opportunityDuration || player.usageSignal === "BUY_LOW" || player.reasons.length
  )).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || b.marketScore - a.marketScore).slice(0, 6);
  return {
    ...context,
    mode: "decision",
    dataThroughWeek: waivers?.lastCompletedWeek ?? null,
    myTeam: enrichedTeam,
    lineup: lineup || { alerts: [], optimal: null },
    nextMatchup: matchup,
    teamDiagnosis: buildTeamDiagnosis({ ...context, myTeam: enrichedTeam }, available),
    topAvailable: [...immediateUpgrades, ...upsideStashes],
    immediateUpgrades,
    upsideStashes,
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
    `status=${player.status || "Healthy"}`,
    `proj=${metric(player.weekProjection)} [Sleeper]`,
    `ROS=${metric(player.rosPpg)} [${player.rosSource || "unknown"}]`,
    `usage=${metric(player.usageScore)} [Adineu]`,
    `trend=${metric(player.usageTrend)} [Adineu]`,
    `xFP=${metric(player.xfp)} [Adineu]`,
    `actual=${metric(player.actualPpg)} [Sleeper]`,
    `signal=${player.usageSignal || "none"}`,
    `bye=S${player.byeWeek ?? "n/d"}`
  ];
  return fields.join(" | ");
}

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
    `Lowest marginal cuts: ${context.teamDiagnosis.dropCandidates.length ? context.teamDiagnosis.dropCandidates.map(player => `${player.name} (${metric(player.costPerWeek)} pts/w, option ${metric(player.optionValuePerWeek)})`).join("; ") : "n/d"}`,
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
    lines.push(`${context.myTeam.teamName}: ${metric(matchup.myProjection.total)} [Sleeper] (${matchup.myProjection.coverage} starters)`);
    lines.push(`${matchup.opponent.teamName}: ${metric(matchup.opponentProjection.total)} [Sleeper] (${matchup.opponentProjection.coverage} starters)`);
    lines.push("Win estimate: not included (projection coverage and lineup completeness must be validated separately).");
  }

  const waiverLine = (player, index) => `${index + 1}. ${player.name} ${player.position} ${player.nflTeam || "FA"} | Priority=${metric(player.priorityScore)} | Market=${player.marketScore} | SurplusCaptured=${metric(player.fitScore, "%")} | GrossGain=${metric(player.lineupGain, " pts/w")} | Drop=${player.dropCandidate?.name || "none"} | DropCost=${metric(player.dropCost, " pts/w")} | NetGain=${metric(player.netGain, " pts/w")} | FAAB=${player.faabMarket?.join("–") || "n/d"} $ | Max=${metric(player.maxForTeam, " $")} | ROS=${metric(player.rosPpg)} [${player.rosSource || "unknown"}] | Usage=${metric(player.usageScore)} [Adineu] | Signal=${player.usageSignal || "none"}${player.reasons.length ? ` | ${player.reasons.join("; ")}` : ""}`;
  lines.push("", "WAIVER — IMMEDIATE LINEUP UPGRADES");
  if (!context.immediateUpgrades.length) lines.push("None");
  context.immediateUpgrades.forEach((player, index) => lines.push(waiverLine(player, index)));
  lines.push("", "WAIVER — UPSIDE / BENCH STASHES");
  if (!context.upsideStashes.length) lines.push("None");
  context.upsideStashes.forEach((player, index) => lines.push(waiverLine(player, index)));

  const coverage = context.modelCoverage;
  lines.push(
    "",
    "MODEL NOTES",
    "Week projections and ROS: Sleeper, with Adineu usage blend on distant weeks when available.",
    "Usage/xFP/signals and waiver Market/Capture/Priority: Adineu estimates, not official NFL or Sleeper values.",
    `Coverage: projections ${coverage.projections || "n/d"}; usage ${coverage.usageStats || "n/d"}; player status ${coverage.playerIndex ? "available" : "unavailable"}; degraded=${coverage.degraded}.`,
    "Missing values are shown as n/d; no injury return date or auction-win probability is inferred."
  );
  return lines.join("\n");
}
