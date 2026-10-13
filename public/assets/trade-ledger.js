/**
 * Adineu Fantasy — classement des trades par manager (docs/prd-trade-ledger.md).
 *
 * Source 2019–2025 : `public/data/yahoo-trades.json` (pages Transactions de Yahoo). Saison en
 * cours : transactions Sleeper de type `trade`. Un trade compte une fois pour chaque manager
 * impliqué. Pure functions, no I/O.
 */

/**
 * Completed Sleeper trades as ledger entries. A trade with a roster that maps to no canonical
 * manager is left out and counted in `unmapped` — never attributed to a guessed identity.
 */
export function buildSleeperTrades(transactions, managerByRosterId) {
  const trades = [];
  let unmapped = 0;
  const seen = new Set();
  for (const row of transactions || []) {
    if (row?.type !== "trade" || row.status !== "complete" || seen.has(row.transaction_id)) continue;
    seen.add(row.transaction_id);
    const managers = [...new Set((row.roster_ids || []).map(id => managerByRosterId.get(Number(id)) ?? null))];
    if (managers.length < 2 || managers.includes(null)) { unmapped += 1; continue; }
    trades.push({ date: new Date(Number(row.created)).toISOString().slice(0, 10), sides: managers.map(manager => ({ manager })) });
  }
  return { trades: trades.sort((a, b) => a.date.localeCompare(b.date)), unmapped };
}

const pairKey = (a, b) => [a, b].sort((x, y) => x.localeCompare(y, "fr")).join("|");

/**
 * @param {Array<{year:number, trades:Array<{sides:Array<{manager:string}>}>}>} seasons
 * @param {Object} [options]
 * @param {Map<string, number>} [options.seasonsPlayed] manager -> seasons played, for the per-season rate
 */
export function buildTradeRanking(seasons, { seasonsPlayed = new Map() } = {}) {
  const years = (seasons || []).map(season => season.year).sort((a, b) => a - b);
  const byManager = new Map();
  const pairs = new Map();
  const entry = manager => {
    if (!byManager.has(manager)) byManager.set(manager, { manager, trades: 0, bySeason: {}, partners: new Map() });
    return byManager.get(manager);
  };
  let totalTrades = 0;
  for (const season of seasons || []) {
    for (const trade of season.trades || []) {
      const managers = [...new Set(trade.sides.map(side => side.manager))];
      totalTrades += 1;
      for (const manager of managers) {
        const row = entry(manager);
        row.trades += 1;
        row.bySeason[season.year] = (row.bySeason[season.year] || 0) + 1;
        for (const other of managers) if (other !== manager) row.partners.set(other, (row.partners.get(other) || 0) + 1);
      }
      for (let i = 0; i < managers.length; i++) {
        for (let j = i + 1; j < managers.length; j++) {
          const key = pairKey(managers[i], managers[j]);
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      }
    }
  }

  const sorted = [...byManager.values()].sort((a, b) => b.trades - a.trades || a.manager.localeCompare(b.manager, "fr"));
  const managers = sorted.map((row, index) => {
    const partners = [...row.partners.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
    const played = seasonsPlayed.get(row.manager) || null;
    return {
      // Equal totals share a rank.
      rank: index > 0 && sorted[index - 1].trades === row.trades ? null : index + 1,
      manager: row.manager,
      trades: row.trades,
      bySeason: row.bySeason,
      seasonsPlayed: played,
      perSeason: played ? Number((row.trades / played).toFixed(1)) : null,
      topPartner: partners.length ? { manager: partners[0][0], trades: partners[0][1] } : null
    };
  });
  for (let i = 1; i < managers.length; i++) if (managers[i].rank === null) managers[i].rank = managers[i - 1].rank;

  const seasonTotals = years.map(year => ({ year, trades: (seasons.find(season => season.year === year).trades || []).length }));
  return {
    years,
    totalTrades,
    managers,
    pairs: [...pairs.entries()].map(([key, trades]) => ({ managers: key.split("|"), trades }))
      .sort((a, b) => b.trades - a.trades || a.managers.join().localeCompare(b.managers.join(), "fr")),
    seasonTotals,
    busiestSeason: seasonTotals.reduce((best, season) => (!best || season.trades > best.trades ? season : best), null)
  };
}
