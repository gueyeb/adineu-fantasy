/**
 * Adineu Fantasy — recent transactions for one team, from raw Sleeper transaction rows
 * (GET /league/{id}/transactions/{leg}, one call per week — see docs/prd-team-page-increment3.md
 * for why this page only fetches a 3-week rolling window rather than the full season).
 *
 * Pure filtering/shaping only — no I/O. Reuses roster-view.js's resolvePlayer so player lookups
 * stay consistent with the rest of the page (roster grid, alerts) rather than a 2nd lookup path.
 */
import { resolvePlayer } from "./roster-view.js?v=2";

/** Completed transactions involving this roster, most recent first. Failed waiver claims are not real moves. */
export function filterTeamTransactions(rows, rosterId) {
  return (rows || [])
    .filter(row => row?.status === "complete" && Array.isArray(row.roster_ids) && row.roster_ids.includes(rosterId))
    .sort((a, b) => Number(b.created) - Number(a.created));
}

/**
 * Shapes one raw transaction from THIS roster's perspective: which players it gained/lost (adds/
 * drops are keyed by player_id -> destination/source roster_id, so filtering on rosterId works
 * identically for waivers, free agents, and trades — no special-casing by type needed), the FAAB
 * spent (waivers only), and the other roster_ids involved (populated for trades).
 */
export function describeTransaction(row, { rosterId, playerMap }) {
  const added = Object.entries(row.adds || {})
    .filter(([, toRoster]) => toRoster === rosterId)
    .map(([playerId]) => ({ playerId, player: resolvePlayer(playerMap, playerId) }));
  const dropped = Object.entries(row.drops || {})
    .filter(([, fromRoster]) => fromRoster === rosterId)
    .map(([playerId]) => ({ playerId, player: resolvePlayer(playerMap, playerId) }));
  const faabSpent = row.type === "waiver" ? Number(row.settings?.waiver_bid) : null;
  return {
    transactionId: row.transaction_id,
    type: row.type,
    createdAt: Number(row.created),
    added,
    dropped,
    faabSpent: Number.isFinite(faabSpent) ? faabSpent : null,
    otherRosterIds: (row.roster_ids || []).filter(id => id !== rosterId)
  };
}
