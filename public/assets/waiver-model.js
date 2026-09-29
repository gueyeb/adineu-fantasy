/**
 * Adineu Fantasy — Waiver Evaluation Model v2 (docs/prd-waiver-model-v2.md).
 *
 * Event -> Opportunity -> Roster Fit -> FAAB. Pure functions only (no I/O): the server
 * (scripts/waiver-report.js) fetches Sleeper players/stats/projections and passes them in.
 *
 * Two separate answers, never merged: marketScore/faabMarket (what the player is worth to the
 * league) and fitScore/faabMaxForMe (what he is worth to one roster). Estimates, labeled as such.
 */
import { buildProjectedLineup } from "./trade-score.js?v=4";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026 } from "./league-settings.js";

export const LAST_REGULAR_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
/** $ of FAAB per point of rest-of-season surplus over replacement. Starting calibration: this
 * league's winning bids (Vele $301, Kamara $176, Kyler $181) for season-long starters. */
export const PRICE_PER_POINT = 3;
const ABSENT = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA"]);
const SEASON_ENDING = /acl|achilles|season|pectoral|lisfranc|patellar/i;

/** Horizon weights per duration class: weeks the promoted/breakout role is valued at role pace. */
export const DURATION_WEEKS = { RENTAL_1W: 1, UNCERTAIN: 0.5, SHORT_2_4W: 3 };

