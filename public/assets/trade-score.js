import { calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=2c9caa87cf";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026, ROSTER_SETTINGS_2026 } from "./league-settings.js?v=f6d1bf5212";

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

/** This week's points: Out/IR = 0 (even if Sleeper still carries a stale projection for him);
 * otherwise the Sleeper projection, else the expert-rank estimate. */
export function weeklyEstimate(player) {
  if (isOutThisWeek(player)) return 0;
  return projection(player) ?? calculatePlayerTradeProfile(player).projectedPpg;
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
    const usageAdjusted = Number.isFinite(player.rosPpg) ? player.rosPpg : null;
    const healthy = usageAdjusted ?? (isOutThisWeek(player) || projection(player) === null
      ? calculatePlayerTradeProfile(player).blendedPpg
      : projection(player));
    const bye = BYE_WEEKS_2026[player.nflTeam];
    // A Sleeper projection already prices a Questionable/Doubtful tag in; only Out/IR adds misses.
    const statusMissed = isOutThisWeek(player) ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] : projection(player) === null ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0 : 0;
    // rosPpg (rest-of-season.js) already averages the bye in as a 0: never subtract it twice.
    const byeMissed = usageAdjusted === null && bye >= week && bye <= LAST_REGULAR_WEEK ? 1 : 0;
    const missed = statusMissed + byeMissed;
    return round(healthy * Math.max(0, remaining - missed) / remaining);
  }
}

/** Optimal lineup from a pool. An empty slot is a real 0 (it scores nothing), not missing data. */
export function buildProjectedLineup(players = [], { estimate = weeklyEstimate, fixedSlots = {} } = {}) {
  // Hot path of every waiver/cut simulation: ids and values are computed once, not inside the sort.
  const byId = new Map(players.map(player => [identity(player), player]));
  const entries = [...byId].map(([id, player]) => ({ id, player, value: estimate(player) }));
  const used = new Set();
  const reserved = new Set(Object.values(fixedSlots).map(String));
  const slots = [];
  for (const [position, count] of Object.entries(ROSTER_SETTINGS_2026.starters)) {
    const candidates = entries.filter(({ id, player }) => !used.has(id) && !reserved.has(id) && (position === "FLEX"
      ? ["RB", "WR", "TE"].includes(player.position)
      : player.position === position)).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    for (let i = 0; i < count; i++) {
      const slotName = count > 1 ? `${position}${i + 1}` : position;
      const fixedId = fixedSlots[slotName] ? String(fixedSlots[slotName]) : null;
      const entry = fixedId ? entries.find(e => e.id === fixedId) : candidates.shift();
      if (entry) used.add(entry.id);
      slots.push({ slot: slotName, name: entry?.player.name || "Slot vide", sleeperId: entry ? entry.id : null, projectedPpg: entry ? entry.value : 0, empty: !entry });
    }
  }
  return { slots, emptySlots: slots.filter(slot => slot.empty).map(slot => slot.slot), total: round(slots.reduce((sum, slot) => sum + slot.projectedPpg, 0)) };
}

/** Return-week hypotheses for an injured asset of a trade. Ramp factors are uncalibrated. */
export const RETURN_SCENARIOS = [
  { id: "IMMEDIATE", label: "retour immédiat", shift: weeks => weeks.next, ramp: [] },
  { id: "PROGRESSIVE", label: "retour attendu, progressif", shift: weeks => weeks.expected, ramp: [0.75, 0.75] },
  { id: "LONG", label: "absence prolongée", shift: weeks => weeks.expected + 3, ramp: [0.75] }
];

/** Expected return of an Out/IR player: the first later week Sleeper projects him again (its
 * absence before that is information), else the status' expected games missed. */
export function expectedReturnWeek(player, { week, projectionsByWeek = {} }) {
  const missed = GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0;
  if (missed < 1) return week;
  const id = identity(player);
  const bye = BYE_WEEKS_2026[player.nflTeam];
  for (let w = week + 1; w <= LAST_REGULAR_WEEK; w++) {
    if (w !== bye && Number.isFinite(projectionsByWeek[w]?.[id]?.pts_ppr)) return w;
  }
  return week + Math.ceil(missed);
}

