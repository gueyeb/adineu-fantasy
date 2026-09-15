export function buildCoachPlan({ context, lineup, waivers, trades }) {
  const needs = new Set(trades.results?.[0]?.diagnosis?.deficits || []);
  const rankedWaivers = Object.values(waivers.byPosition || {})
    .flat()
    .filter(player => player.waiver?.category !== "PROFONDEUR")
    .sort((a, b) => (b.waiver?.score || 0) - (a.waiver?.score || 0))
    .filter(player => needs.size === 0 || needs.has(player.position));
  const seenPositions = new Set();
  const waiverTargets = rankedWaivers.filter(player => {
    if (seenPositions.has(player.position)) return false;
    seenPositions.add(player.position);
    return true;
  }).slice(0, 3);
  const trade = trades.results?.[0]?.proposals?.[0] || null;
  const priorities = [];

  if (lineup.alerts?.length) priorities.push({ type: "LINEUP", level: "URGENT", count: lineup.alerts.length });
  if (waiverTargets.length) priorities.push({ type: "WAIVERS", level: "ACTION", count: waiverTargets.length });
  if (trade) priorities.push({ type: "TRADE", level: "OPTION", count: 1 });
  if (!priorities.length) priorities.push({ type: "HOLD", level: "OK", count: 0 });

  return {
    generatedAt: new Date().toISOString(),
    week: context.week,
    team: context.myTeam.teamName,
    owner: context.myTeam.owner,
    priorities,
    lineupAlerts: lineup.alerts || [],
    waiverTargets,
    tradeTarget: trade,
    dataNotes: [
      `Projections Sleeper semaine ${context.week}`,
      waivers.lastCompletedWeek ? `Production réelle jusqu'à la semaine ${waivers.lastCompletedWeek}` : "Aucun match terminé intégré",
      "ECR/ADP pré-saison utilisés seulement comme ancre"
    ]
  };
}

export function formatCoachPlan(plan) {
  const lines = [`🧠 COACH ${plan.team.toUpperCase()} — SEMAINE ${plan.week}`];
  if (plan.lineupAlerts.length) lines.push("", `🚨 ${plan.lineupAlerts.length} alerte(s) lineup à régler`);
  if (plan.waiverTargets.length) {
    lines.push("", "🎯 CIBLES WAIVERS");
    plan.waiverTargets.forEach((player, index) => lines.push(
      `${index + 1}. ${player.name} (${player.position}) · ${player.waiver.category} · FAAB ${player.waiver.faabPct[0]}–${player.waiver.faabPct[1]}%`
    ));
  }
  if (plan.tradeTarget) lines.push("", "🤝 TRADE À EXPLORER", `${plan.tradeTarget.partnerName} · ${plan.tradeTarget.title}`);
  if (!plan.lineupAlerts.length && !plan.waiverTargets.length && !plan.tradeTarget) lines.push("", "✅ Aucun mouvement prioritaire : conserve ton roster.");
  return lines.join("\n");
}
