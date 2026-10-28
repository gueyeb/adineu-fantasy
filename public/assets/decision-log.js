/**
 * Adineu Fantasy — journal des décisions réelles (docs/prd-model-challenge.md, chantier 5).
 *
 * What the team actually did, rebuilt from Sleeper: claims won and lost (with the bid), free adds,
 * cuts, trades and each completed week's lineup. Each move gets its outcome over a fixed window
 * (points of the players added against the players cut, at the league's scoring), the model's
 * recommendation when one was recorded for that week, and the operator's own reason.
 * Pure functions, no I/O: scripts/decision-log.js fetches, the Coach page renders.
 */

export const OUTCOME_WINDOW_WEEKS = 4;
export const REVIEW_WINDOWS = [2, 4];
export const REASON_MAX = 500;
/** Operator's answer to one Tuesday recommendation. A choice is not a move: only Sleeper says what was executed. */
export const PLAN_CHOICES = ["ACCEPTED", "REFUSED", "DEFERRED"];
export const MOVE_KINDS = ["CLAIM_WON", "CLAIM_LOST", "FREE_ADD", "DROP", "TRADE"];
const INVALID_BID_NOTE = /roster will have too many players|already started playing/i;

const round = value => Number(value.toFixed(2));

/** Fantasy week a move was made for: the first week whose last game had not kicked off yet. */
export function decisionWeekOf(timestamp, lastKickoffByWeek) {
  const weeks = Object.keys(lastKickoffByWeek).map(Number).sort((a, b) => a - b);
  return weeks.find(week => Date.parse(lastKickoffByWeek[week]) > timestamp) ?? null;
}

/** Last kickoff of each regular-season week, from the nflverse schedule. */
export function lastKickoffByWeek(games = []) {
  const last = {};
  for (const game of games) {
    if (!game.kickoffAt) continue;
    if (!last[game.week] || Date.parse(game.kickoffAt) > Date.parse(last[game.week])) last[game.week] = game.kickoffAt;
  }
  return last;
}

/**
 * One entry per move of `rosterId`. A lost claim is kept: the bid and the player missed are a
 * decision too. A claim Sleeper rejected for a full roster is kept as lost with its note.
 */
export function buildMoveEntries({ transactions = [], rosterId, season, weekOf, playerOf = () => null }) {
  const player = id => ({ id: String(id), name: playerOf(id)?.name ?? `Player #${id}`, position: playerOf(id)?.position ?? null });
  const entries = [];
  for (const row of transactions) {
    const mineAdded = Object.entries(row.adds || {}).filter(([, owner]) => owner === rosterId).map(([id]) => player(id));
    const mineDropped = Object.entries(row.drops || {}).filter(([, owner]) => owner === rosterId).map(([id]) => player(id));
    if (!mineAdded.length && !mineDropped.length) continue;
    let kind = null;
    if (row.type === "waiver") kind = row.status === "complete" ? "CLAIM_WON" : row.status === "failed" ? "CLAIM_LOST" : null;
    else if (row.type === "free_agent" && row.status === "complete") kind = mineAdded.length ? "FREE_ADD" : "DROP";
    else if (row.type === "trade" && row.status === "complete") kind = "TRADE";
    if (!kind) continue;
    const occurredAt = Number(row.status_updated ?? row.created);
    const bid = row.type === "waiver" && Number.isFinite(Number(row.settings?.waiver_bid)) ? Number(row.settings.waiver_bid) : null;
    entries.push({ id: `${season}:${rosterId}:${row.transaction_id}`, season, rosterId, kind, week: weekOf(occurredAt), occurredAt: new Date(occurredAt).toISOString(),
      added: mineAdded, dropped: kind === "CLAIM_LOST" ? [] : mineDropped, bid,
      note: kind === "CLAIM_LOST" ? (INVALID_BID_NOTE.test(row.metadata?.notes || "") ? "INVALID_CLAIM" : "OUTBID") : null });
  }
  return entries.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
}

/** Winning bid and team for each (leg, player) a claim of ours lost. */
export function winningClaims(transactions = []) {
  const won = new Map();
  for (const row of transactions) {
    if (row.type !== "waiver" || row.status !== "complete") continue;
    for (const [id, rosterId] of Object.entries(row.adds || {})) won.set(`${row.leg}|${id}`, { rosterId, bid: Number(row.settings?.waiver_bid ?? 0) });
  }
  return won;
}

