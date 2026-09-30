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

function topWaivers(report, limit = 10) {
  return Object.values(report?.byPosition || {}).flat()
    .filter(player => player?.waiver)
    .sort((a, b) => {
      const aFit = a.waiver.fit || {};
      const bFit = b.waiver.fit || {};
      return (Number(bFit.gainPerWeek || 0) - Number(aFit.gainPerWeek || 0)) ||
        (Number(bFit.fitScore || 0) - Number(aFit.fitScore || 0)) ||
        (Number(b.waiver.score || 0) - Number(a.waiver.score || 0));
    })
    .slice(0, limit)
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
      category: player.waiver.category,
      faabMarket: player.waiver.faabMarket,
      fitScore: player.waiver.fit?.fitScore ?? null,
      lineupGain: round(player.waiver.fit?.gainPerWeek),
      fitSlot: player.waiver.fit?.slot || null,
      maxForTeam: player.waiver.fit?.faabMaxForMe ?? null,
      opportunityDuration: player.waiver.duration || null,
      reasons: player.waiver.reasons || []
    }));
}

export function buildDecisionContext({ context, playerValues = {}, statuses = new Map(), waivers = null, lineup = null }) {
  const valuesById = playerValues.byId || new Map();
  const projections = playerValues.weeklyProjections || {};
  const enrich = player => playerDecisionView(player, valuesById, projections, statuses);
  return {
    ...context,
    mode: "decision",
    dataThroughWeek: waivers?.lastCompletedWeek ?? null,
    myTeam: {
      ...context.myTeam,
      starters: context.myTeam.starters.map(entry => ({ ...entry, player: enrich(entry.player) })),
      bench: context.myTeam.bench.map(enrich),
      ir: context.myTeam.ir.map(enrich)
    },
    lineup: lineup || { alerts: [], optimal: null },
    topAvailable: topWaivers(waivers),
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
    `proj=${metric(player.weekProjection)}`,
    `ROS=${metric(player.rosPpg)}`,
    `usage=${metric(player.usageScore)}`,
    `trend=${metric(player.usageTrend)}`,
    `xFP=${metric(player.xfp)}`,
    `actual=${metric(player.actualPpg)}`,
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
    "ROSTER — PROJECTIONS & USAGE"
  ];

  for (const starter of context.myTeam.starters) lines.push(decisionPlayerLine(starter.slot, starter.player));
  lines.push("", "BENCH");
  for (const player of context.myTeam.bench) lines.push(decisionPlayerLine(player.position || "FLEX", player));
  lines.push("", "IR");
  if (!context.myTeam.ir.length) lines.push("EMPTY");
  for (const player of context.myTeam.ir) lines.push(decisionPlayerLine(player.position || "FLEX", player));

  lines.push("", "LINEUP ALERTS");
  if (!context.lineup?.alerts?.length) lines.push("None");
  for (const alert of context.lineup?.alerts || []) {
    const replacement = alert.replacement?.player?.name ? ` | replacement=${alert.replacement.player.name}` : "";
    lines.push(`${alert.severity} | ${alert.slot} | ${alert.player?.name || "EMPTY"} | ${alert.reason}${replacement}`);
  }
  if (context.lineup?.optimal) {
    lines.push(`Optimal lineup gain: ${metric(context.lineup.optimal.gain, " pts")}`);
  }

  lines.push("", `TOP AVAILABLE — FIT FOR ${context.myTeam.teamName.toUpperCase()}`);
  if (!context.topAvailable.length) lines.push("Unavailable");
  context.topAvailable.forEach((player, index) => {
    lines.push(`${index + 1}. ${player.name} ${player.position} ${player.nflTeam || "FA"} | Market=${player.marketScore} | Fit=${metric(player.fitScore)} | Gain=${metric(player.lineupGain, " pts/w")} | FAAB=${player.faabMarket?.join("–") || "n/d"} $ | Max=${metric(player.maxForTeam, " $")} | ROS=${metric(player.rosPpg)} | Usage=${metric(player.usageScore)} | Signal=${player.usageSignal || "none"}${player.reasons.length ? ` | ${player.reasons.join("; ")}` : ""}`);
  });

  const coverage = context.modelCoverage;
  lines.push(
    "",
    "MODEL NOTES",
    "Week projections and ROS: Sleeper, with Adineu usage blend on distant weeks when available.",
    "Usage/xFP/signals and waiver Market/Fit: Adineu estimates, not official NFL or Sleeper values.",
    `Coverage: projections ${coverage.projections || "n/d"}; usage ${coverage.usageStats || "n/d"}; player status ${coverage.playerIndex ? "available" : "unavailable"}; degraded=${coverage.degraded}.`,
    "Missing values are shown as n/d; no injury return date or auction-win probability is inferred."
  );
  return lines.join("\n");
}
