/**
 * Adineu Fantasy — FAAB : probabilité de gagner une enchère d'après les rivaux
 * (docs/prd-model-challenge.md, chantier 1).
 *
 * The quantity to beat is the best bid of the OTHER teams. Fitted on this league's Sleeper bids,
 * won and lost (`status: failed` carries the losing bid):
 *   P(win at b) = P(no rival bids) + P(a rival bids) × P(best rival bid < b)
 * with a logistic for "a rival bids" and a log-normal for the best rival bid. Inputs: position,
 * youth, last week's rise in opportunities and snaps, and the share of rivals whose target-week
 * lineup improves with the player (their need). A rival's remaining budget caps what it can bid.
 * Per-manager aggressiveness and Sleeper's next-week projection did not help out of sample.
 * Pure functions, no I/O: scripts/calibrate-faab.js fits, the waiver evaluator applies.
 */

export const AUCTION_FEATURES = ["intercept", "opportunityJump", "snapJump", "QB", "RB", "WR", "TE", "young", "rivalNeedShare"];
/** A rival "needs" the player when its optimal lineup of the target week gains more than this. */
export const RIVAL_NEED_POINTS = 0.5;
/** Widens the fitted spread: at 1.0 the model is too sure of itself out of sample; 1.2 brings the
 * p25–p75 range of the best rival bid near 50 % coverage (docs/prd-model-challenge.md). */
export const SD_INFLATION = 1.2;
/** Proposed bid = smallest bid with this estimated chance of winning, never above the personal ceiling. */
export const TARGET_WIN_PROBABILITY = 0.6;
export const MAX_BID = 1000;

const clip = (value, low, high) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const dot = (weights, x) => weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
const sigmoid = z => 1 / (1 + Math.exp(-z));
const normalCdf = x => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));

/** Points the player adds to one roster's optimal lineup (slots in league order, FLEX = RB/WR/TE). */
export function lineupGain(rosterIds, playerId, { pointsOf, positionOf, slots, flex = ["RB", "WR", "TE"] }) {
  const best = ids => {
    const pool = ids.map(id => ({ id, position: positionOf(id), points: pointsOf(id) ?? 0 })).sort((a, b) => b.points - a.points || String(a.id).localeCompare(String(b.id)));
    const used = new Set();
    let total = 0;
    for (const slot of slots) {
      const pick = pool.find(row => !used.has(row.id) && (slot === "FLEX" ? flex.includes(row.position) : row.position === slot));
      if (pick) { used.add(pick.id); total += pick.points; }
    }
    return total;
  };
  const ids = [...rosterIds].map(String).filter(id => id !== String(playerId));
  return Number((best([...ids, String(playerId)]) - best(ids)).toFixed(2));
}

/**
 * Feature vector, in AUCTION_FEATURES order. `series` = the last completed weeks, oldest first,
 * as buildOpportunitySignals returns them ({ played, snapShare, opportunities }). K and DEF carry
 * no usage: their jumps are 0. Returns null without a position.
 */
export function auctionFeatures({ position, yearsExp = null, series = [], rivalNeeds = [] }) {
  if (!position) return null;
  const last = series.at(-1);
  const previous = series.slice(0, -1).filter(week => week.played);
  const opportunitiesLast = last?.played ? last.opportunities || 0 : 0;
  const opportunitiesBefore = mean(previous.map(week => week.opportunities || 0)) ?? opportunitiesLast;
  const snapLast = last?.played && Number.isFinite(last.snapShare) ? last.snapShare : 0;
  const snapBefore = mean(previous.map(week => week.snapShare).filter(Number.isFinite)) ?? snapLast;
  const needy = rivalNeeds.filter(gain => gain > RIVAL_NEED_POINTS).length;
  return [1, clip(opportunitiesLast - opportunitiesBefore, -10, 15) / 5, clip(snapLast - snapBefore, -0.5, 0.8),
    position === "QB" ? 1 : 0, position === "RB" ? 1 : 0, position === "WR" ? 1 : 0, position === "TE" ? 1 : 0,
    Number.isFinite(yearsExp) && yearsExp <= 2 ? 1 : 0, rivalNeeds.length ? needy / rivalNeeds.length : 0];
}