/** Healthy weekly rate: mean of the player's published weekly projections, else rosPpg / estimate. */
function healthyRate(player, { week, projectionsByWeek }) {
  const id = identity(player);
  const values = [];
  for (let w = week + 1; w <= LAST_REGULAR_WEEK; w++) {
    const value = projectionsByWeek[w]?.[id]?.pts_ppr;
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number.isFinite(player.rosPpg) ? player.rosPpg : calculatePlayerTradeProfile(player).blendedPpg;
}

/**
 * Week-by-week optimal-lineup impact of one trade for both teams, under each return hypothesis for
 * the injured assets (feedback 14/10: an IR star was valued from one stale number). Every week uses
 * that week's Sleeper projection (bye = 0, unavailable = 0, missing = healthy rate, counted in
 * `evidence`). Non-traded injured players follow their expected return. Returns a range, not a verdict.
 */
export function tradeReturnScenarios({ myPlayers = [], theirPlayers = [], give = [], receive = [], week, projectionsByWeek = {} }) {
  const weeks = Array.from({ length: Math.max(0, LAST_REGULAR_WEEK - week + 1) }, (_, i) => week + i);
  const assets = new Set([...give, ...receive].map(identity));
  const injuredAssets = [...give, ...receive].filter(player => (GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0) >= 1);
  const context = { week, projectionsByWeek };
  const rates = new Map();
  const rateOf = player => {
    if (!rates.has(identity(player))) rates.set(identity(player), healthyRate(player, context));
    return rates.get(identity(player));
  };
  const filled = new Set();
  const pointsFor = (player, w, scenario) => {
    if (BYE_WEEKS_2026[player.nflTeam] === w) return 0;
    const injured = (GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0) >= 1;
    const expected = injured ? expectedReturnWeek(player, context) : week;
    const returnWeek = injured && scenario && assets.has(identity(player))
      ? scenario.shift({ next: week + 1, expected }) : expected;
    if (w < returnWeek) return 0;
    const projected = projectionsByWeek[w]?.[identity(player)]?.pts_ppr;
    // An injured player's stale projection before his return is ignored above; after it, use it.
    let value = Number.isFinite(projected) ? projected : null;
    if (value === null) {
      value = rateOf(player);
      if (assets.has(identity(player))) filled.add(`${player.name} S${w}`);
    }
    const ramp = injured && scenario && assets.has(identity(player)) ? scenario.ramp[w - returnWeek] ?? 1 : 1;
    return value * ramp;
  };
  const myAfterPlayers = exchange(myPlayers, give, receive);
  const theirAfterPlayers = exchange(theirPlayers, receive, give);
  const total = (players, w, scenario) => buildProjectedLineup(players, { estimate: player => pointsFor(player, w, scenario) }).total;
  const run = scenario => {
    const byWeek = weeks.map(w => ({
      week: w,
      myDelta: round(total(myAfterPlayers, w, scenario) - total(myPlayers, w, scenario)),
      theirDelta: round(total(theirAfterPlayers, w, scenario) - total(theirPlayers, w, scenario))
    }));
    return { byWeek, myTotal: round(byWeek.reduce((sum, row) => sum + row.myDelta, 0)), theirTotal: round(byWeek.reduce((sum, row) => sum + row.theirDelta, 0)) };
  };
  const scenarios = injuredAssets.length
    ? RETURN_SCENARIOS.map(scenario => ({ id: scenario.id, label: scenario.label,
      returnWeeks: Object.fromEntries(injuredAssets.map(player => [player.name, scenario.shift({ next: week + 1, expected: expectedReturnWeek(player, context) })])),
      ...run(scenario) }))
    : [{ id: "HEALTHY", label: "aucun actif blessé", returnWeeks: {}, ...run(null) }];
  const mine = scenarios.map(row => row.myTotal);
  const theirs = scenarios.map(row => row.theirTotal);
  const projectionGaps = [...filled].sort();
  // A starter slot at 0 (bye, or absent without backup) on one side of the trade only: the delta then
  // includes a streamer the manager would add anyway. Shown, not corrected.
  const zeroSlots = (players, w) => new Map(buildProjectedLineup(players, { estimate: player => pointsFor(player, w, null) }).slots.map(slot => [slot.slot, slot.projectedPpg === 0]));
  const emptySlotWeeks = [["mine", myPlayers, myAfterPlayers], ["theirs", theirPlayers, theirAfterPlayers]].flatMap(([team, before, after]) => weeks.map(w => {
    const was = zeroSlots(before, w), is = zeroSlots(after, w);
    return { team, week: w, slots: [...was].filter(([slot, zero]) => zero !== is.get(slot)).map(([slot]) => slot) };
  }).filter(row => row.slots.length));
  return {
    weeks: weeks.length ? { from: weeks[0], to: weeks.at(-1) } : null,
    scenarios,
    range: { mine: [Math.min(...mine), Math.max(...mine)], theirs: [Math.min(...theirs), Math.max(...theirs)] },
    evidence: {
      basis: "SLEEPER_WEEKLY_PROJECTIONS",
      injuredAssets: injuredAssets.map(player => ({ name: player.name, status: injuryStatus(player), expectedReturnWeek: expectedReturnWeek(player, context) })),
      projectionGaps,
      emptySlotWeeks,
      quality: projectionGaps.length > 2 || injuredAssets.length || emptySlotWeeks.length ? "MEDIUM" : "HIGH",
      notes: ["Rampe de retour (75 %) et absence prolongée (+3 sem.) : hypothèses non calibrées."]
    }
  };
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
    ...(projection(player) === null && !isOutThisWeek(player) ? [`${player.name} : projection de la semaine absente (estimation par rang)`] : []),
    ...(!Number.isFinite(player.quality?.expertRank ?? player.expertRank ?? player.market?.sleeperAdp ?? player.sleeperAdp) ? [`${player.name} : rang marché indisponible`] : [])
  ]);
  // Missing projections on a starter/replacement affect the delta even outside the package.
  const relevantIds = new Set([myBefore, myAfter, theirBefore, theirAfter].flatMap(row => row.slots.filter(slot => !slot.empty).map(slot => slot.sleeperId)));
  const relevant = [...new Map([...myPlayers, ...theirPlayers].map(player => [identity(player), player])).values()];
  for (const player of relevant) {
    if (!assets.some(asset => identity(asset) === identity(player)) && relevantIds.has(identity(player)) && projection(player) === null && !isOutThisWeek(player)) {
      warnings.push(`${player.name} : projection absente dans une lineup comparée`);
    }
  }
  for (const player of assets) {
    if (injuryStatus(player) && !Object.hasOwn(GAMES_MISSED_BY_STATUS, injuryStatus(player))) warnings.push(`${player.name} : statut de blessure non reconnu`);
  }
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
