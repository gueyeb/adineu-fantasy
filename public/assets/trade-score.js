import { calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=3";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026, ROSTER_SETTINGS_2026 } from "./league-settings.js";

const round = value => Number(value.toFixed(1));
const identity = player => String(player.sleeperId || player.name);
const projection = player => {
  const value = player.projectedPpg ?? player.projection?.pts_ppr;
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const LAST_REGULAR_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;

/** Games a Sleeper injury status is expected to cost. IR/PUP carry a 4-game minimum, but the status
 * doesn't say how many have already elapsed: 3 is the expected remainder, not a restart at 4. */
export const GAMES_MISSED_BY_STATUS = { Questionable: 0.3, Doubtful: 0.8, Out: 1, NA: 1, Sus: 1, IR: 3, PUP: 3, NFI: 3 };
const IR_ELIGIBLE = new Set(["IR", "PUP", "NFI", "Out", "Doubtful", "NA", "Sus"]);
export const injuryStatus = player => player.injuryStatus ?? player.injury_status ?? null;
const isOutThisWeek = player => (GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0) >= 1;

/** This week's points: Sleeper projection; Out/IR = 0; otherwise the expert-rank estimate. */
export function weeklyEstimate(player) {
  return projection(player) ?? (isOutThisWeek(player) ? 0 : calculatePlayerTradeProfile(player).projectedPpg);
}

/** Rest-of-regular-season weekly average: healthy rate x share of remaining games actually played
 * (injury games missed + bye inside the window). A trade is judged over the season, not one week,
 * so an injured star keeps value instead of reading as a 0 or as "missing data". */
const rosEstimators = new Map();
export function restOfSeasonEstimate(week) {
  if (!Number.isFinite(week)) return weeklyEstimate;
  if (rosEstimators.has(week)) return rosEstimators.get(week);
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  // Memoized per player object: the trade search re-evaluates the same rosters thousands of times.
  const memo = new WeakMap();
  const estimate = player => {
    if (memo.has(player)) return memo.get(player);
    const value = computeRestOfSeason(player);
    memo.set(player, value);
    return value;
  };
  rosEstimators.set(week, estimate);
  return estimate;

  function computeRestOfSeason(player) {
    const healthy = isOutThisWeek(player) || projection(player) === null
      ? calculatePlayerTradeProfile(player).blendedPpg
      : projection(player);
    const bye = BYE_WEEKS_2026[player.nflTeam];
    // A Sleeper projection already prices a Questionable/Doubtful tag in; only Out/IR adds misses.
    const statusMissed = isOutThisWeek(player) ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] : projection(player) === null ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0 : 0;
    const missed = statusMissed + (bye >= week && bye <= LAST_REGULAR_WEEK ? 1 : 0);
    return round(healthy * Math.max(0, remaining - missed) / remaining);
  }
}

/** Optimal lineup from a pool. An empty slot is a real 0 (it scores nothing), not missing data. */
export function buildProjectedLineup(players = [], { estimate = weeklyEstimate } = {}) {
  const pool = [...new Map(players.map(player => [identity(player), player])).values()];
  const value = new Map(pool.map(player => [identity(player), estimate(player)]));
  const used = new Set();
  const slots = [];
  for (const [position, count] of Object.entries(ROSTER_SETTINGS_2026.starters)) {
    const candidates = pool.filter(player => !used.has(identity(player)) && (position === "FLEX"
      ? ["RB", "WR", "TE"].includes(player.position)
      : player.position === position)).sort((a, b) =>
      value.get(identity(b)) - value.get(identity(a)) || identity(a).localeCompare(identity(b)));
    for (let i = 0; i < count; i++) {
      const player = candidates[i];
      if (player) used.add(identity(player));
      slots.push({ slot: count > 1 ? `${position}${i + 1}` : position, name: player?.name || "Slot vide", sleeperId: player ? identity(player) : null, projectedPpg: player ? value.get(identity(player)) : 0, empty: !player });
    }
  }
  return { slots, emptySlots: slots.filter(slot => slot.empty).map(slot => slot.slot), total: round(slots.reduce((sum, slot) => sum + slot.projectedPpg, 0)) };
}

function exchange(players, give, receive) {
  const outgoing = new Set(give.map(identity));
  return [...players.filter(player => !outgoing.has(identity(player))), ...receive];
}

/** Lowest-value player outside the optimal lineup: who a manager over the roster limit would cut. */
function likelyCut(players, lineup, estimate) {
  const starters = new Set(lineup.slots.map(slot => slot.sleeperId));
  return players.filter(player => !starters.has(identity(player)) && !isOutThisWeek(player))
    .sort((a, b) => estimate(a) - estimate(b))[0] || null;
}

/** Three separate dimensions. Deltas compare optimal lineups over the rest of the regular season
 * (weekly average), not asset sums. Injury statuses are modeled (games missed), so they are notes,
 * not missing data; only a missing market rank or an unexplained missing projection lowers
 * confidence. Roster overflow is resolved by cutting the lowest bench value. Tradeability is a
 * heuristic, not odds.
 */
export function scoreTradeRecommendation({ myPlayers = [], theirPlayers = [], give = [], receive = [], week = null }) {
  const estimate = restOfSeasonEstimate(week);
  const lineup = players => buildProjectedLineup(players, { estimate });
  const myAfterPlayers = exchange(myPlayers, give, receive);
  const theirAfterPlayers = exchange(theirPlayers, receive, give);
  const myBefore = lineup(myPlayers);
  const myAfter = lineup(myAfterPlayers);
  const theirBefore = lineup(theirPlayers);
  const theirAfter = lineup(theirAfterPlayers);
  const assets = [...give, ...receive];
  const warnings = assets.flatMap(player => [
    ...(projection(player) === null && !injuryStatus(player) ? [`${player.name} : projection de la semaine absente (estimation par rang)`] : []),
    ...(!Number.isFinite(player.quality?.expertRank ?? player.expertRank ?? player.market?.sleeperAdp ?? player.sleeperAdp) ? [`${player.name} : rang marché indisponible`] : [])
  ]);
  const injured = assets.filter(player => GAMES_MISSED_BY_STATUS[injuryStatus(player)]);
  const notes = injured.map(player => `${player.name} : ${injuryStatus(player)} (≈${GAMES_MISSED_BY_STATUS[injuryStatus(player)]} match(s) manqué(s) intégré(s))`);
  for (const [who, after, players] of [["Tu", myAfter, myAfterPlayers], ["Il", theirAfter, theirAfterPlayers]]) {
    const newlyEmpty = after.emptySlots.filter(slot => !(who === "Tu" ? myBefore : theirBefore).emptySlots.includes(slot));
    if (newlyEmpty.length) notes.push(`${who === "Tu" ? "Ta" : "Sa"} lineup perd son ${newlyEmpty.join(", ")} : slot vide = 0 pt.`);
    // Sleeper's flat players list includes IR; only IR-eligible players can sit in the reserve slot.
    const inReserve = Math.min(ROSTER_SETTINGS_2026.reserveSlots, players.filter(player => IR_ELIGIBLE.has(injuryStatus(player))).length);
    if (players.length - inReserve > ROSTER_SETTINGS_2026.totalRosterSize) {
      const cut = likelyCut(players, after, estimate);
      if (cut) notes.push(`${who} devra libérer une place : coupe probable ${cut.name} (sans impact lineup).`);
    }
  }
  const myDelta = round(myAfter.total - myBefore.total);
  const theirDelta = round(theirAfter.total - theirBefore.total);
  const market = evaluateTrade({ sideA: give, sideB: receive });
  const bilateral = warnings.length === 0 && myDelta > 0 && theirDelta > 0;
  const tradeability = warnings.length ? "À vérifier" : bilateral && market.pctDiff <= 8 ? "Naturelle" : myDelta < 0 || theirDelta < 0 ? "Peu réaliste" : "Négociable";
  return {
    market_value: { give: market.sideA.netTotal, receive: market.sideB.netTotal, gapPct: market.pctDiff },
    my_lineup_delta: myDelta, their_lineup_delta: theirDelta,
    horizon: Number.isFinite(week) ? "ROS" : "WEEK",
    confidence: warnings.length ? "LOW" : injured.length ? "MEDIUM" : "HIGH", tradeability,
    winWin: bilateral, warnings, notes,
    lineups: { mine: { before: myBefore, after: myAfter }, theirs: { before: theirBefore, after: theirAfter } },
    rankScore: round(Math.min(myDelta, theirDelta) * 10 + myDelta + theirDelta - market.pctDiff - warnings.length * 10 - injured.length * 3)
  };
}
