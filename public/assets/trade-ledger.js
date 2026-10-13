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

/** Thursday kickoff of NFL week 1, and the last week of the league's fantasy playoffs. */
export const SEASON_CALENDAR = Object.freeze({
  2019: { week1: "2019-09-05", lastWeek: 16 },
  2020: { week1: "2020-09-10", lastWeek: 16 },
  2021: { week1: "2021-09-09", lastWeek: 17 },
  2022: { week1: "2022-09-08", lastWeek: 17 },
  2023: { week1: "2023-09-07", lastWeek: 17 },
  2024: { week1: "2024-09-05", lastWeek: 17 },
  2025: { week1: "2025-09-04", lastWeek: 17 }
});
// Starters per team at each position (FLEX split between RB and WR): the Nth scorer of a week is
// the replacement level, N = teams × slots.
export const REPLACEMENT_SLOTS = Object.freeze({ QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 });
// A side wins when its value beats the other by both margins; below that the trade is a wash.
export const VERDICT_MIN_VALUE = 15;
export const VERDICT_MIN_SHARE = 0.15;

/** First NFL week whose Thursday kickoff is on or after the trade date. */
export function tradeStartWeek(date, year) {
  const calendar = SEASON_CALENDAR[year];
  if (!calendar) return null;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${calendar.week1}T00:00:00Z`)) / 86_400_000);
  return Math.max(1, Math.ceil(days / 7) + 1);
}

/** Replacement level of one week: the score of the last startable player at the position. */
export function replacementLevel(scores, position, teamCount) {
  const rank = Math.round(teamCount * (REPLACEMENT_SLOTS[position] || 1));
  const sorted = [...scores].sort((a, b) => b - a);
  return sorted.length >= rank ? Math.max(0, sorted[rank - 1]) : 0;
}

/**
 * What each side's haul produced after the trade (docs/prd-trade-ledger.md), from the first week
 * after the trade to the league's last playoff week. `points` is the raw total; `value` only
 * counts what a player scored above the week's replacement level at his position, so a QB's big
 * totals do not outweigh a scarce running back. Each trade is judged on its own: a player traded
 * again later still counts here. Returns a copy of the season's trades with `outcome`.
 * @param {Function} pointsOf (sleeperId, week) -> points | null when he did not play
 * @param {Function} replacementOf (position, week) -> replacement points
 */
export function evaluateSeasonTrades(season, pointsOf, replacementOf = () => 0) {
  const calendar = SEASON_CALENDAR[season.year];
  return season.trades.map(trade => {
    const fromWeek = tradeStartWeek(trade.date, season.year);
    const sides = trade.sides.map(side => {
      const received = side.received.map(player => {
        if (!player.sleeperId) return { ...player, points: null, value: null, games: null };
        let points = 0;
        let value = 0;
        let games = 0;
        for (let week = fromWeek; week <= calendar.lastWeek; week++) {
          const scored = pointsOf(player.sleeperId, week);
          if (scored === null || scored === undefined) continue;
          points += scored;
          value += Math.max(0, scored - replacementOf(player.position, week));
          games += 1;
        }
        return { ...player, points: Number(points.toFixed(1)), value: Number(value.toFixed(1)), games };
      });
      const complete = received.every(player => player.value !== null);
      const total = key => (complete ? Number(received.reduce((sum, player) => sum + player[key], 0).toFixed(1)) : null);
      return { ...side, received, points: total("points"), value: total("value") };
    });
    return { ...trade, sides, outcome: verdictFor(sides, fromWeek, calendar.lastWeek) };
  });
}

function verdictFor(sides, fromWeek, lastWeek) {
  const base = { fromWeek, throughWeek: lastWeek, winner: null, margin: null };
  if (fromWeek > lastWeek) return { ...base, verdict: "NO_GAMES" };
  if (sides.some(side => side.value === null)) return { ...base, verdict: "INCOMPLETE" };
  const [a, b] = sides;
  const margin = Number(Math.abs(a.value - b.value).toFixed(1));
  const decisive = margin >= VERDICT_MIN_VALUE && margin >= VERDICT_MIN_SHARE * Math.max(a.value, b.value);
  return { ...base, margin, verdict: decisive ? "WON" : "EVEN", winner: decisive ? (a.value > b.value ? a.manager : b.manager) : null };
}

/** Win / loss / even record per manager over evaluated trades; `net` is value gained minus given. */
export function buildTradeRecords(seasons) {
  const records = new Map();
  const row = manager => records.get(manager) || records.set(manager, { manager, won: 0, lost: 0, even: 0, net: 0 }).get(manager);
  for (const season of seasons || []) {
    for (const trade of season.trades || []) {
      if (!["WON", "EVEN"].includes(trade.outcome?.verdict)) continue;
      const [a, b] = trade.sides;
      for (const [side, other] of [[a, b], [b, a]]) {
        const entry = row(side.manager);
        entry.net = Number((entry.net + side.value - other.value).toFixed(1));
        if (trade.outcome.verdict === "EVEN") entry.even += 1;
        else if (trade.outcome.winner === side.manager) entry.won += 1;
        else entry.lost += 1;
      }
    }
  }
  return [...records.values()].sort((x, y) => (y.won - y.lost) - (x.won - x.lost) || y.net - x.net || x.manager.localeCompare(y.manager, "fr"));
}
