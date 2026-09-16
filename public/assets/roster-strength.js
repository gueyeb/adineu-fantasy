/**
 * Adineu Fantasy — Roster Strength by Position (Adineu estimate, never an official grade)
 *
 * Pure aggregation over already-resolved rosters. No network I/O, no fetching —
 * callers pass in whatever player lists they already loaded (catalog-resolved,
 * one entry per rostered player, `position` present).
 *
 * Deliberately narrow: this reuses calculatePlayerTradeProfile's tradeValue, the
 * same number already shown in the Trade Hub, so "roster strength" never invents
 * a second, disagreeing scale for the same players.
 */

import { calculatePlayerTradeProfile } from "./trade-value.js?v=3";

export const STRENGTH_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Sums tradeValue per position for one roster's players. Unknown/placeholder positions are skipped. */
export function sumTradeValueByPosition(players) {
  const totals = Object.fromEntries(STRENGTH_POSITIONS.map(pos => [pos, 0]));
  for (const player of players || []) {
    const position = (player?.position || "").toUpperCase();
    if (!(position in totals)) continue;
    totals[position] += calculatePlayerTradeProfile(player).tradeValue;
  }
  return totals;
}

/** Percentile (0-100) of each entry's `selector(entry)` among all entries, ties sharing the average rank. */
function percentileByKey(entries, key, selector) {
  if (entries.length <= 1) return new Map(entries.map(entry => [entry[key], 50]));
  const sorted = [...entries].sort((a, b) => selector(a) - selector(b));
  const percentiles = new Map();
  let index = 0;
  while (index < sorted.length) {
    let last = index;
    while (last + 1 < sorted.length && selector(sorted[last + 1]) === selector(sorted[index])) last += 1;
    const percentile = Math.round((((index + last) / 2) / (sorted.length - 1)) * 100);
    for (let i = index; i <= last; i += 1) percentiles.set(sorted[i][key], percentile);
    index = last + 1;
  }
  return percentiles;
}

/**
 * Computes, for every roster in the league, its per-position strength as a percentile (0-100)
 * against the other rosters, plus the single strongest ("surplus") and weakest ("need") position.
 * @param {Array<{ rosterId: string|number, players: Array }>} rosters
 */
export function calculateLeagueRosterStrength(rosters) {
  const entries = (rosters || []).map(roster => ({
    rosterId: roster.rosterId,
    totals: sumTradeValueByPosition(roster.players)
  }));

  const percentilesByPosition = new Map(
    STRENGTH_POSITIONS.map(pos => [pos, percentileByKey(entries, "rosterId", entry => entry.totals[pos])])
  );

  return entries.map(entry => {
    const strength = Object.fromEntries(
      STRENGTH_POSITIONS.map(pos => [pos, percentilesByPosition.get(pos).get(entry.rosterId)])
    );
    const ranked = STRENGTH_POSITIONS.map(pos => ({ pos, percentile: strength[pos] }));
    const surplus = ranked.reduce((best, current) => (current.percentile > best.percentile ? current : best));
    const need = ranked.reduce((worst, current) => (current.percentile < worst.percentile ? current : worst));
    return { rosterId: entry.rosterId, totals: entry.totals, strength, surplus: surplus.pos, need: need.pos };
  });
}
