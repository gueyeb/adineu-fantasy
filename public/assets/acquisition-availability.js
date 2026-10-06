/** A drop never proves waiver clearance. Evidence must belong to this week and still be current. */
export function isCurrentEvidence(evidence, { asOf, week, season, leagueId } = {}) {
  const now = Date.parse(asOf);
  const observed = Date.parse(evidence?.observedAt);
  const expires = Date.parse(evidence?.expiresAt);
  return Boolean(evidence?.source && Number.isFinite(now) && Number.isFinite(observed) && observed <= now &&
    Number.isFinite(expires) && expires > now && expires > observed &&
    (week === undefined || evidence.targetWeek === week) &&
    (season === undefined || String(evidence.season) === String(season)) &&
    (leagueId === undefined || String(evidence.leagueId) === String(leagueId)));
}

/** Latest complete movement per player inside the window, kept only when it is a DROP.
 * A later ADD by any roster supersedes it. The result never proves waiver clearance. */
export function findRecentDrops(transactions, { asOf, windowHours = 72 } = {}) {
  const now = Date.parse(asOf);
  const latest = new Map();
  for (const t of transactions || []) {
    const at = Number(t.status_updated ?? t.created);
    if (t.status !== "complete" || !Number.isFinite(at) || !Number.isFinite(now) || at > now || at < now - windowHours * 3600 * 1000) continue;
    for (const [action, moves] of [["ADD", t.adds], ["DROP", t.drops]]) {
      for (const [playerId, rosterId] of Object.entries(moves || {})) {
        const previous = latest.get(playerId);
        // Within one transaction the ADD wins: the player ends up rostered.
        if (!previous || at > previous.at || (at === previous.at && action === "ADD")) latest.set(playerId, { action, at, rosterId, transactionId: t.transaction_id ?? null });
      }
    }
  }
  return new Map([...latest].filter(([, move]) => move.action === "DROP").map(([playerId, move]) =>
    [playerId, { droppedAt: new Date(move.at).toISOString(), droppedByRosterId: move.rosterId, transactionId: move.transactionId }]));
}

export function resolveAcquisitionAvailability({ playerId, rosters, evidence = {}, kickoffAt = null, kickoffSource = null, asOf, week, season, leagueId, latestTransactionAt = null, recentDrop = null }) {
  const owner = rosters.find(roster => (roster.players || []).map(String).includes(String(playerId)));
  const current = isCurrentEvidence(evidence, { asOf, week, season, leagueId }) &&
    (!latestTransactionAt || Date.parse(evidence.observedAt) >= Number(latestTransactionAt));
  const kickoffValue = kickoffAt || (current ? evidence.kickoffAt : null);
  const kickoff = Date.parse(kickoffValue);
  const now = Date.parse(asOf);
  const processes = Date.parse(current ? evidence.waiverProcessesAt : null);
  const availability = owner ? "ROSTERED" : Number.isFinite(kickoff) && kickoff <= now ? "GAME_LOCKED"
    : current && ["FREE_AGENT", "WAIVER_LOCKED"].includes(evidence.availability) ? evidence.availability : "UNKNOWN";
  const canAddNow = availability === "FREE_AGENT";
  const canStartTargetWeek = owner || availability === "GAME_LOCKED" ? false : Number.isFinite(kickoff)
    ? canAddNow ? true : availability === "WAIVER_LOCKED" && Number.isFinite(processes) ? processes > now && processes < kickoff : null : null;
  const coverageIssues = [];
  if (availability === "UNKNOWN") coverageIssues.push("WAIVER_STATE_UNVERIFIED");
  if (!Number.isFinite(kickoff)) coverageIssues.push("KICKOFF_UNVERIFIED");
  if (availability === "WAIVER_LOCKED" && (!Number.isFinite(processes) || processes <= now)) coverageIssues.push("WAIVER_PROCESSING_UNVERIFIED");
  // A recent cut is a reason to analyse the player, never a proof that he can be added.
  const unclearedDrop = !owner && recentDrop && availability !== "FREE_AGENT" ? recentDrop : null;
  if (unclearedDrop && availability !== "WAIVER_LOCKED") coverageIssues.push("RECENT_DROP_CLEARANCE_UNVERIFIED");
  return { availability, recentDrop: owner ? null : recentDrop ?? null, ownerRosterId: owner?.roster_id ?? null, ownerId: owner?.owner_id ?? null, canAddNow, canStartTargetWeek,
    waiverProcessesAt: current ? evidence.waiverProcessesAt ?? null : null, kickoffAt: Number.isFinite(kickoff) ? kickoffValue : null,
    kickoffSource: kickoffSource || (current && evidence.kickoffAt ? evidence.source : null), availabilityAsOf: asOf,
    evidence: current ? [evidence] : [], coverageIssues };
}