/**
 * Outcome over OUTCOME_WINDOW_WEEKS completed weeks from the decision week. Points come from the
 * league scoring whoever held the player; `startedPoints` counts only the weeks the added player
 * sat in this roster's starting lineup. Pending until the decision week is completed.
 */
export function evaluateMove(entry, { pointsOf, startedOf = () => null, lastCompletedWeek, window = OUTCOME_WINDOW_WEEKS }) {
  if (!Number.isInteger(entry.week) || entry.week > lastCompletedWeek) return { status: "PENDING" };
  const weeks = [];
  for (let week = entry.week; week <= Math.min(lastCompletedWeek, entry.week + window - 1); week++) weeks.push(week);
  const total = players => round(players.reduce((sum, row) => sum + weeks.reduce((acc, week) => acc + (pointsOf(row.id, week) ?? 0), 0), 0));
  const added = total(entry.added);
  const dropped = total(entry.dropped);
  const started = entry.kind === "CLAIM_LOST" ? null
    : round(entry.added.reduce((sum, row) => sum + weeks.reduce((acc, week) => acc + (startedOf(row.id, week) ?? 0), 0), 0));
  return { status: weeks.length >= window ? "COMPLETE" : "PARTIAL", fromWeek: entry.week, throughWeek: weeks.at(-1), weeks: weeks.length,
    addedPoints: added, droppedPoints: dropped, net: entry.kind === "CLAIM_LOST" ? null : round(added - dropped), startedPoints: started,
    pointsPerFaab: entry.kind === "CLAIM_WON" && entry.bid > 0 ? round(added / entry.bid) : null,
    reviews: reviewWindows(entry, { pointsOf, lastCompletedWeek }) };
}

/**
 * Fixed two- and four-week reviews from the decision week. A window is null until its last week
 * is completed: a partial window is never shown as the review.
 */
export function reviewWindows(entry, { pointsOf, lastCompletedWeek, windows = REVIEW_WINDOWS }) {
  return Object.fromEntries(windows.map(size => {
    const throughWeek = entry.week + size - 1;
    if (!Number.isInteger(entry.week) || throughWeek > lastCompletedWeek) return [`weeks${size}`, null];
    const total = players => round(players.reduce((sum, row) => {
      for (let week = entry.week; week <= throughWeek; week++) sum += pointsOf(row.id, week) ?? 0;
      return sum;
    }, 0));
    const added = total(entry.added);
    const dropped = total(entry.dropped);
    return [`weeks${size}`, { fromWeek: entry.week, throughWeek, addedPoints: added, droppedPoints: dropped,
      net: entry.kind === "CLAIM_LOST" ? null : round(added - dropped) }];
  }));
}

/**
 * Lineup decision of each completed week: points scored against the best lineup the same roster
 * could have started (`optimalOf` is the shared weekly-recap computation).
 */
export function buildLineupEntries({ matchupsByWeek = {}, rosterId, season, lastCompletedWeek, optimalOf }) {
  const entries = [];
  for (let week = 1; week <= lastCompletedWeek; week++) {
    const mine = (matchupsByWeek[week] || []).find(row => row.roster_id === rosterId);
    if (!mine) continue;
    const actual = Number(mine.points);
    const optimal = optimalOf(mine);
    if (!Number.isFinite(actual) || !Number.isFinite(optimal)) continue;
    entries.push({ id: `${season}:${rosterId}:lineup:${week}`, season, rosterId, kind: "LINEUP", week, occurredAt: null, added: [], dropped: [], bid: null, note: null,
      outcome: { status: "COMPLETE", actualPoints: round(actual), optimalPoints: round(optimal), pointsLeft: round(Math.max(0, optimal - actual)) } });
  }
  return entries;
}

/**
 * Model view of each move, from the recommendations recorded for that week (Tuesday plan or a
 * local decision snapshot): RECOMMENDED, NOT_RECOMMENDED (evaluated, no add/claim), NOT_ON_BOARD
 * (not among the evaluated free agents), or NO_MODEL_RECORD (nothing recorded that week).
 * `recommendationsByWeek` week -> [{ playerId, action, suggestedBid, source }].
 */
