import { calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=3";
import { ROSTER_SETTINGS_2026 } from "./league-settings.js";

const round = value => Number(value.toFixed(1));
const identity = player => String(player.sleeperId || player.name);
const projection = player => {
  const value = player.projectedPpg ?? player.projection?.pts_ppr;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function buildProjectedLineup(players = []) {
  const pool = [...new Map(players.map(player => [identity(player), player])).values()];
  const used = new Set();
  const slots = [];
  for (const [position, count] of Object.entries(ROSTER_SETTINGS_2026.starters)) {
    const candidates = pool.filter(player => !used.has(identity(player)) && (position === "FLEX"
      ? ["RB", "WR", "TE"].includes(player.position)
      : player.position === position)).sort((a, b) => {
      const estimate = player => projection(player) ?? calculatePlayerTradeProfile(player).projectedPpg;
      return estimate(b) - estimate(a) || identity(a).localeCompare(identity(b));
    });
    for (let i = 0; i < count; i++) {
      const player = candidates[i];
      if (player) used.add(identity(player));
      // Sleeper often hasn't published a live weekly number yet (early week, bye, inactive) —
      // fall back to the same expert-rank estimate already used to rank candidates above,
      // instead of leaving the slot (and therefore the whole team delta) unresolvable.
      const slotPpg = player ? (projection(player) ?? calculatePlayerTradeProfile(player).projectedPpg) : null;
      slots.push({ slot: count > 1 ? `${position}${i + 1}` : position, name: player?.name || "Slot vide", sleeperId: player ? identity(player) : null, projectedPpg: slotPpg });
    }
  }
  return { slots, complete: slots.every(slot => slot.projectedPpg !== null), total: round(slots.reduce((sum, slot) => sum + (slot.projectedPpg || 0), 0)) };
}

function exchange(players, give, receive) {
  const outgoing = new Set(give.map(identity));
  return [...players.filter(player => !outgoing.has(identity(player))), ...receive];
}

/** Three separate dimensions. Deltas are optimal projected lineups, not asset sums.
 * A player missing a live Sleeper projection falls back to an expert-rank estimate so one
 * unprojected roster player can't null out the whole team delta; deltas stay null only when a
 * starter slot has no eligible player at all. A missing projection on a traded asset still
 * warns and suppresses win-win/confidence. Tradeability is a heuristic, not odds.
 */
export function scoreTradeRecommendation({ myPlayers = [], theirPlayers = [], give = [], receive = [] }) {
  const myBefore = buildProjectedLineup(myPlayers);
  const myAfter = buildProjectedLineup(exchange(myPlayers, give, receive));
  const theirBefore = buildProjectedLineup(theirPlayers);
  const theirAfter = buildProjectedLineup(exchange(theirPlayers, receive, give));
  const assets = [...give, ...receive];
  const warnings = assets.flatMap(player => [
    ...(projection(player) === null ? [`${player.name} : projection indisponible`] : []),
    ...(player.injury_status || player.injuryStatus ? [`${player.name} : statut médical à vérifier`] : []),
    ...(!Number.isFinite(player.quality?.expertRank ?? player.expertRank ?? player.market?.sleeperAdp ?? player.sleeperAdp) ? [`${player.name} : rang marché indisponible`] : [])
  ]);
  const complete = [myBefore, myAfter, theirBefore, theirAfter].every(lineup => lineup.complete);
  if (!complete) warnings.push("Couverture de projections incomplète : impacts non publiés.");
  const myDelta = complete ? round(myAfter.total - myBefore.total) : null;
  const theirDelta = complete ? round(theirAfter.total - theirBefore.total) : null;
  const market = evaluateTrade({ sideA: give, sideB: receive });
  const bilateral = complete && warnings.length === 0 && myDelta > 0 && theirDelta > 0;
  const theirSize = theirPlayers.length - receive.length + give.length;
  const rosterOverflow = theirSize > ROSTER_SETTINGS_2026.totalRosterSize;
  if (rosterOverflow) warnings.push("Le partenaire doit libérer une place : coupe non modélisée.");
  const tradeability = warnings.length ? "À vérifier" : bilateral && market.pctDiff <= 8 && !rosterOverflow ? "Naturelle" : complete && (myDelta < 0 || theirDelta < 0) ? "Peu réaliste" : "Négociable";
  return {
    market_value: { give: market.sideA.netTotal, receive: market.sideB.netTotal, gapPct: market.pctDiff },
    my_lineup_delta: myDelta, their_lineup_delta: theirDelta,
    confidence: warnings.length ? "LOW" : "HIGH", tradeability,
    winWin: bilateral && !rosterOverflow, warnings,
    lineups: { mine: { before: myBefore, after: myAfter }, theirs: { before: theirBefore, after: theirAfter } },
    rankScore: complete ? round(Math.min(myDelta, theirDelta) * 10 + myDelta + theirDelta - market.pctDiff - warnings.length * 10) : -1000
  };
}
