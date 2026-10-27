/** Conservative screening of a hypothetical cut, never a platform execution authorization. */
export function assessTradeCut(player, { week, context = null, now = Date.now() } = {}) {
  const unknown = reason => ({ status: "UNVERIFIED", reason, excludedByPolicy: false, canDropNow: null });
  if (!context || !Number.isInteger(week)) return unknown("CUT_EVIDENCE_MISSING");
  const captured = Date.parse(context.asOf);
  if (!Number.isFinite(captured) || !Number.isFinite(now) || now < captured || now - captured > 300000) return unknown("CUT_EVIDENCE_STALE");
  if (context.movesDisabled === true) return { status: "MOVES_DISABLED", reason: "LEAGUE_MOVES_DISABLED", excludedByPolicy: true, canDropNow: null };
  const games = (Array.isArray(context.games) ? context.games : []).filter(game => game.season === context.season && game.week === week && [game.home_team, game.away_team].includes(player.nflTeam));
  const kickoff = games.length === 1 ? Date.parse(games[0].kickoffAt) : NaN;
  if (!Number.isFinite(kickoff)) return unknown("CUT_KICKOFF_UNVERIFIED");
  const started = kickoff <= now;
  return { status: started ? "GAME_STARTED_REVIEW" : "PREGAME_REVIEW", reason: started ? "EXCLUDED_PENDING_PLATFORM_CHECK" : "PLATFORM_LOCKS_UNVERIFIED", excludedByPolicy: started, canDropNow: null,
    kickoffAt: games[0].kickoffAt, asOf: context.asOf, source: games[0].source || null,
    autoSubs: context.maxSubs > 0 ? "ASSIGNMENTS_UNVERIFIED" : "NOT_VERIFIED", note: "Filtre prudent, pas une règle de drop universelle. Vérifier Sleeper, AutoSubs et locks au moment de la coupe." };
}
