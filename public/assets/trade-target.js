import { assessTradeTiming, hasNoNflTeam } from "./trade-timing.js?v=43d83f975d";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026 } from "./league-settings.js?v=886f353394";
import { buildProjectedLineup, GAMES_MISSED_BY_STATUS, injuryStatus, returnWeekAssumption } from "./trade-score.js?v=1fdfeb1538";
import { paceWeekValue } from "./rest-of-season.js?v=9b85ae76ed";
import { playerKey } from "./trade-preferences.js?v=c5fec5ce56";

export const TRADE_TARGET_POSITIONS = ["QB", "RB", "WR", "TE"];
export const LAST_TRADE_TARGET_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;

/** A dated roster preference: an old target never silently rolls forward to another week. */
export function normalizeTradeIntent(value = {}, currentWeek = null) {
  const preferredPosition = TRADE_TARGET_POSITIONS.includes(value?.preferredPosition) ? value.preferredPosition : null;
  const targetWeek = Number.isInteger(value?.targetWeek) && value.targetWeek >= 1 && value.targetWeek <= LAST_TRADE_TARGET_WEEK ? value.targetWeek : null;
  const expired = targetWeek !== null && Number.isInteger(currentWeek) && targetWeek < currentWeek;
  return { preferredPosition: expired ? null : preferredPosition, targetWeek: expired ? null : targetWeek, expired };
}

export const tradeIntentStorageKey = ({ season, leagueId, rosterId }) => `adineu:trade-intent:${season}:${leagueId}:${rosterId}`;

/** Published target-week projections only. No reuse of ROS averages as future-week forecasts.
 * This is a hypothetical pregame lineup impact, not confirmation that a trade can execute in time.
 * Same week value as the weekly simulation (tradeReturnScenarios): an Out/IR player counts 0 before
 * the same return week (Sleeper's first re-projected week, else the status duration), and a target
 * week beyond the next two blends the projection with usage xFP like rosPpg (paceWeekValue). */
export function targetWeekTradeImpact({ myPlayers = [], theirPlayers = [], give = [], receive = [], targetWeek, currentWeek, projectionsByWeek = {}, timingContext = null, now = Date.now() }) {
  let timing = null;
  let lineupTiming = null;
  const unavailable = reasons => ({ status: "UNAVAILABLE", week: targetWeek ?? null, myDelta: null, theirDelta: null, reasons, timing, lineupTiming });
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > LAST_TRADE_TARGET_WEEK || (Number.isFinite(currentWeek) && targetWeek < currentWeek)) return unavailable(["TARGET_WEEK_INVALID"]);
  timing = assessTradeTiming({ players: [...give, ...receive], targetWeek, currentWeek, context: timingContext, now });
  // A fresh pregame optimum is not an executable comparison after any roster game locks.
  lineupTiming = assessTradeTiming({ players: [...myPlayers, ...theirPlayers].filter(player => !hasNoNflTeam(player) && BYE_WEEKS_2026[player.nflTeam] !== targetWeek), targetWeek, currentWeek, context: timingContext, now });
  if (timing.status === "BLOCKED" || lineupTiming.status === "BLOCKED") return { ...unavailable(["TARGET_LINEUP_WINDOW_PASSED"]), timing, lineupTiming };
  const projections = projectionsByWeek[targetWeek];
  if (!projections) return unavailable(["TARGET_PROJECTIONS_UNAVAILABLE"]);
  const own = new Set(myPlayers.map(playerKey));
  const theirs = new Set(theirPlayers.map(playerKey));
  if (give.some(player => !own.has(playerKey(player))) || receive.some(player => !theirs.has(playerKey(player))) ||
      myPlayers.some(player => theirs.has(playerKey(player)))) return unavailable(["TRADE_OWNERSHIP_CONFLICT"]);
  const allPlayers = [...new Map([...myPlayers, ...theirPlayers].map(player => [playerKey(player), player])).values()];
  const reasons = [];
  const assumptions = [];
  const valueOf = player => {
    // Sleeper lists no NFL team: no game this week, 0 with a stated assumption (unknown team still blocks).
    if (hasNoNflTeam(player)) { assumptions.push(`NO_NFL_TEAM_COUNTED_AS_ZERO:${playerKey(player)}`); return 0; }
    if (!Object.hasOwn(BYE_WEEKS_2026, player.nflTeam)) reasons.push(`TARGET_TEAM_UNVERIFIED:${playerKey(player)}`);
    if (BYE_WEEKS_2026[player.nflTeam] === targetWeek) return 0;
    const status = injuryStatus(player);
    if (status && !Object.hasOwn(GAMES_MISSED_BY_STATUS, status)) { reasons.push(`RETURN_OR_STATUS_UNVERIFIED:${playerKey(player)}`); return 0; }
    if ((GAMES_MISSED_BY_STATUS[status] || 0) >= 1) {
      if (targetWeek === currentWeek) return 0;
      const assumed = returnWeekAssumption(player, { week: currentWeek, projectionsByWeek });
      assumptions.push(`RETURN_WEEK_ASSUMED_S${assumed.week}:${assumed.basis}:${playerKey(player)}`);
      if (targetWeek < assumed.week) return 0;
    }
    const projected = projections[playerKey(player)]?.pts_ppr;
    if (!Number.isFinite(projected) || projected < 0) { reasons.push(`TARGET_PROJECTION_MISSING:${playerKey(player)}`); return 0; }
    return Number.isInteger(currentWeek) ? paceWeekValue({ projected, xfp: player.xfp, position: player.position, week: targetWeek, liveWeek: currentWeek }) : projected;
  };
  // Bench coverage is required too: an unprojected bench player could change the optimum.
  const values = new Map(allPlayers.map(player => [playerKey(player), valueOf(player)]));
  if (reasons.length) return unavailable([...new Set(reasons)]);
  const exchange = (players, out, incoming) => players.filter(player => !out.some(asset => playerKey(asset) === playerKey(player))).concat(incoming);
  const total = players => buildProjectedLineup(players, { estimate: player => values.get(playerKey(player)) }).total;
  return { status: "PROJECTED", week: targetWeek, myDelta: Number((total(exchange(myPlayers, give, receive)) - total(myPlayers)).toFixed(1)),
    theirDelta: Number((total(exchange(theirPlayers, receive, give)) - total(theirPlayers)).toFixed(1)), reasons: [], assumptions: [...new Set(assumptions)], source: "Sleeper target-week projections", transactionTiming: timing.status, timing, lineupTiming };
}

/** Prefer a demonstrated positive target gain, then covered estimates; unknown is never zero. */
export function compareTargetWeekImpacts(left, right) {
  const a = left?.myDelta;
  const b = right?.myDelta;
  const knownA = Number.isFinite(a);
  const knownB = Number.isFinite(b);
  return Number(knownB && b > 0) - Number(knownA && a > 0) ||
    Number(knownB) - Number(knownA) || (knownA && knownB ? b - a : 0);
}