const round = (value, digits = 1) => Number(value.toFixed(digits));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Rest-of-regular-season weekly average from Sleeper's published future-week projections.
 * Only weeks that actually loaded count (a failed request never shrinks one player's horizon);
 * a bye counts 0. Returns null — so the caller falls back to the rank estimate — unless the
 * player is projected in at least half of the loaded non-bye weeks: one lone 20-pt week is not
 * a 20-pt season. */
export function computeRosPpg({ playerId, nflTeam, projectionsByWeek, week }) {
  const values = [];
  let loadedNonBye = 0;
  let projected = 0;
  for (let w = week; w <= LAST_REGULAR_WEEK; w++) {
    if (!projectionsByWeek[w]) continue;
    if (BYE_WEEKS_2026[nflTeam] === w) { values.push(0); continue; }
    loadedNonBye++;
    const points = projectionsByWeek[w][playerId]?.pts_ppr;
    if (Number.isFinite(points)) { values.push(points); projected++; }
  }
  return loadedNonBye > 0 && projected >= loadedNonBye / 2 && values.some(points => points > 0) ? round(mean(values)) : null;
}

/** Usage signals over completed weeks (oldest -> newest). Routes are not available: never imputed. */
export function buildOpportunitySignals(playerId, statsByWeek) {
  const weeks = statsByWeek.map(({ week, stats }) => {
    const row = stats[playerId];
    if (!row || !(row.off_snp > 0 || row.gp > 0)) return { week, played: false };
    return {
      week,
      played: true,
      snapShare: row.tm_off_snp > 0 ? (row.off_snp || 0) / row.tm_off_snp : null,
      opportunities: (row.rush_att || 0) + (row.rec_tgt || 0),
      redZone: (row.rush_rz_att || 0) + (row.rec_rz_tgt || 0),
      targets: row.rec_tgt || 0,
      points: row.pts_ppr ?? 0
    };
  });
  const played = weeks.filter(week => week.played);
  const last = played.at(-1) || null;
  const previous = played.slice(0, -1);
  const lastTwo = played.slice(-2);
  return {
    gamesPlayed: played.length,
    last,
    prevSnapShare: mean(previous.map(week => week.snapShare).filter(Number.isFinite)),
    prevOpportunities: mean(previous.map(week => week.opportunities)),
    recentPpg: lastTwo.length ? round(mean(lastTwo.map(week => week.points))) : null
  };
}

// Who was the starter before the news: Sleeper's search rank (player importance). The depth chart
// is updated *after* the injury (the backup is already listed first), so it is only a fallback.
function isAhead(mate, player) {
  if (Number.isFinite(mate.searchRank) && Number.isFinite(player.searchRank)) return mate.searchRank < player.searchRank;
  if (Number.isFinite(mate.depthOrder) && Number.isFinite(player.depthOrder)) return mate.depthOrder < player.depthOrder;
  return false;
}

/** Material news the rankings can't know yet. Returns { flags, duration, reasons }. */
export function detectEvents({ player, teammates = [], signals }) {
  const flags = [];
  const reasons = [];
  let duration = null;
  let share = 1;
  const samePosition = teammates.filter(mate => mate.position === player.position && mate.id !== player.id);
  const starter = samePosition.filter(mate => ABSENT.has(mate.injuryStatus) && isAhead(mate, player))
    .sort((a, b) => (a.searchRank ?? Infinity) - (b.searchRank ?? Infinity))[0];
  // Who inherits the role: the best healthy players behind the starter. A committee (a second
  // backup ranked close to the first) shares the promotion 50/50; a deep depth player gets none.
  const backups = starter ? [player, ...samePosition]
    .filter(mate => !ABSENT.has(mate.injuryStatus) && isAhead(starter, mate))
    .sort((a, b) => (a.searchRank ?? Infinity) - (b.searchRank ?? Infinity)) : [];
  const inheritors = backups.filter(mate => (mate.searchRank ?? Infinity) <= 1.5 * (backups[0]?.searchRank ?? Infinity)).slice(0, 2);
  // Real usage beats a stale rank: ≥ 50 % of the snaps last game makes him an heir outright.
  const provenByUsage = (signals?.last?.snapShare ?? 0) >= 0.5;
  if (starter && (provenByUsage || inheritors.some(mate => mate.id === player.id))) {
    flags.push("PROMOTION");
    share = provenByUsage ? 1 : 1 / inheritors.length;
    const seasonEnding = ["IR", "PUP"].includes(starter.injuryStatus) && SEASON_ENDING.test(starter.injuryBodyPart || "");
    duration = seasonEnding ? "SEASON_LONG"
      : ["IR", "PUP", "Sus"].includes(starter.injuryStatus) ? "SHORT_2_4W"
      : starter.injuryStatus === "Doubtful" ? "UNCERTAIN" : "RENTAL_1W";
    reasons.push(`${starter.name} ${starter.injuryStatus}${starter.injuryBodyPart ? ` (${starter.injuryBodyPart})` : ""} devant lui${share < 1 ? " (rôle partagé)" : ""}`);
  }
  const last = signals?.last;
  // A surge needs a baseline: a first recorded game is never a surge.
  if (last && Number.isFinite(last.snapShare) && last.snapShare >= 0.7 &&
      Number.isFinite(signals.prevSnapShare) && last.snapShare - signals.prevSnapShare >= 0.25) {
    flags.push("SNAP_SURGE");
    reasons.push(`${Math.round(last.snapShare * 100)} % des snaps en S${last.week}`);
  }
  // Carries + targets only measure usage for skill positions (a QB's volume is dropbacks).
  if (["RB", "WR", "TE"].includes(player.position) && last && last.opportunities >= 8 && signals.prevOpportunities !== null && last.opportunities >= 1.5 * signals.prevOpportunities) {
    flags.push("USAGE_SURGE");
    reasons.push(`${last.opportunities} opportunités en S${last.week} (vs ${round(signals.prevOpportunities)} avant)`);
  }
  if (!duration && flags.length) duration = "BREAKOUT";
  return { flags, duration, reasons, share, newsOverride: flags.length > 0 };
}

/** Weekly value over the rest of the season: role pace during the event window, ROS pace after.
 * A promoted backup keeps a small contingency value (handcuff) once the starter returns. */
export function effectivePpg({ rosPpg, weekProjection, recentPpg, lastRolePoints = null, duration, share = 1, week }) {
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const base = rosPpg ?? weekProjection ?? 0;
  if (!duration) return { effective: round(base), rolePpg: null, roleWeeks: 0 };
  // Role pace: best evidence of the new role (last game played in it, recent pace, this week's
  // projection), partially trusted over the ROS baseline. A promotion explained by an injury
  // ahead gets 75 %; an unexplained usage spike (BREAKOUT) only 50 %: one game is a signal.
  const evidence = Math.max(base, weekProjection ?? 0, recentPpg ?? 0, lastRolePoints ?? 0);
  const rolePpg = base + (duration === "BREAKOUT" ? 0.5 : 0.75 * share) * (evidence - base);
  if (duration === "BREAKOUT" || duration === "SEASON_LONG") return { effective: round(rolePpg), rolePpg: round(rolePpg), roleWeeks: remaining };
  const roleWeeks = Math.min(remaining, DURATION_WEEKS[duration]);
  const contingency = 0.1 * (remaining - roleWeeks) * Math.max(0, rolePpg - base);
  return { effective: round((roleWeeks * rolePpg + (remaining - roleWeeks) * base + contingency) / remaining), rolePpg: round(rolePpg), roleWeeks };
}

/** Replacement level per position = average effective pace of free agents ranked 2-6. */
export function replacementLevels(rows) {
  const levels = {};
  for (const position of FANTASY_POSITIONS) {
    const pace = rows.filter(row => row.position === position).map(row => row.effectivePpg).sort((a, b) => b - a).slice(1, 6);
    levels[position] = pace.length ? round(mean(pace)) : 0;
  }
  return levels;
}

function marketCategory(pct) {
  return pct >= 10 ? "PRIORITÉ" : pct >= 3 ? "STREAMING" : pct >= 1 ? "STASH" : "PROFONDEUR";
}

/** Market side: surplus over replacement for the rest of the season, priced in FAAB $. */
export function evaluateMarket({ rows, week, budget = GENERAL_SETTINGS_2026.waiver.budget, pricePerPoint = PRICE_PER_POINT }) {
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const replacement = replacementLevels(rows);
  return rows.map(row => {
    const surplus = Math.max(0, (row.effectivePpg - replacement[row.position]) * remaining);
    const faab = Math.min(budget, surplus * pricePerPoint);
    const pct = faab / budget * 100;
    const range = [Math.round(faab * 0.75), Math.min(budget, Math.round(faab * 1.25))];
    const usageBonus = row.usageSignal === "BUY_LOW" ? 5 : row.usageSignal === "SELL_HIGH" ? -3 : 0;
    return {
      ...row,
      replacementPpg: replacement[row.position],
      surplusPoints: round(surplus),
      marketScore: Math.round(Math.max(0, Math.min(100, 100 * Math.log1p(surplus) / Math.log1p(120) + usageBonus))),
      usageBonus,
      faabMarket: range,
      faabPct: range.map(value => round(value / budget * 100)),
      category: marketCategory(pct)
    };
  }).sort((a, b) => b.marketScore - a.marketScore || b.surplusPoints - a.surplusPoints || b.effectivePpg - a.effectivePpg);
}

/** Roster side: how much of the market surplus actually reaches THIS optimal lineup. */
export function evaluateRosterFit({ marketRow, myPlayers, paceOf, week, faabRemaining }) {
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const estimate = player => paceOf(player);
  const before = buildProjectedLineup(myPlayers, { estimate });
  const after = buildProjectedLineup([...myPlayers, marketRow], { estimate });
  const gainPerWeek = round(after.total - before.total);
  const gainPoints = Math.max(0, gainPerWeek * remaining);
  const fitScore = marketRow.surplusPoints > 0 ? Math.round(Math.min(100, 100 * gainPoints / marketRow.surplusPoints)) : (gainPoints > 0 ? 100 : 0);
  const slot = after.slots.find(entry => entry.sleeperId === String(marketRow.sleeperId))?.slot || null;
  const maxForMe = Math.round(Math.min(faabRemaining ?? Infinity, marketRow.faabMarket[1] * fitScore / 100));
  return { gainPerWeek, fitScore, slot, faabMaxForMe: gainPoints > 0 ? maxForMe : 0 };
}
