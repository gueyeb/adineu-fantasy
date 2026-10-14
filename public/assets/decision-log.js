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
export const REASON_MAX = 500;
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
    pointsPerFaab: entry.kind === "CLAIM_WON" && entry.bid > 0 ? round(added / entry.bid) : null };
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
    .map(row => ({ week: Number(week), playerId: String(row.playerId), name: row.name ?? null, action: row.action, suggestedBid: row.suggestedBid ?? null, source: row.source })));
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
