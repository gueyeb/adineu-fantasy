/**
 * Adineu Fantasy — Waiver Evaluation Model v2 (docs/prd-waiver-model-v2.md).
 *
 * Event -> Opportunity -> Roster Fit -> FAAB. Pure functions only (no I/O): the server
 * (scripts/waiver-report.js) fetches Sleeper players/stats/projections and passes them in.
 *
 * Two separate answers, never merged: marketScore/faabMarket (what the player is worth to the
 * league) and fitScore/faabMaxForMe (what he is worth to one roster). Estimates, labeled as such.
 */
import { buildProjectedLineup } from "./trade-score.js?v=eae8f8dc83";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026 } from "./league-settings.js?v=f6d1bf5212";

export const LAST_REGULAR_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
/** $ of FAAB per point of rest-of-season surplus over replacement. Starting calibration: this
 * league's winning bids (Vele $301, Kamara $176, Kyler $181) for season-long starters. */
export const PRICE_PER_POINT = 3;
const ABSENT = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA"]);


/** Horizon weights per duration class: weeks the promoted/breakout role is valued at role pace. */
export const DURATION_WEEKS = { RENTAL_1W: 1, UNCERTAIN: 1, SHORT_2_4W: 3 };

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
    series: weeks,
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
    const seasonEnding = starter.seasonEndingConfirmed === true;
    duration = seasonEnding ? "SEASON_LONG"
      : ["IR", "PUP", "Sus"].includes(starter.injuryStatus) ? "UNCERTAIN"
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
  return { flags, duration, reasons, share, roleConfirmation: flags.includes("PROMOTION") ? "UNCONFIRMED" : "NOT_APPLICABLE", newsOverride: flags.length > 0 };
}

/** Market estimate from projections only. Realized scores never confirm a future role.
 * A current-week projection is valued for one week unless an explicit short window exists.
 * Confirmed duration takes precedence; otherwise season-long and breakout estimates use ROS. */
export function effectivePpg({ rosPpg, weekProjection, duration, week, confirmedRoleWeeks = null }) {
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const base = Number.isFinite(rosPpg) ? rosPpg : Number.isFinite(weekProjection) ? weekProjection : 0;
  const confirmedWindow = Number.isInteger(confirmedRoleWeeks) && confirmedRoleWeeks > 0;
  const metadata = { method: "PROJECTION_WINDOW_V1", recentScoresUsed: false,
    inferredShareUsed: false, contingencyValue: null, calibrated: false,
    roleWindowSource: confirmedWindow ? "CONFIRMED_ROLE_EVIDENCE" : "HEURISTIC_OR_ROS" };
  if (!duration && !confirmedWindow) return { effective: round(base), rolePpg: null, roleWeeks: 0, ...metadata };
  if (!confirmedWindow && (duration === "BREAKOUT" || duration === "SEASON_LONG")) {
    return { effective: round(base), rolePpg: round(base), roleWeeks: remaining, ...metadata };
  }
  const roleWeeks = Math.min(remaining, confirmedWindow ? confirmedRoleWeeks : DURATION_WEEKS[duration] ?? 1);
  const rolePpg = Number.isFinite(weekProjection) ? weekProjection : base;
  return { effective: round((roleWeeks * rolePpg + (remaining - roleWeeks) * base) / remaining),
    rolePpg: round(rolePpg), roleWeeks, ...metadata };
}

/** Replacement level per position = average effective pace of free agents ranked 2-6. */
export function replacementLevels(rows) {
  const levels = {};
  for (const position of FANTASY_POSITIONS) {
    const pace = rows.filter(row => row.position === position && row.valuationCovered !== false).map(row => row.effectivePpg).sort((a, b) => b - a).slice(1, 6);
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
    // No projection, rank or usable pace: the player is analysed but never priced.
    if (row.valuationCovered === false) {
      return { ...row, replacementPpg: replacement[row.position], surplusPoints: null, marketScore: null,
        usageBonus: 0, faabMarket: null, faabPct: null, category: "NON VALORISÉ" };
    }
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
  }).sort((a, b) => Number(b.valuationCovered !== false) - Number(a.valuationCovered !== false) ||
    b.marketScore - a.marketScore || b.surplusPoints - a.surplusPoints || b.effectivePpg - a.effectivePpg ||
    String(a.sleeperId).localeCompare(String(b.sleeperId)));
}