function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = a[k][i] / a[i][i];
      for (let j = i; j <= n; j++) a[k][j] -= factor * a[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = a[i][n];
    for (let j = i + 1; j < n; j++) sum -= a[i][j] * x[j];
    x[i] = sum / a[i][i];
  }
  return x;
}

/** Ridge least squares; the intercept (index 0) is not penalized. */
export function ridge(X, y, l2 = 4) {
  const d = X[0].length;
  const a = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j && i ? l2 : 0)));
  const b = new Array(d).fill(0);
  X.forEach((x, row) => { for (let i = 0; i < d; i++) { b[i] += x[i] * y[row]; for (let k = 0; k < d; k++) a[i][k] += x[i] * x[k]; } });
  return solve(a, b);
}

/** L2-regularized logistic regression by gradient descent (deterministic). */
export function logistic(X, y, { l2 = 4, iterations = 600, rate = 0.3 } = {}) {
  const d = X[0].length;
  const w = new Array(d).fill(0);
  for (let it = 0; it < iterations; it++) {
    const gradient = new Array(d).fill(0);
    X.forEach((x, row) => { const error = sigmoid(dot(w, x)) - y[row]; for (let k = 0; k < d; k++) gradient[k] += error * x[k]; });
    for (let k = 0; k < d; k++) w[k] -= rate * (gradient[k] / X.length + (k ? l2 * w[k] / X.length : 0));
  }
  return w;
}

/**
 * Fit on bid samples: { x, bestRivalBid } where bestRivalBid is null when nobody else bid.
 * Returns { rivalBidWeights, amountWeights, sd } (sd already inflated).
 */
export function fitAuctionModel(samples, { l2 = 4, sdInflation = SD_INFLATION } = {}) {
  const contested = samples.filter(sample => sample.bestRivalBid !== null);
  if (samples.length < 20 || contested.length < 10) return null;
  const rivalBidWeights = logistic(samples.map(sample => sample.x), samples.map(sample => sample.bestRivalBid !== null ? 1 : 0), { l2 });
  const amountWeights = ridge(contested.map(sample => sample.x), contested.map(sample => Math.log1p(sample.bestRivalBid)), l2);
  const residuals = contested.map(sample => Math.log1p(sample.bestRivalBid) - dot(amountWeights, sample.x));
  const sd = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length - amountWeights.length));
  return { rivalBidWeights, amountWeights, sd: sd * sdInflation };
}

/** Probability that a bid of `bid` $ beats every rival. Above the richest rival's budget it is 1. */
export function winProbability(model, x, bid, { maxRivalBudget = MAX_BID } = {}) {
  if (!model || !x || !Number.isFinite(bid)) return null;
  if (bid > maxRivalBudget) return 1;
  const pRival = sigmoid(dot(model.rivalBidWeights, x));
  return 1 - pRival + pRival * normalCdf((Math.log1p(bid) - dot(model.amountWeights, x)) / model.sd);
}

/** Smallest whole bid reaching `target`, or null when no bid within `cap` does. */
export function bidForProbability(model, x, target, { maxRivalBudget = MAX_BID, cap = MAX_BID } = {}) {
  if (!model || !x) return null;
  for (let bid = 0; bid <= cap; bid++) if (winProbability(model, x, bid, { maxRivalBudget }) >= target) return bid;
  return null;
}

/**
 * Price to win for one player and one bidder.
 * @param {Array} rivals [{ rosterId, team, need, budget }] — every other roster.
 * @param {number|null} ceiling the bidder's personal ceiling (value to its roster), never raised.
 */