export function attachModelView(entry, recommendationsByWeek = {}) {
  if (entry.kind === "LINEUP" || entry.kind === "DROP") return { ...entry, model: null };
  const recorded = recommendationsByWeek[entry.week];
  if (!recorded) return { ...entry, model: { verdict: "NO_MODEL_RECORD", action: null, suggestedBid: null, source: null } };
  const match = entry.added.map(player => recorded.find(row => String(row.playerId) === player.id)).find(Boolean);
  return { ...entry, model: match
    ? { verdict: ["ADD_NOW", "CLAIM_IF_CHEAP"].includes(match.action) ? "RECOMMENDED" : "NOT_RECOMMENDED", action: match.action, suggestedBid: match.suggestedBid ?? null, source: match.source }
    : { verdict: "NOT_ON_BOARD", action: null, suggestedBid: null, source: recorded[0]?.source ?? null } };
}

/** Recommendations the team did not act on, per recorded week: the other half of "model vs me". */
export function skippedRecommendations(entries, recommendationsByWeek = {}) {
  const acted = new Set(entries.flatMap(entry => entry.added.map(player => `${entry.week}|${player.id}`)));
  return Object.entries(recommendationsByWeek).flatMap(([week, rows]) => rows
    .filter(row => ["ADD_NOW", "CLAIM_IF_CHEAP"].includes(row.action) && !acted.has(`${week}|${row.playerId}`))
    .map(row => ({ week: Number(week), playerId: String(row.playerId), name: row.name ?? null, action: row.action, suggestedBid: row.suggestedBid ?? null, source: row.source,
      position: row.position ?? null, cutPlayerId: row.cutPlayerId ?? null, cutName: row.cutName ?? null })));
}

/** Kind of the stored counterfactual rows: one per recommendation the team did not place. */
export const SKIPPED_KIND = "SKIPPED_RECOMMENDATION";
/** The counterfactual is an Adineu estimate: the team's real weekly roster, best lineup in hindsight. */
export const COUNTERFACTUAL_BASIS = "ADINEU_ESTIMATE_HINDSIGHT_OPTIMAL_LINEUP";

/**
 * "What if I had followed it" for one recommendation not placed (a `skippedRecommendations` row).
 * Each completed week of the window compares the hindsight optimal lineup of the roster the team
 * really had, with the player added (and the plan's cut removed while still on the roster), against
 * the same lineup without him: a player who would have sat on the bench adds 0, a cut starter can
 * make it negative. Never guessed: a week without the team's roster or stats, or a player without
 * position, is NOT_SCORABLE.
 * `rosterOf(week)` -> { playerIds, playersPoints } | null; `pointsOf(id, week)` -> number, or null
 * when that week's stats are unavailable; `optimalOf(playerIds, playersPoints)` -> number.
 * `takenBy` = another roster's completed add of the player that same week (claim bid included).
 */
export function evaluateSkippedRecommendation(row, { rosterOf, pointsOf, optimalOf, lastCompletedWeek, takenBy = null, window = OUTCOME_WINDOW_WEEKS }) {
  const basis = COUNTERFACTUAL_BASIS;
  if (!Number.isInteger(row.week) || row.week > lastCompletedWeek) return { status: "PENDING", basis };
  const notScorable = (reason, week = null) => ({ status: "NOT_SCORABLE", basis, reason, week });
  if (!row.position) return notScorable("POSITION_UNKNOWN");
  const id = String(row.playerId);
  const cutId = row.cutPlayerId ? String(row.cutPlayerId) : null;
  const weekly = [];
  for (let week = row.week; week <= Math.min(lastCompletedWeek, row.week + window - 1); week++) {
    const roster = rosterOf(week);
    if (!roster) return notScorable("ROSTER_WEEK_MISSING", week);
    const points = pointsOf(id, week);
    if (points === null || points === undefined) return notScorable("STATS_UNAVAILABLE", week);
    // Added later anyway: from then on the real roster already has him.
    if (roster.playerIds.includes(id)) { weekly.push({ week, points: round(points), gain: 0, onRoster: true }); continue; }
    const cutHere = cutId !== null && roster.playerIds.includes(cutId);
    const without = optimalOf(roster.playerIds, roster.playersPoints);
    const withPlayer = optimalOf([...roster.playerIds.filter(other => !cutHere || other !== cutId), id], { ...roster.playersPoints, [id]: points });
    if (!Number.isFinite(without) || !Number.isFinite(withPlayer)) return notScorable("LINEUP_UNAVAILABLE", week);
    weekly.push({ week, points: round(points), gain: round(withPlayer - without), onRoster: false, cutRemoved: cutHere });
  }
  const assumptions = [];
  if (!cutId) assumptions.push("CUT_NOT_RECORDED");
  if (takenBy) assumptions.push("TAKEN_BY_RIVAL");
  const likelyOutbid = Boolean(takenBy?.type === "waiver" && Number.isFinite(row.suggestedBid) && takenBy.bid > row.suggestedBid);
  return { status: weekly.length >= window ? "COMPLETE" : "PARTIAL", basis, fromWeek: row.week, throughWeek: weekly.at(-1).week, weeks: weekly.length,
    playerPoints: round(weekly.reduce((sum, item) => sum + item.points, 0)), lineupGain: round(weekly.reduce((sum, item) => sum + item.gain, 0)),
    weeksInLineup: weekly.filter(item => item.gain > 0).length, weekly, cutPlayerId: cutId, cutModeled: cutId !== null, takenBy, likelyOutbid, assumptions };
}

