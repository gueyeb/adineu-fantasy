import { assessTradeCut } from "./trade-cut-readiness.js?v=3a8f3ea6db";
import { hasNoNflTeam, tradeWeekFrame } from "./trade-timing.js?v=51b07dc8cf";
import { calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=2c9caa87cf";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026, ROSTER_SETTINGS_2026 } from "./league-settings.js?v=886f353394";

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
  if (isOutThisWeek(player) || hasNoNflTeam(player)) return 0;
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
    const { healthy, statusMissed, byeMissed } = restOfSeasonParts(player, week);
    return round(healthy * Math.max(0, remaining - statusMissed - byeMissed) / remaining);
  }
}

function restOfSeasonParts(player, week) {
  // Same assumption as the weekly simulation: no NFL team, no game, 0 (not the catalog rank value).
  if (hasNoNflTeam(player)) return { healthy: 0, statusMissed: 0, byeMissed: 0, byeInWindow: false, rosPpgIncludesBye: false };
  const usageAdjusted = Number.isFinite(player.rosPpg) ? player.rosPpg : null;
  const healthy = usageAdjusted ?? (isOutThisWeek(player) || projection(player) === null
    ? calculatePlayerTradeProfile(player).blendedPpg
    : projection(player));
  const bye = BYE_WEEKS_2026[player.nflTeam];
  const byeInWindow = bye >= week && bye <= LAST_REGULAR_WEEK;
  // A Sleeper projection already prices a Questionable/Doubtful tag in; only Out/IR adds misses.
  const statusMissed = isOutThisWeek(player) ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] : projection(player) === null ? GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0 : 0;
  // rosPpg (rest-of-season.js) already averages the bye in as a 0: never subtract it twice.
  const byeMissed = usageAdjusted === null && byeInWindow ? 1 : 0;
  return { healthy, statusMissed, byeMissed, byeInWindow, rosPpgIncludesBye: usageAdjusted !== null && byeInWindow };
}

/** Points per game actually played over the window (bye excluded), unrounded: the same average as
 * restOfSeasonEstimate once multiplied by games / remaining weeks. */