export function priceToWin(model, { position, yearsExp, series, rivals = [], ceiling = null, target = TARGET_WIN_PROBABILITY }) {
  if (!model) return null;
  const x = auctionFeatures({ position, yearsExp, series, rivalNeeds: rivals.map(rival => rival.need ?? 0) });
  if (!x) return null;
  const budgets = rivals.map(rival => rival.budget).filter(Number.isFinite);
  const maxRivalBudget = budgets.length ? Math.max(...budgets) : MAX_BID;
  const at = probability => bidForProbability(model, x, probability, { maxRivalBudget });
  const targetBid = at(target);
  const proposed = Number.isFinite(ceiling) ? (targetBid === null ? ceiling : Math.min(ceiling, targetBid)) : targetBid;
  const likelyRivals = rivals.filter(rival => rival.need > RIVAL_NEED_POINTS)
    .sort((a, b) => b.need - a.need || (b.budget ?? 0) - (a.budget ?? 0)).slice(0, 4)
    .map(rival => ({ rosterId: rival.rosterId, team: rival.team ?? null, need: rival.need, budget: rival.budget ?? null }));
  return {
    rivalBidProbability: Number(sigmoid(dot(model.rivalBidWeights, x)).toFixed(3)),
    bestRivalBid: { p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) },
    targetProbability: target,
    bidForTarget: targetBid,
    proposedBid: proposed,
    winProbabilityAtProposed: proposed === null ? null : Number(winProbability(model, x, proposed, { maxRivalBudget }).toFixed(2)),
    cappedByCeiling: Number.isFinite(ceiling) && targetBid !== null && ceiling < targetBid,
    rivalsInNeed: rivals.filter(rival => rival.need > RIVAL_NEED_POINTS).length,
    rivals: rivals.length,
    maxRivalBudget,
    likelyRivals,
    features: Object.fromEntries(AUCTION_FEATURES.map((name, index) => [name, Number(x[index].toFixed(3))]))
  };
}

/** Out-of-sample scoring of P(win) at each real bid: Brier, a constant-rate reference, coverage. */
export function scoreAuction(model, samples, { baseRate = null } = {}) {
  const rows = samples.filter(sample => sample.won !== null && sample.won !== undefined);
  if (!model || !rows.length) return null;
  const rate = baseRate ?? rows.filter(row => row.won).length / rows.length;
  let brier = 0, reference = 0, covered = 0, contested = 0;
  for (const row of rows) {
    const p = winProbability(model, row.x, row.bid + 0.5, { maxRivalBudget: row.maxRivalBudget ?? MAX_BID });
    brier += (p - (row.won ? 1 : 0)) ** 2;
    reference += (rate - (row.won ? 1 : 0)) ** 2;
  }
  for (const row of samples.filter(sample => sample.bestRivalBid !== null)) {
    contested++;
    const low = bidForProbability(model, row.x, 0.25) ?? MAX_BID;
    const high = bidForProbability(model, row.x, 0.75) ?? MAX_BID;
    if (row.bestRivalBid + 1 >= low && row.bestRivalBid <= high) covered++;
  }
  return { bids: rows.length, brier: Number((brier / rows.length).toFixed(3)), constantRateBrier: Number((reference / rows.length).toFixed(3)),
    contested, interquartileCoverage: contested ? Number((covered / contested).toFixed(2)) : null };
}

/** What every output carries: the decision-relevant part of a priceToWin result. */
export function compactAuction(auction) {
  if (!auction) return null;
  return { proposedBid: auction.proposedBid, winProbability: auction.winProbabilityAtProposed, bestRivalBid: auction.bestRivalBid,
    rivalsInNeed: auction.rivalsInNeed, rivals: auction.rivals, cappedByCeiling: auction.cappedByCeiling,
    likelyRivals: (auction.likelyRivals || []).map(rival => ({ team: rival.team, need: rival.need, budget: rival.budget })) };
}

/** One French sentence, the same in every output. */
export function formatAuction(auction) {
  if (!auction || !auction.bestRivalBid) return "";
  const pct = Number.isFinite(auction.winProbability ?? auction.winProbabilityAtProposed) ? `${Math.round((auction.winProbability ?? auction.winProbabilityAtProposed) * 100)} % de chances estimées à ${auction.proposedBid} $` : null;
  const range = `meilleure enchère rivale : médiane ${auction.bestRivalBid.p50 ?? "n/d"} $, 3 fois sur 4 ≤ ${auction.bestRivalBid.p75 ?? "n/d"} $`;
  const rivals = auction.rivalsInNeed ? `${auction.rivalsInNeed} rival(aux) en manque au poste${auction.likelyRivals?.length ? ` (${auction.likelyRivals.map(rival => `${rival.team || "?"}, ${rival.budget ?? "?"} $ restants`).join(" ; ")})` : ""}` : "aucun rival en manque au poste cette semaine";
  return [pct, range, rivals, auction.cappedByCeiling ? "plafonné par ta valeur du joueur" : null].filter(Boolean).join(" · ");
}
