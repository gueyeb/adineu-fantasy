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

export function resolveAcquisitionAvailability({ playerId, rosters, evidence = {}, kickoffAt = null, kickoffSource = null, asOf, week, season, leagueId, latestTransactionAt = null }) {
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
  return { availability, ownerRosterId: owner?.roster_id ?? null, ownerId: owner?.owner_id ?? null, canAddNow, canStartTargetWeek,
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

export function summarizeRecentTransactions(transactions, { asOf, relevantIds = new Set(), limit = 30 } = {}) {
  const cutoff = Date.parse(asOf) - 72 * 3600 * 1000;
  const recent = [...new Map(transactions.map(t => [t.transaction_id, t])).values()]
    .filter(t => Number(t.status_updated ?? t.created) >= cutoff && Number(t.status_updated ?? t.created) <= Date.parse(asOf))
    .sort((a, b) => Number(b.status_updated ?? b.created) - Number(a.status_updated ?? a.created));
  return { recentTransactions: recent.slice(0, limit).map(t => ({ ...t, relevant: [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})].some(id => relevantIds.has(id)) })), transactionsTruncated: recent.length > limit, transactionsTruncatedCount: Math.max(0, recent.length - limit) };
}