/** Evaluate complete, alternative roster transactions on one shared role horizon.
 * The lineup already includes the production lost on a cut. Only the estimated bench-option
 * premium is subtracted separately, avoiding a second charge for the same lineup loss. */
export function evaluateRosterFit({ marketRow, myPlayers, paceOf, week, faabRemaining,
  protectedIds = new Set(), lockedIds = new Set(), starterIds = new Set(), weeklyPaceOf = null,
  projectionCovered = null, replacementByPosition = {}, hasOpenRosterSlot = false, frozenSlots = {}, rosterPreferences = [],
  reserveIds = new Set() }) {
  const remaining = Math.max(1, LAST_REGULAR_WEEK - week + 1);
  const horizonWeeks = Math.min(remaining, marketRow.events?.roleWeeks > 0 ? marketRow.events.roleWeeks : remaining);
  // Bench-option premium of a cut, one named component per input. A missing input contributes
  // nothing and is listed: an unknown option is not a low option.
  const optionComponents = player => {
    if (!player) return { applicable: false, usagePremium: 0, buyLowPremium: 0, projectionUpside: 0, total: 0, missingInputs: [], coverage: "NOT_APPLICABLE", inputs: null };
    const pace = paceOf(player);
    const inputs = { usageScore: player.usageScore ?? null, usageSignal: player.usageSignal ?? null, usageTrend: player.usageTrend ?? null,
      weekProjection: Number.isFinite(player.projectedPpg) ? round(player.projectedPpg) : null, pace: Number.isFinite(pace) ? round(pace) : null,
      rosPpg: player.rosPpg ?? null, lastSnapShare: player.signals?.last?.snapShare ?? null, prevSnapShare: player.signals?.prevSnapShare ?? null,
      lastOpportunities: player.signals?.last?.opportunities ?? null, prevOpportunities: player.signals?.prevOpportunities ?? null,
      gamesPlayed: player.signals?.gamesPlayed ?? null };
    if (!["RB", "WR", "TE"].includes(player.position)) return { applicable: false, usagePremium: 0, buyLowPremium: 0, projectionUpside: 0, total: 0, missingInputs: [], coverage: "NOT_APPLICABLE", inputs };
    const missingInputs = [...(Number.isFinite(player.usageScore) ? [] : ["USAGE_SCORE"]), ...(Number.isFinite(player.projectedPpg) ? [] : ["WEEK_PROJECTION"])];
    const usagePremium = Number.isFinite(player.usageScore) ? round(Math.max(0, player.usageScore - 50) / 50 * 1.5, 2) : 0;
    const buyLowPremium = player.usageSignal === "BUY_LOW" ? 1 : 0;
    const projectionUpside = Number.isFinite(player.projectedPpg) && Number.isFinite(pace) ? round(Math.max(0, player.projectedPpg - pace) * 0.15, 2) : 0;
    return { applicable: true, usagePremium, buyLowPremium, projectionUpside, total: round(usagePremium + buyLowPremium + projectionUpside),
      missingInputs, coverage: missingInputs.length === 2 ? "NONE" : missingInputs.length ? "PARTIAL" : "COMPLETE", inputs, calibrated: false };
  };
  // A reserve (IR) slot cannot be started without another roster move: those players are held out
  // of every simulated lineup, so their missing projections no longer block the whole horizon.
  const startable = players => players.filter(p => !reserveIds.has(String(p.sleeperId)));
  const activePlayers = startable(myPlayers);
  const beforeRos = buildProjectedLineup(activePlayers, { estimate: paceOf });
  const candidates = myPlayers.filter(player => !lockedIds.has(String(player.sleeperId)) &&
    !protectedIds.has(String(player.sleeperId)) && (!starterIds.has(String(player.sleeperId)) || player.position === marketRow.position));
  // Why a roster player was never compared as a cut: a lone eligible cut is a constraint, not a ranking.
  const cutExclusions = myPlayers.filter(player => !candidates.includes(player)).map(player => ({ playerId: String(player.sleeperId), name: player.name ?? null,
    reason: protectedIds.has(String(player.sleeperId)) ? (reserveIds.has(String(player.sleeperId)) ? "RESERVE_SLOT" : "PROTECTED")
      : lockedIds.has(String(player.sleeperId)) ? "GAME_LOCKED_OR_KICKOFF_UNKNOWN" : "STARTER_AT_ANOTHER_POSITION" }));
  const simulate = cut => {
    const pool = [...activePlayers.filter(p => !cut || String(p.sleeperId) !== String(cut.sleeperId)), marketRow];
    const coverageIssues = new Set();
    const coverageBlockers = [];
    const blockersFor = (players, w) => players.filter(p => !projectionCovered(p, w)).map(p => ({ week: w,
      playerId: String(p.sleeperId), name: p.name ?? null, role: p === marketRow ? "CANDIDATE" : "ROSTER", injuryStatus: p.injuryStatus ?? null }));
    const priorRolesCovered = w => {
      const covered = myPlayers.every(p => !p.plannedRoleWindow ||
        (w >= p.plannedRoleWindow.startWeek && w < p.plannedRoleWindow.endWeekExclusive));
      if (!covered) coverageIssues.add(`UNCONFIRMED_PRIOR_ACQUISITION_ROLE_WEEK_${w}`);
      return covered;
    };
    const weeklyLineupDeltas = Array.from({ length: Math.ceil(horizonWeeks) }, (_, i) => {
      const w = week + i;
      const estimate = p => weeklyPaceOf ? weeklyPaceOf(p, w) : paceOf(p);
      const fixedSlots = w === week ? frozenSlots : {};
      // Unknown values are used only to construct a diagnostic lineup, never a publishable gain.
      const safeEstimate = p => Number.isFinite(estimate(p)) ? estimate(p) : 0;
      const before = buildProjectedLineup(activePlayers, { estimate: safeEstimate, fixedSlots });
      const after = buildProjectedLineup(pool, { estimate: safeEstimate, fixedSlots });
      const blockers = projectionCovered ? blockersFor([...activePlayers, marketRow], w) : [];
      const projectionsCovered = !blockers.length;
      const covered = priorRolesCovered(w) && projectionsCovered;
      if (!projectionsCovered) { coverageIssues.add(`MISSING_PROJECTIONS_WEEK_${w}`); coverageBlockers.push(...blockers); }
      const newEmptySlots = after.emptySlots.filter(slot => !before.emptySlots.includes(slot));
      if (newEmptySlots.length) coverageIssues.add("ROSTER_COMPOSITION_VIOLATION");
      return { week: w, delta: covered && !newEmptySlots.length ? round(after.total - before.total) : null,
        beforeTotal: covered ? before.total : null, afterTotal: covered ? after.total : null,
        slot: after.slots.find(slot => slot.sleeperId === String(marketRow.sleeperId))?.slot || null,
        weight: Math.min(1, horizonWeeks - i), covered,
        ...(marketRow.position === 'TE' ? { teUsage: {
          before: covered ? before.slots.filter(slot => slot.slot === 'TE').map(slot => ({ playerId: slot.sleeperId, name: slot.name, projectedPoints: slot.projectedPpg })) : null,
          after: covered ? after.slots.filter(slot => slot.slot === 'TE').map(slot => ({ playerId: slot.sleeperId, name: slot.name, projectedPoints: slot.projectedPpg })) : null,
          previousTeSlotAfter: covered ? after.slots.find(slot => slot.sleeperId && slot.sleeperId === before.slots.find(slot => slot.slot === 'TE')?.sleeperId)?.slot ?? null : null
        } } : {}) };
    });
    // A rental ends, but a cut is permanent. Price only lost lineup production after the role;
    // never extend the rental's positive surplus into those weeks.
    const postRoleCutDeltas = [];
    if (cut && horizonWeeks < remaining) {
      const retained = activePlayers.filter(p => String(p.sleeperId) !== String(cut.sleeperId));
      for (let w = week + Math.ceil(horizonWeeks); w <= LAST_REGULAR_WEEK; w++) {
        const estimate = p => weeklyPaceOf ? weeklyPaceOf(p, w) : paceOf(p);
        const blockers = projectionCovered ? blockersFor(activePlayers, w) : [];
        const projectionsCovered = !blockers.length;
        const covered = priorRolesCovered(w) && projectionsCovered;
        if (!projectionsCovered) { coverageIssues.add(`MISSING_POST_ROLE_PROJECTIONS_WEEK_${w}`); coverageBlockers.push(...blockers); }
        const safeEstimate = p => Number.isFinite(estimate(p)) ? estimate(p) : 0;
        const before = buildProjectedLineup(activePlayers, { estimate: safeEstimate });
        const after = buildProjectedLineup(retained, { estimate: safeEstimate });
        postRoleCutDeltas.push({ week: w, lostPoints: covered ? round(Math.max(0, before.total - after.total)) : null });
      }
    }
    const postRoleCutCostTotal = postRoleCutDeltas.some(row => row.lostPoints === null) ? null : round(postRoleCutDeltas.reduce((sum, row) => sum + row.lostPoints, 0));
    const grossGainTotal = coverageIssues.size ? null : round(weeklyLineupDeltas.reduce((sum, row) => sum + row.delta * row.weight, 0));
    const option = optionComponents(cut);
    const optionValuePerWeek = option.total;
    const dropCostTotal = round(optionValuePerWeek * horizonWeeks);
    const netGainTotal = grossGainTotal === null ? null : round(grossGainTotal - dropCostTotal - postRoleCutCostTotal);
    const preference = rosterPreferences.find(row => row.playerId === String(cut?.sleeperId));
    const preferencePenaltyTotal = preference?.penaltyPoints ?? 0;
    // A rental ends; the cut does not. Cutting an organic riser for it must be paid for by the
    // documented net gain. Uncalibrated, so it only orders cuts: netGainTotal keeps its definition.
    const emerging = cut?.emergingRole ?? null;
    const organicRiser = Boolean(cut) && horizonWeeks < remaining && emerging?.progression === "RISING" && emerging.progressionSource === "ORGANIC";
    const progressionSacrificeTotal = !organicRiser ? 0 : Number.isFinite(emerging.optionValuePerWeek) ? round(emerging.optionValuePerWeek * remaining) : null;
    const progressionGuard = !organicRiser ? "NOT_APPLICABLE" : progressionSacrificeTotal === null ? "UNPRICED"
      : netGainTotal !== null && netGainTotal - progressionSacrificeTotal > 0 ? "JUSTIFIED" : netGainTotal === null ? "UNPRICED" : "NOT_JUSTIFIED";
    const selectionScore = netGainTotal === null ? null : round(netGainTotal - preferencePenaltyTotal - (progressionSacrificeTotal ?? 0));
    return { preference, preferencePenaltyTotal, selectionScore, progressionGuard, progressionSacrificeTotal, emergingRole: emerging, sleeperId: cut?.sleeperId ?? null, name: cut?.name ?? "Place libre", position: cut?.position ?? null,
      nflTeam: cut?.nflTeam || null, weeklyLineupDeltas, grossGainTotal, netGainTotal, dropCostTotal,
      postRoleCutCostTotal, postRoleCutDeltas,
      // Every term of the cut cost, with the roster inputs it was computed from.
      dropCostComponents: { horizonWeeks, usagePremiumPerWeek: option.usagePremium, buyLowPremiumPerWeek: option.buyLowPremium,
        projectionUpsidePerWeek: option.projectionUpside, optionValuePerWeek, optionTotal: dropCostTotal,
        postRoleLineupLossTotal: postRoleCutCostTotal, preferencePenaltyTotal: rosterPreferences.find(row => row.playerId === String(cut?.sleeperId))?.penaltyPoints ?? 0,
        progressionSacrificeTotal, progressionGuard, emergingRole: emerging,
        lineupLossIncludedInGross: true, optionApplicable: option.applicable, optionCoverage: option.coverage,
        missingInputs: option.missingInputs, inputs: option.inputs, calibrated: false },
      coverageBlockers,
      immediateValuePerWeek: cut ? round(Math.max(0, paceOf(cut) - (replacementByPosition[cut.position] ?? paceOf(cut)))) : 0,
      optionValuePerWeek, totalCostPerWeek: optionValuePerWeek,
      usageScore: cut?.usageScore ?? null, usageSignal: cut?.usageSignal || null,
      byeWeek: BYE_WEEKS_2026[cut?.nflTeam] ?? null,
      regretRisk: option.coverage === "NONE" ? "UNKNOWN" : optionValuePerWeek >= 1.5 ? "HIGH" : optionValuePerWeek >= 0.7 ? "MEDIUM" : "LOW",
      coverageIssues: [...coverageIssues], legalTransaction: !coverageIssues.has("ROSTER_COMPOSITION_VIOLATION") };
  };
  const scenarios = (hasOpenRosterSlot ? [null] : candidates).map(simulate).sort((a, b) =>
    Number(b.legalTransaction && b.netGainTotal !== null) - Number(a.legalTransaction && a.netGainTotal !== null) ||
    Number(a.progressionGuard === "UNPRICED") - Number(b.progressionGuard === "UNPRICED") ||
    (b.selectionScore ?? -Infinity) - (a.selectionScore ?? -Infinity) ||
    Number(b.position === marketRow.position) - Number(a.position === marketRow.position) ||
    String(a.sleeperId).localeCompare(String(b.sleeperId)));
  const chosen = scenarios[0] || null;
  const horizonCovered = Boolean(chosen && chosen.netGainTotal !== null);
  // Without a covered comparison the order above is only the id tie-break: it designates nobody.
  const cutRanked = horizonCovered;
  const coveredCuts = scenarios.filter(row => row.sleeperId && row.netGainTotal !== null);
  const legalTransaction = Boolean(chosen?.legalTransaction);
  const gainPerWeek = horizonCovered ? round(chosen.grossGainTotal / horizonWeeks) : null;
  const netGainAverage = horizonCovered ? round(chosen.netGainTotal / horizonWeeks) : null;
  const netGainPerWeek = horizonCovered ? round(chosen.netGainTotal / remaining) : null;
  const fitScore = horizonCovered && marketRow.surplusPoints > 0 ? Math.round(Math.min(100, 100 * Math.max(0, chosen.grossGainTotal) / marketRow.surplusPoints)) : 0;
  const maxForMe = !horizonCovered || !legalTransaction ? 0 : !Number.isFinite(faabRemaining) || faabRemaining < 0 ? null : Math.max(0, Math.floor(Math.min(faabRemaining,
    marketRow.faabMarket?.[1] ?? 0, chosen.selectionScore * PRICE_PER_POINT)));
  return {
    preferencePenaltyTotal: chosen?.preferencePenaltyTotal ?? 0,
    selectionScore: chosen?.selectionScore ?? null,
    preferenceOverridden: Boolean(chosen?.preference),
    progressionGuard: chosen?.progressionGuard ?? "NOT_APPLICABLE", progressionSacrificeTotal: chosen ? chosen.progressionSacrificeTotal : 0,
    appliedPreference: chosen?.preference ?? null,
    gainPerWeek, grossGainAverage: gainPerWeek, horizonWeeks, netGainAverage, netGainPerWeek, netGainRosWeeks: remaining,
    grossGainTotal: chosen?.grossGainTotal ?? null, netGainTotal: chosen?.netGainTotal ?? null,
    dropCostTotal: chosen?.dropCostTotal ?? null,
    postRoleCutCostTotal: chosen?.postRoleCutCostTotal ?? null,
    postRoleCutDeltas: chosen?.postRoleCutDeltas ?? [], targetWeekDelta: chosen?.weeklyLineupDeltas[0]?.delta ?? null,
    weeklyLineupDeltas: chosen?.weeklyLineupDeltas ?? [], slot: chosen?.weeklyLineupDeltas.find(row => row.slot)?.slot ?? null,
    scenariosAreAlternatives: true, legalTransaction, horizonCovered, coverageIssues: chosen?.coverageIssues ?? ["NO_LEGAL_CUT"],
    coverageBlockers: [...new Map((chosen?.coverageBlockers ?? []).map(row => [`${row.week}:${row.playerId}`, row])).values()],
    assumptions: reserveIds.size ? ["RESERVE_PLAYERS_NOT_STARTABLE"] : [],
    cutSelection: !chosen ? "NO_LEGAL_CUT" : !chosen.sleeperId ? "OPEN_ROSTER_SLOT" : !cutRanked ? "UNRANKED_INCOMPLETE_COVERAGE" : candidates.length === 1 ? "ONLY_ELIGIBLE_CUT" : "RANKED_BY_NET_GAIN",
    cutExclusions,
    comparedCutCount: scenarios.filter(row => row.sleeperId).length, coveredCutCount: coveredCuts.length,
    fitScore, dropCandidate: chosen?.sleeperId && cutRanked ? { sleeperId: chosen.sleeperId, name: chosen.name, position: chosen.position } : null,
    dropCostComponents: cutRanked ? chosen?.dropCostComponents ?? null : null,
    dropCandidates: scenarios.filter(row => row.sleeperId).slice(0, 3).map(row => ({ ...row, ranked: row.netGainTotal !== null })),
    dropCostPerWeek: cutRanked ? chosen?.totalCostPerWeek ?? 0 : null, dropOptionValuePerWeek: cutRanked ? chosen?.optionValuePerWeek ?? 0 : null,
    faabMaxForMe: maxForMe, rosLineupBaseline: beforeRos.total, contingencyValue: null
  };
}

