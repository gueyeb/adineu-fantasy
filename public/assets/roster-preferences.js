/** Explicit user preferences only: roster-scoped, dated, bounded and revocable. */
export function normalizeRosterPreferences(input, { asOf, rosterId }) {
  const now = Date.parse(asOf);
  if (!Array.isArray(input) || !Number.isFinite(now) || rosterId === undefined || rosterId === null) return [];
  return [...new Map(input.filter(row => {
    const created = Date.parse(row?.createdAt);
    const expires = Date.parse(row?.expiresAt);
    return row?.kind === "KEEP_UNTIL" && String(row.rosterId) === String(rosterId) &&
      typeof row.playerId === "string" && row.playerId.length > 0 && row.playerId.length <= 80 &&
      !row.revokedAt && Number.isFinite(created) && created <= now && Number.isFinite(expires) && expires > now &&
      Number.isFinite(row.penaltyPoints) && row.penaltyPoints >= 0 && row.penaltyPoints <= 100 &&
      typeof row.reason === "string" && row.reason.trim().length > 0 && row.reason.length <= 500;
  }).slice(0, 40).map(row => [row.playerId, { ...row, source: "USER_PREFERENCE" }])).values()];
}
