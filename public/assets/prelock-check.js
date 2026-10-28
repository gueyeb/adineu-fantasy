/** Pure pre-lock orchestration. Advisor functions are injected to keep Node I/O out of this module. */
import { teamOwnerLabel } from "./manager-identity.js?v=7f451cdf4d";

export function buildPrelockCheck({ week, myTeam, playerStatuses = new Map(), projections = {}, schedule,
  now, byeWeeks = {}, freeAgentsByPosition = {} }, { diagnoseLineup, compareWithOptimalLineup, formatReplacement }) {
  const checkedAt = new Date(now).toISOString();
  const time = Date.parse(checkedAt);
  const games = schedule.filter(game => Number(game.week) === Number(week));
  if (!games.length) throw new Error("Calendrier NFL indisponible pour cette semaine.");
  const kickoff = player => Date.parse(games.find(game => [game.home_team, game.away_team].includes(player?.nflTeam))?.kickoffAt);
  const unlocked = player => kickoff(player) > time && byeWeeks[player.nflTeam] !== week;
  const locked = myTeam.starters.filter(row => row.player && kickoff(row.player) <= time);
  const counts = {};
  const fixedSlots = {};
  for (const row of myTeam.starters) {
    counts[row.slot] = (counts[row.slot] || 0) + 1;
    const repeated = myTeam.starters.filter(other => other.slot === row.slot).length > 1;
    const slot = repeated ? `${row.slot}${counts[row.slot]}` : row.slot;
    if (row.player && (kickoff(row.player) <= time || (!Number.isFinite(kickoff(row.player)) && byeWeeks[row.player.nflTeam] !== week))) fixedSlots[slot] = row.player.sleeperId;
  }
  const bench = (myTeam.bench || []).filter(unlocked).map(player => ({ ...player, projectedPpg: projections[player.sleeperId]?.pts_ppr }));
  const market = Object.fromEntries(Object.entries(freeAgentsByPosition).map(([position, rows]) => [position, rows.filter(player => unlocked(player) && !playerStatuses.has(player.sleeperId)).map(player => ({ ...player, projectedPpg: projections[player.sleeperId]?.pts_ppr }))]));
  const used = new Set();
  const alerts = [];
  for (const starter of myTeam.starters) {
    if (locked.includes(starter)) continue;
    const fallbackBench = bench.filter(player => !used.has(player.sleeperId));
    // Prefer a fallback who can still be started when the questionable player's status is known.
    const eligible = player => starter.slot === "FLEX" ? ["RB", "WR", "TE"].includes(player.position) : player.position === starter.slot;
    const laterBench = fallbackBench.filter(player => eligible(player) && !playerStatuses.has(player.sleeperId) && kickoff(player) >= kickoff(starter.player));
    const candidates = playerStatuses.get(starter.player?.sleeperId) === "Questionable" && laterBench.length ? laterBench : fallbackBench;
    const diagnosis = diagnoseLineup({ myTeam: { starters: [starter], bench: candidates }, playerStatuses,
      freeAgentsByPosition: Object.fromEntries(Object.entries(market).map(([pos, rows]) => [pos, rows.filter(player => !used.has(player.sleeperId))])), byeWeeks, currentWeek: week, preferProjection: true });
    for (const alert of diagnosis.alerts) {
      const replacement = alert.replacement?.player;
      if (replacement) used.add(replacement.sleeperId);
      const incoming = projections[replacement?.sleeperId]?.pts_ppr;
      const outgoing = alert.player ? projections[alert.player.sleeperId]?.pts_ppr : 0;
      const delta = Number.isFinite(incoming) && Number.isFinite(outgoing) ? Number((incoming - outgoing).toFixed(1)) : null;
      alerts.push({ ...alert, advice: alert.advice || formatReplacement(alert), delta });
    }
  }
  // Locked/unknown starters stay in their exact slot; only verified future games enter the bench pool.
  const effectiveProjections = { ...projections };
  for (const row of myTeam.starters) if (row.player && byeWeeks[row.player.nflTeam] === week) effectiveProjections[row.player.sleeperId] = { pts_ppr: 0 };
  const covered = [...myTeam.starters.map(row => row.player), ...bench].filter(Boolean)
    .every(player => Number.isFinite(effectiveProjections[player.sleeperId]?.pts_ppr));
  const optimal = compareWithOptimalLineup({ myTeam: { ...myTeam, bench }, projections: effectiveProjections, playerStatuses, fixedSlots });
  const swaps = alerts.filter(alert => alert.replacement && alert.replacementRole === "REPLACE").map(alert => ({ slot: alert.slot, out: alert.player, in: alert.replacement.player, source: alert.replacement.source, delta: alert.delta }));
  const lines = [`Contrôle avant verrouillage — S${week}${myTeam.teamName ? ` — ${teamOwnerLabel(myTeam.teamName, myTeam.owner)}` : ""}`];
  if (!alerts.length) lines.push("✅ Lineup OK");
  for (const alert of alerts) lines.push(`${alert.severity === "WATCH" ? "🟡" : "🔴"} ${alert.slot} ${alert.player?.name || "Slot vide"} (${alert.reason}) → ${alert.advice || "aucun remplaçant disponible"}${alert.delta === null ? "" : ` · Δ proj. Sleeper ${alert.delta >= 0 ? "+" : ""}${alert.delta} pts`}`);
  if (covered && optimal.gain > 0.5) {
    const moves = [...optimal.promote].map(player => `${player.name} titulaire`).concat(optimal.bench.filter(Boolean).map(player => `${player.name} au banc`));
    lines.push(`Points gagnés si optimal : +${optimal.gain} (projections Sleeper)${moves.length ? ` — ${moves.join(", ")}` : ""}`);
  }
  const next = games.map(game => Date.parse(game.kickoffAt)).filter(at => at > time).sort((a, b) => a - b)[0];
  lines.push(next ? `Prochain coup d’envoi : ${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(next)} (Paris)` : "Aucun coup d’envoi restant cette semaine.");
  return { week, checkedAt, locked, alerts, swaps, optimalGain: covered ? optimal.gain : null, ok: alerts.length === 0, message: lines.join("\n") };
}
