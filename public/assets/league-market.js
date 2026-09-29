/**
 * Adineu Fantasy — League market signals for the Waiver Wire (docs/benchmark-fantasylife.md, lot 1).
 *
 * Pure functions, no I/O:
 * - buildFaabHistory: every winning FAAB claim this season, from Sleeper /transactions/{week}
 *   (`settings.waiver_bid`). Real league prices — also the data to recalibrate PRICE_PER_POINT.
 * - summarizeFaabByPosition: count / median / max winning bid per position.
 * - buildTrendingAdds: Sleeper's platform-wide trending adds, crossed with this league's rosters
 *   and the waiver v2 model (market score, FAAB, news override) when the player is available.
 */

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Winning claims (status complete, type waiver), highest bid first. Failed claims are not prices. */
export function buildFaabHistory(transactionsByWeek = [], { playerMeta = () => null, rosterName = () => null } = {}) {
  const claims = [];
  for (const { week, transactions } of transactionsByWeek) {
    for (const transaction of Array.isArray(transactions) ? transactions : []) {
      if (transaction.type !== "waiver" || transaction.status !== "complete") continue;
      const bid = Number(transaction.settings?.waiver_bid);
      if (!Number.isFinite(bid)) continue;
      for (const [playerId, rosterId] of Object.entries(transaction.adds || {})) {
        const meta = playerMeta(playerId) || {};
        claims.push({
          week,
          playerId,
          name: meta.name || `Player #${playerId}`,
          position: meta.position || null,
          bid,
          rosterId,
          team: rosterName(rosterId)
        });
      }
    }
  }
  return claims.sort((a, b) => b.bid - a.bid || a.week - b.week || a.name.localeCompare(b.name));
}

export function summarizeFaabByPosition(claims = []) {
  const byPosition = {};
  for (const claim of claims) {
    if (!claim.position) continue;
    (byPosition[claim.position] ||= []).push(claim.bid);
  }
  return Object.fromEntries(Object.entries(byPosition).map(([position, bids]) => [position, {
    count: bids.length,
    median: median(bids),
    max: Math.max(...bids),
    total: bids.reduce((sum, bid) => sum + bid, 0)
  }]));
}

/** Trending adds (Sleeper platform-wide), flagged rostered-in-Adineu or joined to the v2 model row. */
export function buildTrendingAdds(trending = [], { rosteredIds = new Set(), rosterOf = () => null, playerMeta = () => null, modelRowOf = () => null, limit = 15 } = {}) {
  return (Array.isArray(trending) ? trending : []).slice(0, limit).map(({ player_id: playerId, count }) => {
    const meta = playerMeta(playerId) || {};
    const rostered = rosteredIds.has(playerId);
    const row = rostered ? null : modelRowOf(playerId);
    return {
      playerId,
      name: meta.name || `Player #${playerId}`,
      position: meta.position || null,
      nflTeam: meta.nflTeam || null,
      injuryStatus: meta.injuryStatus || null,
      adds: count,
      rostered,
      rosteredBy: rostered ? rosterOf(playerId) : null,
      waiver: row?.waiver || null
    };
  });
}