/** Stored shape of a counterfactual (decision_log row of kind SKIPPED_KIND). */
export function skippedEntry(row, outcome, { season, rosterId }) {
  return { id: `${season}:${rosterId}:skipped:${row.week}:${row.playerId}`, season, rosterId, kind: SKIPPED_KIND, week: row.week, occurredAt: null,
    added: [{ id: String(row.playerId), name: row.name ?? `Player #${row.playerId}`, position: row.position ?? null }],
    dropped: row.cutPlayerId ? [{ id: String(row.cutPlayerId), name: row.cutName ?? `Player #${row.cutPlayerId}`, position: null }] : [],
    bid: row.suggestedBid ?? null, note: row.action, outcome,
    model: { verdict: "RECOMMENDED", action: row.action, suggestedBid: row.suggestedBid ?? null, source: row.source ?? null } };
}

/** Counterfactuals still valid: a player added (or claimed) that week since the last sync is no longer skipped. */
export function currentCounterfactuals(rows = [], entries = []) {
  const acted = new Set(entries.flatMap(entry => (entry.added || []).map(player => `${entry.week}|${player.id}`)));
  return rows.filter(row => !acted.has(`${row.week}|${row.added[0]?.id}`));
}

export function summarizeCounterfactuals(rows = []) {
  const scored = rows.filter(row => ["COMPLETE", "PARTIAL"].includes(row.outcome?.status));
  return { skipped: rows.length, evaluated: scored.length, lineupGain: scored.length ? round(scored.reduce((sum, row) => sum + row.outcome.lineupGain, 0)) : null,
    notScorable: rows.filter(row => row.outcome?.status === "NOT_SCORABLE").length, pending: rows.filter(row => row.outcome?.status === "PENDING").length };
}

