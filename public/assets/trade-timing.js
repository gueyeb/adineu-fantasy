/** Timing is a lower bound conditional on acceptance now, never a processing promise. */
export function assessTradeTiming({ players = [], targetWeek, currentWeek, context = null, now = Date.now() }) {
  const unknown = reasons => ({ status: "UNVERIFIED", reasons, earliestPossibleWeek: null, players: [], earliestReviewEndAt: null });
  if (!context || !Number.isFinite(now) || !Number.isInteger(targetWeek)) return unknown(["TIMING_EVIDENCE_MISSING"]);
  if (!Number.isInteger(currentWeek) || !Number.isInteger(context.season) || targetWeek < currentWeek) return unknown(["TIMING_WEEK_INVALID"]);
  const captured = Date.parse(context.asOf);
  if (!Number.isFinite(captured) || now < captured || now - captured > 5 * 60_000) return unknown(["TIMING_EVIDENCE_STALE"]);
  if (context.disabled === true || (Number.isInteger(context.deadlineWeek) && context.deadlineWeek > 0 && currentWeek > context.deadlineWeek)) {
    return { ...unknown(["TRADES_CLOSED"]), status: "BLOCKED" };
  }
  if (!Number.isInteger(context.reviewDays) || context.reviewDays < 0 || context.reviewDays > 30 || !Number.isInteger(context.deadlineWeek) || context.deadlineWeek < 0 || typeof context.disabled !== "boolean" || !Array.isArray(context.games)) return unknown(["TIMING_RULES_MISSING"]);
  // Sleeper may process after the review interval; no rounding to an invented midnight/timezone.
  const earliest = now + context.reviewDays * 86400_000;
  const rows = players.map(player => {
    const games = context.games.filter(game => game.season === context.season && [game.home_team, game.away_team].includes(player.nflTeam));
    const target = games.filter(game => game.week === targetWeek);
    const kickoff = target.length === 1 ? Date.parse(target[0].kickoffAt) : NaN;
    const candidates = games.filter(game => game.week >= Math.max(currentWeek, targetWeek) && Number.isFinite(Date.parse(game.kickoffAt)) && Date.parse(game.kickoffAt) > earliest).sort((a, b) => a.week - b.week);
    return { playerId: String(player.sleeperId ?? player.id ?? ""), name: player.name, kickoffAt: Number.isFinite(kickoff) ? target[0].kickoffAt : null,
      status: !Number.isFinite(kickoff) ? "UNVERIFIED" : kickoff <= earliest ? "TARGET_WINDOW_PASSED" : "CONDITIONAL",
      earliestPossibleWeek: candidates[0]?.week ?? null };
  });
  const blocked = rows.some(row => row.status === "TARGET_WINDOW_PASSED");
  const missing = !rows.length || rows.some(row => row.status === "UNVERIFIED");
  return { status: blocked ? "BLOCKED" : missing ? "UNVERIFIED" : "CONDITIONAL", reasons: blocked ? ["TARGET_KICKOFF_BEFORE_REVIEW_END"] : missing ? ["TARGET_SCHEDULE_INCOMPLETE"] : [],
    earliestReviewEndAt: new Date(earliest).toISOString(), earliestPossibleWeek: rows.length && rows.every(row => row.earliestPossibleWeek !== null) ? Math.max(...rows.map(row => row.earliestPossibleWeek)) : null,
    players: rows, asOf: context.asOf, ruleSource: context.ruleSource, note: "Sous hypothèse d’accord maintenant, sans veto ni intervention du commissaire. Durée de revue modélisée en tranches de 24 h, sans horaire de traitement garanti ; traitement exact, santé et activation IR non confirmés." };
}

export function formatTradeTiming(timing) {
  if (!timing || timing.status === "UNVERIFIED") return "Fenêtre de trade non vérifiée : règles, horaires ou fraîcheur insuffisants.";
  if (timing.reasons.includes("TRADES_CLOSED")) return "Nouveaux trades fermés selon les réglages disponibles ; aucun accord antérieur supposé.";
  const blocked = timing.players.filter(row => row.status === "TARGET_WINDOW_PASSED");
  const candidates = blocked.slice(0, 3).map(row => `${row.name} : fenêtre cible dépassée${row.earliestPossibleWeek ? `, première candidate S${row.earliestPossibleWeek}` : ""}`).join(" · ");
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timing.earliestReviewEndAt));
  return `${candidates || "Fenêtre cible possible sous conditions"}${blocked.length > 3 ? ` · ${blocked.length - 3} autre(s) joueur(s) concerné(s)` : ""}. Accord supposé maintenant ; revue modélisée (24 h/jour) jusqu’au ${date} Paris au plus tôt. Traitement exact et disponibilité non confirmés.`;
}