export function resolveRoleEvidence(evidence, context) {
  if (!isCurrentEvidence(evidence, context) || evidence.roleConfirmation !== "CONFIRMED" || !evidence.announcedRole) {
    return { roleConfirmation: "UNCONFIRMED", evidence: [], announcedRole: null };
  }
  return { roleConfirmation: "CONFIRMED", evidence: [evidence], announcedRole: evidence.announcedRole,
    roleWeeks: Number.isInteger(evidence.roleWeeks) && evidence.roleWeeks > 0 ? evidence.roleWeeks : null };
}

export function summarizeRecentTransactions(transactions, { asOf, relevantIds = new Set(), limit = 30, playerMeta = () => null, rosterMeta = () => null, rosters = [], availabilityOf = () => null } = {}) {
  const cutoff = Date.parse(asOf) - 72 * 3600 * 1000;
  const recent = [...new Map(transactions.map(t => [t.transaction_id, t])).values()]
    .filter(t => Number(t.status_updated ?? t.created) >= cutoff && Number(t.status_updated ?? t.created) <= Date.parse(asOf))
    .sort((a, b) => Number(b.status_updated ?? b.created) - Number(a.status_updated ?? a.created));
  return { recentTransactions: recent.slice(0, limit).map(t => ({ ...t,
    movements: ['ADD', 'DROP'].flatMap(action => Object.entries(action === 'ADD' ? t.adds || {} : t.drops || {}).map(([playerId, rosterId]) => {
      const player = playerMeta(playerId);
      const identity = rosterMeta(rosterId);
      const owner = rosters.find(roster => (roster.players || []).some(id => String(id) === playerId));
      return { action, playerId, playerName: player?.name ?? null, rosterId,
        teamName: identity?.teamName ?? null, manager: identity?.manager ?? null,
        status: t.status ?? 'UNKNOWN', currentOwnerRosterId: owner?.roster_id ?? null,
        availability: owner ? 'ROSTERED' : availabilityOf(playerId)?.availability ?? 'UNKNOWN' };
    })),
    relevant: [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})].some(id => relevantIds.has(id)) })), transactionsTruncated: recent.length > limit, transactionsTruncatedCount: Math.max(0, recent.length - limit) };
}

export function formatRecentTransactions(transactions) {
  return transactions.flatMap(t => (t.movements || []).map(m =>
    `${m.playerName || `UNKNOWN player #${m.playerId}`} → ${m.action} par ${m.teamName || `UNKNOWN roster #${m.rosterId}`} (${m.manager || 'UNKNOWN manager'}) [${m.status}] · disponibilité actuelle : ${m.availability}`));
}

/** Next week's horizon for one NFL team from the loaded schedule: known only when that week is
 * actually present in it. A bye is a known horizon with no kickoff. */
export function nextWeekHorizon({ schedule = [], week, nflTeam }) {
  const startWeek = week + 1;
  const games = schedule.filter(game => game.week === startWeek);
  if (!games.length || !nflTeam) return null;
  const game = games.find(row => [row.away_team, row.home_team].includes(nflTeam));
  return { startWeek, firstKickoffAt: game?.kickoffAt ?? null, bye: !game, source: (game ?? games[0]).source ?? null };
}
