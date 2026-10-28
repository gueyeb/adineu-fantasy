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

/** Explicit `nflTeam: null` = Sleeper lists no NFL team (unsigned). Undefined = unknown, never zeroed. */
export const hasNoNflTeam = player => Object.hasOwn(player ?? {}, "nflTeam") && (player.nflTeam === null || player.nflTeam === "");

/**
 * Four weeks a trade reading must keep apart: data through (last completed week), live week,
 * target week (a manager's choice) and the first week each traded player can play for his new team
 * under the conditional hypothesis of an agreement now (review end, then first kickoff after it).
 * A player whose game this week starts before the review ends stays with his old team that week.
 * Never an execution or processing promise; without fresh rules/schedule the simulation keeps the
 * live week and says so.
 */
export function tradeWeekFrame({ players = [], currentWeek, targetWeek = null, dataThroughWeek = null, context = null, now = Date.now() }) {
  const frame = (status, reasons, rows = [], extra = {}) => ({
    dataThroughWeek: Number.isInteger(dataThroughWeek) ? dataThroughWeek : Number.isInteger(context?.dataThroughWeek) ? context.dataThroughWeek : null,
    liveWeek: Number.isInteger(currentWeek) ? currentWeek : null,
    targetWeek: Number.isInteger(targetWeek) ? targetWeek : null,
    firstAffectableWeek: null, status, reasons, players: rows,
    simulationBasis: "LIVE_WEEK_ASSUMED_TIMING_UNVERIFIED", earliestReviewEndAt: null, asOf: context?.asOf ?? null, ...extra,
    note: "Sous hypothèse d’accord maintenant, revue en tranches de 24 h ; traitement exact, veto, locks et AutoSubs non vérifiés. Aucune exécution confirmée."
  });
  if (!Number.isInteger(currentWeek)) return frame("UNVERIFIED", ["TIMING_WEEK_INVALID"]);
  if (!context || !Number.isFinite(now)) return frame("UNVERIFIED", ["TIMING_EVIDENCE_MISSING"]);
  const captured = Date.parse(context.asOf);
  if (!Number.isFinite(captured) || now < captured || now - captured > 5 * 60_000) return frame("UNVERIFIED", ["TIMING_EVIDENCE_STALE"]);
  if (context.disabled === true || (Number.isInteger(context.deadlineWeek) && context.deadlineWeek > 0 && currentWeek > context.deadlineWeek)) return frame("BLOCKED", ["TRADES_CLOSED"], [], { simulationBasis: "NO_AFFECTABLE_WEEK" });
  if (!Number.isInteger(context.reviewDays) || context.reviewDays < 0 || context.reviewDays > 30 || !Array.isArray(context.games)) return frame("UNVERIFIED", ["TIMING_RULES_MISSING"]);
  const earliest = now + context.reviewDays * 86400_000;
  const rows = players.map(player => {
    const playerId = String(player.sleeperId ?? player.id ?? player.name ?? "");
    if (hasNoNflTeam(player)) return { playerId, name: player.name, firstAffectableWeek: null, reason: "NO_NFL_TEAM" };
    const games = context.games.filter(game => game.season === context.season && [game.home_team, game.away_team].includes(player.nflTeam) && Number.isFinite(Date.parse(game.kickoffAt)));
    if (!games.length) return { playerId, name: player.name, firstAffectableWeek: null, reason: "SCHEDULE_MISSING" };
    const next = games.filter(game => game.week >= currentWeek && Date.parse(game.kickoffAt) > earliest).sort((a, b) => a.week - b.week)[0];
    const thisWeek = games.find(game => game.week === currentWeek);
    return { playerId, name: player.name, firstAffectableWeek: next?.week ?? null, kickoffAt: next?.kickoffAt ?? null,
      reason: !next ? "NO_GAME_AFTER_REVIEW" : thisWeek && Date.parse(thisWeek.kickoffAt) <= earliest ? "LIVE_WEEK_GAME_BEFORE_REVIEW_END" : !thisWeek && next.week > currentWeek ? "BYE_THIS_WEEK" : null };
  });
  if (rows.some(row => row.reason === "SCHEDULE_MISSING")) return frame("UNVERIFIED", ["TRADE_SCHEDULE_INCOMPLETE"], rows);
  const weeks = rows.map(row => row.firstAffectableWeek).filter(Number.isInteger);
  return frame("CONDITIONAL", rows.some(row => row.reason === "NO_NFL_TEAM") ? ["NO_NFL_TEAM_COUNTED_AS_ZERO"] : [], rows, {
    firstAffectableWeek: weeks.length ? Math.min(...weeks) : null, earliestReviewEndAt: new Date(earliest).toISOString(),
    simulationBasis: "PER_PLAYER_FIRST_AFFECTABLE_WEEK" });
}

export function formatTradeWeekFrame(frame) {
  if (!frame) return "Semaines du trade non déterminées.";
  const week = value => Number.isInteger(value) ? `S${value}` : "n/d";
  const head = `Données jusqu’à ${week(frame.dataThroughWeek)} · semaine live ${week(frame.liveWeek)} · cible ${frame.targetWeek === null ? "aucune" : week(frame.targetWeek)} · première semaine affectable ${week(frame.firstAffectableWeek)}`;
  if (frame.status === "BLOCKED") return `${head}. Nouveaux trades fermés selon les réglages ; aucune semaine affectable.`;
  if (frame.status !== "CONDITIONAL") return `${head}. Fenêtre non vérifiée : la simulation part de la semaine live par hypothèse.`;
  const late = frame.players.filter(row => Number.isInteger(row.firstAffectableWeek) && row.firstAffectableWeek > frame.liveWeek);
  const absent = frame.players.filter(row => row.reason === "NO_NFL_TEAM");
  return `${head} (conditionnelle : accord maintenant, revue modélisée).${late.length ? ` Reste à l’ancienne équipe avant : ${late.slice(0, 4).map(row => `${row.name} S${row.firstAffectableWeek}`).join(", ")}.` : ""}${absent.length ? ` Sans équipe NFL, compté 0 : ${absent.map(row => row.name).join(", ")}.` : ""} Exécution non confirmée.`;
}