const playedRateEstimators = new Map();
function perGamePlayedEstimate(week) {
  if (playedRateEstimators.has(week)) return playedRateEstimators.get(week);
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const memo = new WeakMap();
  const estimate = player => {
    if (memo.has(player)) return memo.get(player);
    const { healthy, statusMissed, byeInWindow, rosPpgIncludesBye } = restOfSeasonParts(player, week);
    const games = byeInWindow ? remaining - 1 : remaining;
    const perGame = rosPpgIncludesBye && games > 0 ? healthy * remaining / games : healthy;
    const value = games > 0 ? perGame * Math.max(0, games - statusMissed) / games : 0;
    memo.set(player, value);
    return value;
  };
  playedRateEstimators.set(week, estimate);
  return estimate;
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

/**
 * Rest-of-season weekly average of the optimal lineup, the bye covered by the bench (validation
 * 28/10, 4 captures S6–S8: a bye counted as 0 inside each starter's average disagreed in sign with
 * the week-by-week simulation on 35–48 % of trade sides, 22–25 % once the bench covers it). Each
 * player plays at his rate per game played; his bye week is 0 and the lineup is re-optimized for it.
 * Only weeks where a base starter is on bye need a second lineup.
 */
const SLOT_PLAN = Object.entries(ROSTER_SETTINGS_2026.starters).flatMap(([position, count]) => Array(count).fill(position));
const SLOT_POSITIONS = [...new Set(SLOT_PLAN)];
const fitsSlot = (position, player) => position === "FLEX" ? ["RB", "WR", "TE"].includes(player.position) : player.position === position;

/** Totals only, same greedy order and tie-break as buildProjectedLineup without its per-slot sort:
 * the exhaustive trade search evaluates this hundreds of thousands of times. */
export function restOfSeasonLineupTotal(players = [], week) {
  const estimate = restOfSeasonEstimate(week);
  if (!Number.isFinite(week)) return { total: buildProjectedLineup(players, { estimate }).total, baseTotal: null, starterIds: null, byeWeeks: [], rate: estimate };
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const byeOf = player => {
    const bye = BYE_WEEKS_2026[player.nflTeam];
    return bye >= week && bye <= LAST_REGULAR_WEEK ? bye : null;
  };
  const rate = perGamePlayedEstimate(week);
  const unique = new Map();
  for (const player of players) unique.set(identity(player), player);
  const entries = [];
  for (const [id, player] of unique) entries.push({ id, player, value: rate(player), bye: byeOf(player) });
  entries.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const eligible = Object.fromEntries(SLOT_POSITIONS.map(position => [position, entries.flatMap((entry, index) => fitsSlot(position, entry.player) ? [index] : [])]));
  const used = new Uint8Array(entries.length);
  const pick = byeWeek => {
    used.fill(0);
    let sum = 0;
    for (const position of SLOT_PLAN) {
      let best = -1;
      for (const index of eligible[position]) {
        if (used[index] || (byeWeek !== null && entries[index].bye === byeWeek)) continue;
        best = index;
        break;
      }
      // A player on bye scores 0: chosen only when nothing healthier is left (ties broken by id).
      if (byeWeek !== null && (best < 0 || entries[best].value <= 0)) {
        let idle = -1;
        for (const index of eligible[position]) {
          if (!used[index] && entries[index].bye === byeWeek && (idle < 0 || entries[index].id.localeCompare(entries[idle].id) < 0)) idle = index;
        }
        if (idle >= 0 && (best < 0 || entries[best].value < 0 || entries[idle].id.localeCompare(entries[best].id) < 0)) { used[idle] = 1; continue; }
      }
      if (best >= 0) { used[best] = 1; sum += entries[best].value; }
    }
    return round(sum);
  };
  const baseTotal = pick(null);
  const starterIds = new Set(entries.filter((entry, index) => used[index]).map(entry => entry.id));
  const byeWeeks = [...new Set(entries.filter((entry, index) => used[index] && entry.bye !== null).map(entry => entry.bye))].sort((a, b) => a - b);
  let byeSum = 0;
  for (const bye of byeWeeks) byeSum += pick(bye);
  return { total: round((baseTotal * (remaining - byeWeeks.length) + byeSum) / remaining), baseTotal, starterIds, byeWeeks, rate };
}

/** Slots at the rate per game played (what a starter brings when he plays), total = weekly average
 * with each starter's bye covered by the bench. */
export function restOfSeasonLineup(players = [], week) {
  const summary = restOfSeasonLineupTotal(players, week);
  if (!Number.isFinite(week)) return buildProjectedLineup(players, { estimate: restOfSeasonEstimate(week) });
  return { ...buildProjectedLineup(players, { estimate: player => round(summary.rate(player)) }), total: summary.total, basis: "RATE_PER_GAME_BYE_COVERED_BY_BENCH", byeWeeks: summary.byeWeeks };
}

/** Return-week hypotheses for an injured asset of a trade. Ramp factors are uncalibrated. */
export const RETURN_SCENARIOS = [
  { id: "IMMEDIATE", label: "hypothèse : retour dès la semaine suivante", shift: weeks => weeks.next, ramp: [] },
  { id: "PROGRESSIVE", label: "hypothèse : retour progressif", shift: weeks => weeks.expected, ramp: [0.75, 0.75] },
  { id: "LONG", label: "hypothèse : absence prolongée", shift: weeks => weeks.expected + 3, ramp: [0.75] }
];

/** Modeling assumption only: future projections never establish medical clearance or IR activation. */
export function returnWeekAssumption(player, { week, projectionsByWeek = {} }) {
  const missed = GAMES_MISSED_BY_STATUS[injuryStatus(player)] || 0;
  if (missed < 1) return { week, basis: "CURRENT_STATUS", availability: "UNVERIFIED" };
  const id = identity(player);
  const bye = BYE_WEEKS_2026[player.nflTeam];
  for (let w = week + 1; w <= LAST_REGULAR_WEEK; w++) {
    const points = projectionsByWeek[w]?.[id]?.pts_ppr;
    if (w !== bye && Number.isFinite(points) && points > 0) {
      return { week: w, basis: "FUTURE_PROJECTION_ASSUMPTION", availability: "UNVERIFIED" };
    }
  }
  return { week: week + Math.ceil(missed), basis: "STATUS_DURATION_ASSUMPTION", availability: "UNVERIFIED" };
}

export function expectedReturnWeek(player, context) {
  return returnWeekAssumption(player, context).week;
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
export function tradeReturnScenarios({ myPlayers = [], theirPlayers = [], give = [], receive = [], week, projectionsByWeek = {}, timingContext = null, now = Date.now(), targetWeek = null, dataThroughWeek = null }) {
  // Each traded player changes lineup only from his first affectable week (agreement now, review,
  // next kickoff); before it he still plays for his old team. Unverified timing keeps the live week.
  const weekFrame = tradeWeekFrame({ players: [...give, ...receive], currentWeek: week, targetWeek, dataThroughWeek, context: timingContext, now });
  const conditional = weekFrame.status === "CONDITIONAL";
  const frameRows = new Map(weekFrame.players.map(row => [row.playerId, row]));
  const moveWeek = player => {
    if (weekFrame.status === "BLOCKED") return Infinity;
    if (!conditional) return week;
    const row = frameRows.get(identity(player));
    return row?.reason === "NO_NFL_TEAM" ? weekFrame.firstAffectableWeek ?? week : row?.firstAffectableWeek ?? Infinity;
  };
  const startWeek = conditional ? weekFrame.firstAffectableWeek : weekFrame.status === "BLOCKED" ? null : week;
  const weeks = Number.isInteger(startWeek) ? Array.from({ length: Math.max(0, LAST_REGULAR_WEEK - startWeek + 1) }, (_, i) => startWeek + i) : [];
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
    // Unsigned (Sleeper lists no NFL team): no game to play, counted 0 instead of blocking the roster.
    if (hasNoNflTeam(player) || BYE_WEEKS_2026[player.nflTeam] === w) return 0;
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
  const movedBy = w => player => w >= moveWeek(player);
  const myAfterAt = w => exchange(myPlayers, give.filter(movedBy(w)), receive.filter(movedBy(w)));
  const theirAfterAt = w => exchange(theirPlayers, receive.filter(movedBy(w)), give.filter(movedBy(w)));
  const total = (players, w, scenario) => buildProjectedLineup(players, { estimate: player => pointsFor(player, w, scenario) }).total;
  const run = scenario => {
    const byWeek = weeks.map(w => ({
      week: w,
      myDelta: round(total(myAfterAt(w), w, scenario) - total(myPlayers, w, scenario)),
      theirDelta: round(total(theirAfterAt(w), w, scenario) - total(theirPlayers, w, scenario))
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
  const emptySlotWeeks = [["mine", myPlayers, myAfterAt], ["theirs", theirPlayers, theirAfterAt]].flatMap(([team, before, afterAt]) => weeks.map(w => {
    const was = zeroSlots(before, w), is = zeroSlots(afterAt(w), w);
    return { team, week: w, slots: [...was].filter(([slot, zero]) => zero !== is.get(slot)).map(([slot]) => slot) };
  }).filter(row => row.slots.length));
  return {
    weeks: weeks.length ? { from: weeks[0], to: weeks.at(-1) } : null,
    weekFrame,
    scenarios,
    range: { mine: [Math.min(...mine), Math.max(...mine)], theirs: [Math.min(...theirs), Math.max(...theirs)] },
    evidence: {
      basis: "SLEEPER_WEEKLY_PROJECTIONS",
      injuredAssets: injuredAssets.map(player => ({ name: player.name, status: injuryStatus(player), expectedReturnWeek: expectedReturnWeek(player, context) })),
      returnAssumptions: [...new Map([...myPlayers, ...theirPlayers].map(player => [identity(player), player])).values()]
        .filter(player => isOutThisWeek(player))
        .map(player => ({ name: player.name, status: injuryStatus(player), traded: assets.has(identity(player)), ...returnWeekAssumption(player, context) })),
      lineupAvailability: "UNVERIFIED",
      transactionTiming: "UNVERIFIED",
      noNflTeam: [...new Map([...myPlayers, ...theirPlayers].map(player => [identity(player), player])).values()].filter(hasNoNflTeam).map(player => ({ name: player.name, assumption: "NO_NFL_TEAM_COUNTED_AS_ZERO" })),
      projectionGaps,
      emptySlotWeeks,
      quality: projectionGaps.length > 2 || injuredAssets.length || emptySlotWeeks.length ? "MEDIUM" : "HIGH",
      notes: [`Simulation future, pas une lineup alignable confirmée. ${conditional ? "Chaque joueur échangé change d’équipe à sa première semaine affectable (accord supposé maintenant, revue modélisée)" : "Fenêtre de trade non vérifiée : départ supposé à la semaine live"} ; locks, AutoSubs et activation IR non vérifiés.`, "Une projection future ne confirme pas un retour de blessure. Rampe de retour (75 %) et absence prolongée (+3 sem.) : hypothèses non calibrées."]
    }
  };
}

/**
 * Same offer, two readings: the season-average lineup delta and the week-by-week simulation
 * (byes, published weekly projections, return hypotheses). Validation 28/10: Puka Nacua for
 * Tuten + McMillan read +2.0 pts/sem on average but -15.9 pts over S8–S14 week by week. A gain the
 * weekly simulation never shows, or a verdict that flips with the return hypothesis, is reported —
 * neither reading is chosen as the truth.
 */
export function assessScenarioConsistency({ myDelta, theirDelta, scenarios = [] }) {
  if (!scenarios.length) return { status: "UNAVAILABLE", sides: {}, reasons: ["WEEKLY_SCENARIOS_UNAVAILABLE"] };
  const side = (average, totals) => ({ average, totals,
    contradicts: Number.isFinite(average) && ((average > 0 && Math.max(...totals) <= 0) || (average < 0 && Math.min(...totals) > 0)),
    flips: totals.length > 1 && totals.some(total => total > 0) && totals.some(total => total < 0) });
  const sides = { mine: side(myDelta, scenarios.map(row => row.myTotal)), theirs: side(theirDelta, scenarios.map(row => row.theirTotal)) };
  const reasons = Object.entries(sides).flatMap(([name, row]) => [
    ...(row.contradicts ? [`${name === "mine" ? "MY" : "THEIR"}_AVERAGE_CONTRADICTED_BY_WEEKLY`] : []),
    ...(row.flips ? [`${name === "mine" ? "MY" : "THEIR"}_VERDICT_DEPENDS_ON_RETURN`] : [])]);
  const status = reasons.some(reason => reason.endsWith("CONTRADICTED_BY_WEEKLY")) ? "WEEKLY_CONTRADICTS_AVERAGE" : reasons.length ? "INJURY_SENSITIVE" : "CONSISTENT";
  return { status, sides, reasons };
}

export function describeScenarioConsistency(check, { mine = "ton équipe", theirs = "le partenaire" } = {}) {
  if (!check || check.status === "CONSISTENT" || check.status === "UNAVAILABLE") return [];
  const range = totals => totals.length > 1 ? `${Math.min(...totals)} à ${Math.max(...totals)}` : `${totals[0]}`;
  return Object.entries(check.sides).flatMap(([name, row]) => {
    const who = name === "mine" ? mine : theirs;
    if (row.contradicts) return [`Moyenne ${row.average > 0 ? "+" : ""}${row.average} pts/sem pour ${who}, mais simulation semaine par semaine ${range(row.totals)} pts : gain non confirmé.`];
    if (row.flips) return [`Verdict de ${who} dépendant de l’hypothèse de retour (${range(row.totals)} pts) : sensibilité non calibrée.`];
    return [];
  });
}

function exchange(players, give, receive) {
  const outgoing = new Set(give.map(identity));
  return [...players.filter(player => !outgoing.has(identity(player))), ...receive];
}

/** Three separate dimensions. Deltas compare optimal lineups over the rest of the regular season
 * (weekly average), not asset sums. Injury statuses are modeled (games missed), so they are notes,
 * not missing data; only a missing market rank or an unexplained missing projection lowers
 * confidence. Roster overflow is resolved by cutting the lowest bench value. Tradeability is a
 * heuristic, not odds.
 */
export function scoreTradeRecommendation({ myPlayers = [], theirPlayers = [], give = [], receive = [], week = null, myRoster = null, theirRoster = null, cutContext = null, now = Date.now() }) {
  const estimate = restOfSeasonEstimate(week);
  const lineup = players => restOfSeasonLineup(players, week);
  const myAfterPlayers = exchange(myPlayers, give, receive);
  const theirAfterPlayers = exchange(theirPlayers, receive, give);
  const myBefore = lineup(myPlayers);
  const myAfter = lineup(myAfterPlayers);
  const theirBefore = lineup(theirPlayers);
  const theirAfter = lineup(theirAfterPlayers);
  const assets = [...give, ...receive];
  const warnings = assets.flatMap(player => [
    ...(projection(player) === null && !isOutThisWeek(player) && !hasNoNflTeam(player) ? [`${player.name} : projection de la semaine absente (estimation par rang)`] : []),
    ...(!Number.isFinite(player.quality?.expertRank ?? player.expertRank ?? player.market?.sleeperAdp ?? player.sleeperAdp) ? [`${player.name} : rang marché indisponible`] : [])
  ]);
  // Missing projections on a starter/replacement affect the delta even outside the package.
  const relevantIds = new Set([myBefore, myAfter, theirBefore, theirAfter].flatMap(row => row.slots.filter(slot => !slot.empty).map(slot => slot.sleeperId)));
  const relevant = [...new Map([...myPlayers, ...theirPlayers].map(player => [identity(player), player])).values()];
  for (const player of relevant) {
    if (!assets.some(asset => identity(asset) === identity(player)) && relevantIds.has(identity(player)) && projection(player) === null && !isOutThisWeek(player) && !hasNoNflTeam(player)) {
      warnings.push(`${player.name} : projection absente dans une lineup comparée`);
    }
  }
  for (const player of assets) {
    if (injuryStatus(player) && !Object.hasOwn(GAMES_MISSED_BY_STATUS, injuryStatus(player))) warnings.push(`${player.name} : statut de blessure non reconnu`);
  }
  const injured = assets.filter(player => GAMES_MISSED_BY_STATUS[injuryStatus(player)]);
  const rosterConsequences = {};
  const notes = injured.map(player => `${player.name} : ${injuryStatus(player)} (hypothèse non calibrée : ≈${GAMES_MISSED_BY_STATUS[injuryStatus(player)]} match(s) manqué(s), retour non confirmé)`);
  const unsigned = [...new Map([...myPlayers, ...theirPlayers].map(player => [identity(player), player])).values()].filter(hasNoNflTeam);
  if (unsigned.length) notes.push(`${unsigned.map(player => player.name).join(", ")} : sans équipe NFL selon Sleeper, compté 0 sur l’horizon (hypothèse NO_NFL_TEAM_COUNTED_AS_ZERO ; une signature changerait la valeur).`);
  for (const [who, after, players, before, outgoing, incoming, side, roster, original] of [["Tu", myAfter, myAfterPlayers, myBefore, give, receive, "mine", myRoster, myPlayers], ["Il", theirAfter, theirAfterPlayers, theirBefore, receive, give, "theirs", theirRoster, theirPlayers]]) {
    const newlyEmpty = after.emptySlots.filter(slot => !(who === "Tu" ? myBefore : theirBefore).emptySlots.includes(slot));
    if (newlyEmpty.length) notes.push(`${who === "Tu" ? "Ta" : "Sa"} lineup perd son ${newlyEmpty.join(", ")} : slot vide = 0 pt.`);
    // Sleeper's flat players list includes IR; only IR-eligible players can sit in the reserve slot.
    const originalIds = new Set(original.map(identity));
    const reserve = Array.isArray(roster?.reserve) ? roster.reserve.map(String) : null;
    const reserveVerified = reserve !== null && new Set(reserve).size === reserve.length && reserve.every(id => originalIds.has(id)) && reserve.length <= ROSTER_SETTINGS_2026.reserveSlots && !reserve.some(id => (roster?.starters || []).map(String).includes(id));
    const outgoingIds = new Set(outgoing.map(identity));
    const retainedReserve = reserveVerified ? reserve.filter(id => !outgoingIds.has(id)) : [];
    const inReserve = reserveVerified ? retainedReserve.length : Math.min(ROSTER_SETTINGS_2026.reserveSlots, players.filter(player => IR_ELIGIBLE.has(injuryStatus(player))).length);
    const declaredStarters = new Set((roster?.starters || []).map(String));
    const cutsNeeded = Math.max(0, players.length - inReserve - ROSTER_SETTINGS_2026.totalRosterSize);
    const starterIds = new Set(after.slots.map(slot => slot.sleeperId));
    const incomingIds = new Set(incoming.map(identity));
    const candidatePool = players.filter(player => !starterIds.has(identity(player)) && !incomingIds.has(identity(player)) && !retainedReserve.includes(identity(player)) && !declaredStarters.has(identity(player)) && !isOutThisWeek(player))
      .sort((a, b) => estimate(a) - estimate(b));
    const assessed = candidatePool.map(player => ({ player, readiness: assessTradeCut(player, { week, context: cutContext, now }) }));
    const candidates = assessed.filter(row => !row.readiness.excludedByPolicy).slice(0, cutsNeeded);
    const beforeStarterIds = new Set(before.slots.map(slot => slot.sleeperId));
    const brief = player => ({ sleeperId: identity(player), name: player.name, position: player.position });
    rosterConsequences[side] = { cutsNeeded, cutCandidates: candidates.map(row => ({ ...brief(row.player), readiness: row.readiness })),
      excludedCutCandidates: cutsNeeded ? assessed.filter(row => row.readiness.excludedByPolicy).map(row => ({ ...brief(row.player), readiness: row.readiness })) : [],
      capacityEffect: cutsNeeded ? "REDUCE_BEFORE_LINEUP_EDITS" : "NO_REDUCTION_DEMONSTRATED", tradeBlockedByCapacity: false,
      outgoingBench: outgoing.filter(player => !beforeStarterIds.has(identity(player))).map(brief),
      capacityBasis: reserveVerified ? "DECLARED_SLEEPER_RESERVE" : "STATUS_BASED_RESERVE_ASSUMPTION", retainedReserveIds: retainedReserve, incomingReservePlacement: "NOT_ASSUMED", cutAvailability: "UNVERIFIED", execution: "UNVERIFIED" };
    if (cutsNeeded) notes.push(`${who === "Tu" ? "Tu devras" : "Il devra"} libérer ${cutsNeeded} place(s) pour modifier la lineup après le trade (${reserveVerified ? "réserve Sleeper déclarée conservée" : "hypothèse IR, réserve non vérifiée"}) : ${candidates.length ? `coupe(s) candidate(s) ${candidates.map(row => row.player.name).join(", ")}` : "aucune coupe hors titulaires identifiée"}. Le dépassement de capacité ne bloque pas le trade à lui seul. Profondeur perdue, places réelles, AutoSubs et locks à vérifier.`);
  }
  const myDelta = round(myAfter.total - myBefore.total);
  const theirDelta = round(theirAfter.total - theirBefore.total);
  const market = evaluateTrade({ sideA: give, sideB: receive });
  const bilateral = warnings.length === 0 && myDelta > 0 && theirDelta > 0;
  const structureId = warnings.length ? "DATA_GAPS" : bilateral && market.pctDiff <= 8 ? "BILATERAL_MARKET_CLOSE" : myDelta < 0 || theirDelta < 0 ? "LINEUP_LOSS" : "REVIEW_STRUCTURE";
  const tradeability = { DATA_GAPS: "Données à vérifier", BILATERAL_MARKET_CLOSE: "Gains bilatéraux, marché proche", LINEUP_LOSS: "Perte de lineup estimée", REVIEW_STRUCTURE: "Structure à examiner" }[structureId];
  const calculationReliability = warnings.length ? "LOW" : injured.length ? "MEDIUM" : "HIGH";
  const changes = (before, after) => before.slots.flatMap((slot, index) => {
    const next = after.slots[index];
    return slot.sleeperId === next.sleeperId ? [] : [{ slot: slot.slot, before: slot.name, after: next.name, beforePoints: slot.projectedPpg, afterPoints: next.projectedPpg }];
  });
  return {
    market_value: { give: market.sideA.netTotal, receive: market.sideB.netTotal, gapPct: market.pctDiff },
    my_lineup_delta: myDelta, their_lineup_delta: theirDelta,
    horizon: Number.isFinite(week) ? "ROS" : "WEEK",
    confidence: calculationReliability, tradeability,
    calculationReliability,
    structure: { id: structureId, label: tradeability, acceptanceProbability: null, note: "Heuristique de structure et couverture du calcul ; intentions adverses non observées." },
    rosterConsequences,
    lineupChanges: { mine: changes(myBefore, myAfter), theirs: changes(theirBefore, theirAfter) },
    winWin: bilateral, warnings, notes,
    lineupAvailability: "UNVERIFIED", transactionTiming: "UNVERIFIED",
    lineups: { mine: { before: myBefore, after: myAfter }, theirs: { before: theirBefore, after: theirAfter } },
    rankScore: round(Math.min(myDelta, theirDelta) * 10 + myDelta + theirDelta - market.pctDiff - warnings.length * 10 - injured.length * 3)
  };
}