/** Turns market upside and roster-specific net gain into an explicit action, not one mixed rank. */
export function classifyWaiverDecision({ position, marketScore = 0, flags = [], usageSignal = null, netGain = 0, availability = null, roleConfirmation = "NOT_APPLICABLE", legalTransaction = true, horizonCovered = true, targetWeekDelta = null }) {
  const skillPosition = ["RB", "WR", "TE"].includes(position);
  const incompleteStreamingOpportunity = ["QB", "K", "DEF"].includes(position) && !horizonCovered && Number.isFinite(targetWeekDelta) && targetWeekDelta > 0;
  const immediateValue = Math.round(Math.max(0, Math.min(100, (targetWeekDelta ?? netGain) * 25)));
  const eventBonus = flags.includes("PROMOTION") ? 20
    : flags.some(flag => ["SNAP_SURGE", "USAGE_SURGE"].includes(flag)) ? 15 : 0;
  const strategicUpside = Math.round(Math.max(0, Math.min(100,
    marketScore * (skillPosition ? 1 : 0.55) + eventBonus + (usageSignal === "BUY_LOW" ? 10 : 0)
  )));
  const decisionClass = flags.includes("PROMOTION") ? "INJURY_PROMOTION"
    : ["QB", "K", "DEF"].includes(position) && (netGain > 0 || incompleteStreamingOpportunity) ? "STREAMER"
    : flags.some(flag => ["SNAP_SURGE", "USAGE_SURGE"].includes(flag)) ? "BREAKOUT"
    : netGain >= 1.5 ? "STARTER_UPGRADE"
    : skillPosition && strategicUpside >= 40 ? "UPSIDE_STASH"
    : "NO_ACTION";
  let recommendedAction = netGain >= 1.5 && immediateValue >= 38 ? "ADD_NOW"
    : netGain > 0 && (immediateValue >= 15 || decisionClass === "STREAMER") ? "CLAIM_IF_CHEAP"
    : strategicUpside >= 40 || incompleteStreamingOpportunity ? "WATCH"
    : "IGNORE";
  if (["ADD_NOW", "CLAIM_IF_CHEAP"].includes(recommendedAction)) {
    if (!legalTransaction || !horizonCovered || !availability || availability.availability === "ROSTERED" || availability.canStartTargetWeek !== true || (flags.includes("PROMOTION") && roleConfirmation !== "CONFIRMED")) recommendedAction = "WATCH";
    else if (!availability.canAddNow) recommendedAction = availability.availability === "WAIVER_LOCKED" ? "CLAIM_IF_CHEAP" : "WATCH";
    else if (recommendedAction === "CLAIM_IF_CHEAP") recommendedAction = "WATCH";
  }
  const interpretation = recommendedAction === "WATCH" && netGain <= 0
    ? "High league-market upside, but not worth cutting a current bench asset today."
    : recommendedAction === "CLAIM_IF_CHEAP"
      ? "Positive roster value, but not enough edge for an aggressive bid."
      : recommendedAction === "ADD_NOW"
        ? "Meaningful net lineup upgrade after accounting for the likely cut."
        : "No actionable edge for this roster today.";
  const actionBlockers = [
    ...(!legalTransaction ? ["NO_LEGAL_TRANSACTION"] : []),
    ...(!horizonCovered ? ["INCOMPLETE_HORIZON"] : []),
    ...(!availability || availability.canStartTargetWeek !== true ? ["TARGET_WEEK_ELIGIBILITY_UNVERIFIED"] : []),
    ...(flags.includes("PROMOTION") && roleConfirmation !== "CONFIRMED" ? ["ROLE_UNCONFIRMED"] : [])
  ];
  return { immediateValue, strategicUpside, decisionClass, recommendedAction,
    interpretation: actionBlockers.length ? `Conditional scenario: ${actionBlockers.join(", ")}.` : interpretation, actionBlockers };
}