const COUNTERFACTUAL_REASON = { POSITION_UNKNOWN: "poste inconnu", ROSTER_WEEK_MISSING: "roster de la semaine absent", STATS_UNAVAILABLE: "stats indisponibles", LINEUP_UNAVAILABLE: "lineup non calculable" };
const frNumber = value => String(value).replace(".", ",");
const signedPoints = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${frNumber(Math.abs(value))} pts`;

/** One short French phrase for an outcome, shared by the Coach page and the Tuesday message. */
export function describeCounterfactual(outcome) {
  if (!outcome || outcome.status === "PENDING") return "en attente du match";
  if (outcome.status === "NOT_SCORABLE") return `non évaluable (${COUNTERFACTUAL_REASON[outcome.reason] || outcome.reason}${outcome.week ? `, S${outcome.week}` : ""})`;
  const notes = [outcome.status === "PARTIAL" ? "partiel" : null, outcome.cutModeled ? null : "coupe non enregistrée",
    outcome.likelyOutbid ? `pris par un rival à ${outcome.takenBy.bid} $` : outcome.takenBy ? "pris par un rival" : null].filter(Boolean);
  return `S${outcome.fromWeek}–S${outcome.throughWeek} : ${signedPoints(outcome.lineupGain)} en lineup optimale (${outcome.weeksInLineup} sem. titulaire, ${frNumber(outcome.playerPoints)} pts marqués)${notes.length ? ` · ${notes.join(", ")}` : ""}`;
}

/** Compact Telegram line: evaluated counterfactuals, largest gain first, or null when none. */
export function formatCounterfactualLine(rows = [], { limit = 3 } = {}) {
  const scored = rows.filter(row => ["COMPLETE", "PARTIAL"].includes(row.outcome?.status))
    .sort((a, b) => b.outcome.lineupGain - a.outcome.lineupGain || b.week - a.week);
  if (!scored.length) return null;
  const total = summarizeCounterfactuals(scored).lineupGain;
  const items = scored.slice(0, limit).map(row => `${row.added[0]?.name ?? `#${row.added[0]?.id}`} S${row.week} ${signedPoints(row.outcome.lineupGain)}${row.outcome.likelyOutbid ? " (surenchéri)" : ""}`);
  return `Recos non suivies (estimation Adineu, lineup optimale a posteriori) : ${items.join(" · ")}${scored.length > limit ? ` · ${scored.length - limit} autre(s)` : ""} — total ${signedPoints(total)} sur ${scored.length}.`;
}

/** Season totals: FAAB spent, net points of completed moves, lineup points left, model agreement. */
export function summarizeDecisionLog(entries = []) {
  const moves = entries.filter(entry => entry.kind !== "LINEUP");
  const evaluated = moves.filter(entry => ["COMPLETE", "PARTIAL"].includes(entry.outcome?.status) && Number.isFinite(entry.outcome.net));
  const lineups = entries.filter(entry => entry.kind === "LINEUP");
  const byVerdict = verdict => evaluated.filter(entry => entry.model?.verdict === verdict);
  const net = rows => rows.length ? round(rows.reduce((sum, entry) => sum + entry.outcome.net, 0)) : null;
  return {
    moves: moves.length, claimsWon: moves.filter(entry => entry.kind === "CLAIM_WON").length, claimsLost: moves.filter(entry => entry.kind === "CLAIM_LOST").length,
    faabSpent: moves.filter(entry => entry.kind === "CLAIM_WON").reduce((sum, entry) => sum + (entry.bid || 0), 0),
    netPointsFromMoves: net(evaluated), evaluatedMoves: evaluated.length,
    lineupPointsLeft: lineups.length ? round(lineups.reduce((sum, entry) => sum + entry.outcome.pointsLeft, 0)) : null, lineupWeeks: lineups.length,
    recommendedNet: net(byVerdict("RECOMMENDED")), recommendedMoves: byVerdict("RECOMMENDED").length,
    notRecommendedNet: net(byVerdict("NOT_RECOMMENDED")), notRecommendedMoves: byVerdict("NOT_RECOMMENDED").length,
    withReason: entries.filter(entry => entry.reason).length
  };
}

/** A reason is the operator's own text: trimmed, bounded, or null to clear it. */
export function normalizeReason(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Motif invalide");
  const text = value.trim().slice(0, REASON_MAX);
  return text || null;
}

/**
 * Post-waiver review of one decision week (Thursday message): claims won with their cut, claims
 * lost with the bid and team that beat them, free adds, FAAB spent and left, and the plan's
 * claims the team did not place. Facts from Sleeper only; nothing is priced or guessed.
 */
export function postWaiverReview({ entries = [], skipped = [], week, teamName, budgetLeft = null, teamNameOf = () => null }) {
  const ofWeek = entries.filter(entry => entry.week === week);
  const names = players => players.map(player => player.name).join(" + ");
  const won = ofWeek.filter(entry => entry.kind === "CLAIM_WON");
  const lost = ofWeek.filter(entry => entry.kind === "CLAIM_LOST");
  const free = ofWeek.filter(entry => entry.kind === "FREE_ADD");
  const missed = skipped.filter(row => row.week === week);
  const spent = won.reduce((sum, entry) => sum + (entry.bid || 0), 0);
  const lines = [`Waivers semaine ${week}${teamName ? ` — ${teamName}` : ""}`];
  if (!won.length && !lost.length && !free.length) lines.push("Aucun claim ni ajout cette semaine.");
  for (const entry of won) lines.push(`✅ ${names(entry.added)} — ${entry.bid ?? 0} $${entry.dropped.length ? ` (coupe ${names(entry.dropped)})` : ""}`);
  for (const entry of lost) {
    const by = entry.lostTo ? `${teamNameOf(entry.lostTo.rosterId) ?? `roster ${entry.lostTo.rosterId}`} à ${entry.lostTo.bid} $` : entry.note === "INVALID_CLAIM" ? "claim invalide" : "gagnant inconnu";
    lines.push(`❌ ${names(entry.added)} — ton offre ${entry.bid ?? 0} $, ${by}`);
  }
  for (const entry of free) lines.push(`➕ ${names(entry.added)} (agent libre)${entry.dropped.length ? `, coupe ${names(entry.dropped)}` : ""}`);
  lines.push(`FAAB dépensé : ${spent} $${Number.isFinite(budgetLeft) ? ` · reste ${budgetLeft} $` : ""}`);
  if (missed.length) lines.push(`Plan du modèle non placé : ${missed.map(row => `${row.name ?? `#${row.playerId}`} (${row.action}${Number.isFinite(row.suggestedBid) ? ` ${row.suggestedBid} $` : ""})`).join(", ")}`);
  return { week, claimsWon: won.length, claimsLost: lost.length, freeAdds: free.length, spent, budgetLeft, missedRecommendations: missed.length, message: lines.join("\n") };
}

/** A plan choice from the page: one of PLAN_CHOICES or null to clear it, with an optional reason. */
export function normalizePlanChoice({ choice, reason } = {}) {
  if (choice !== null && !PLAN_CHOICES.includes(choice)) throw new Error("Choix invalide");
  return { choice, reason: choice === null ? null : normalizeReason(reason ?? null) };
}

/** Stores one choice inside a MODEL_PLAN row's details, only for a player that plan recommended. */
export function applyPlanChoice(details = {}, playerId, { choice, reason }, at = new Date().toISOString()) {
  const id = String(playerId);
  if (!(details.recommendations || []).some(row => String(row.playerId) === id)) throw new Error("Recommandation inconnue");
  const choices = { ...(details.choices || {}) };
  if (choice === null) delete choices[id];
  else choices[id] = { choice, reason, at };
  return { ...details, choices };
}

/**
 * One line per Tuesday recommendation (ADD_NOW / CLAIM_IF_CHEAP): the operator's choice next to
 * what Sleeper shows was done that week. `move` is EXECUTED (completed add of that player that
 * week), ATTEMPTED (claim lost) or NONE. An ACCEPTED choice without a move stays not executed.
 * A recommendation with no move carries its stored counterfactual outcome, if any.
 */
export function planChoiceRows(plans = [], entries = [], counterfactuals = []) {
  const whatIf = new Map(counterfactuals.map(row => [`${row.week}|${row.added[0]?.id}`, row.outcome]));
  const moves = new Map();
  for (const entry of entries) {
    if (!["CLAIM_WON", "FREE_ADD", "CLAIM_LOST", "TRADE"].includes(entry.kind)) continue;
    for (const player of entry.added || []) {
      const key = `${entry.week}|${player.id}`;
      if (entry.kind !== "CLAIM_LOST") moves.set(key, "EXECUTED");
      else if (!moves.has(key)) moves.set(key, "ATTEMPTED");
    }
  }
  return plans.flatMap(plan => (plan.recommendations || [])
    .filter(row => ["ADD_NOW", "CLAIM_IF_CHEAP"].includes(row.action))
    .map(row => {
      const choice = plan.choices?.[String(row.playerId)] ?? null;
      const move = moves.get(`${plan.week}|${row.playerId}`) ?? "NONE";
      return { planId: plan.id, week: plan.week, playerId: String(row.playerId), name: row.name ?? null, action: row.action,
        suggestedBid: row.suggestedBid ?? null, choice: choice?.choice ?? null, reason: choice?.reason ?? null, choiceAt: choice?.at ?? null,
        move, executed: move === "EXECUTED", counterfactual: move === "NONE" ? whatIf.get(`${plan.week}|${row.playerId}`) ?? null : null };
    }))
    .sort((a, b) => b.week - a.week || a.playerId.localeCompare(b.playerId));
}
