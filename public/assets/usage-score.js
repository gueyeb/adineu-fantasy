/**
 * Adineu Fantasy — Usage Score & buy-low / sell-high (docs/prd-usage-score.md).
 *
 * Our free take on a "utilization score": how much of his team's offense a player commands,
 * independent of how many points he happened to score. Built only from Sleeper weekly stats
 * (snaps, targets, air yards, carries, red-zone opportunities); routes are not available for
 * free and are never imputed. Pure functions, no I/O.
 *
 * - usage shares are player / team totals of the same week (games he played only)
 * - Usage Score (0-100) = percentile of a position-specific weighted composite
 * - xFP (expected fantasy points) = per-position least-squares fit of PPR points on volume
 *   (targets, carries, red-zone opportunities, air yards), refit on the current data each run
 * - BUY_LOW = scores well below what his volume predicts; SELL_HIGH = well above (regression risk)
 */

export const USAGE_POSITIONS = ["QB", "RB", "WR", "TE"];
export const RECENCY_WEIGHTS = [0.5, 0.3, 0.2]; // most recent played game first
export const BUY_LOW_GAP = -3;   // ppg below xFP
export const SELL_HIGH_GAP = 4;  // ppg above xFP
// QBs score on a bigger scale: their thresholds are wider (docs/prd-boom-bust-qb-usage.md).
const SIGNAL_GAPS = { QB: { buy: -5, sell: 5 } };
const MIN_GAMES_FOR_SIGNAL = 2;

const COMPOSITE = {
  WR: { targetShare: 0.4, airShare: 0.2, snapShare: 0.2, redZoneShare: 0.2 },
  TE: { targetShare: 0.4, airShare: 0.2, snapShare: 0.2, redZoneShare: 0.2 },
  RB: { snapShare: 0.3, carryShare: 0.3, targetShare: 0.2, redZoneShare: 0.2 },
  // A starting QB has ~100 % of the dropbacks: the composite separates rushers, red-zone usage and depth.
  QB: { dropbackShare: 0.4, carryShare: 0.25, redZoneShare: 0.2, depthScore: 0.15 }
};
// PPR value of volume, used when the fit is not trustworthy (early season, rare feature, absurd fit).
const FALLBACK_XFP = { intercept: 0, targets: 1.55, carries: 0.6, redZone: 0.9, airYards: 0.02 };
// For QBs the regression slots mean: targets = dropbacks, carries = rushes, redZone = red-zone
// passes + rushes, airYards = passing air yards. A season's handful of QB games rarely passes the
// fit guards, so this fallback is the same regression fitted on 1 685 QB games (2021–2025,
// docs/prd-boom-bust-qb-usage.md): passing value lives in air yards, not in raw dropbacks.
const QB_FALLBACK_XFP = { intercept: 0.31, targets: 0.041, carries: 0.754, redZone: 0.518, airYards: 0.079 };
const fallbackFor = position => (position === "QB" ? QB_FALLBACK_XFP : FALLBACK_XFP);
const FEATURES = ["targets", "carries", "redZone", "airYards"];
// Plausible coefficient ranges (PPR points per unit): a fit outside them is rejected, not shown.
const COEFFICIENT_BOUNDS = { targets: [0, 4], carries: [0, 2], redZone: [0, 5], airYards: [0, 0.4] };
const QB_COEFFICIENT_BOUNDS = { targets: [0, 1.2], carries: [0, 2], redZone: [0, 3], airYards: [0, 0.1] };
const boundsFor = position => (position === "QB" ? QB_COEFFICIENT_BOUNDS : COEFFICIENT_BOUNDS);
const MIN_FEATURE_SUPPORT = 10; // non-zero rows needed before a feature is fitted instead of fixed
const RIDGE_LAMBDA = 5;

const round = (value, digits = 1) => Number(value.toFixed(digits));
const share = (part, total) => (total > 0 ? part / total : 0);

/** Team offense totals per week, from every player's own stat line. */
export function buildTeamTotals(statsByWeek, teamOf) {
  const totals = new Map();
  for (const { week, stats } of statsByWeek) {
    for (const [playerId, row] of Object.entries(stats || {})) {
      const team = teamOf(playerId, week);
      if (!team) continue;
      const key = `${week}|${team}`;
      const total = totals.get(key) || { targets: 0, airYards: 0, carries: 0, redZone: 0, snaps: 0, dropbacks: 0 };
      total.targets += row.rec_tgt || 0;
      // Share of the team's *downfield* air yards: behind-the-line targets count 0 on both sides,
      // so a share is always within 0-100 % (net air yards could push a share above 100 %).
      total.airYards += Math.max(0, row.rec_air_yd || 0);
      total.carries += row.rush_att || 0;
      total.redZone += (row.rec_rz_tgt || 0) + (row.rush_rz_att || 0);
      total.snaps = Math.max(total.snaps, row.tm_off_snp || 0);
      total.dropbacks += (row.pass_att || 0) + (row.pass_sack || 0);
      totals.set(key, total);
    }
  }
  return totals;
}

/** One row per played game (off_snp > 0) for fantasy skill players. */
export function buildPlayerWeeks(statsByWeek, { teamOf, positionOf }) {
  const totals = buildTeamTotals(statsByWeek, teamOf);
  const rows = [];
  for (const { week, stats } of statsByWeek) {
    for (const [playerId, row] of Object.entries(stats || {})) {
      const position = positionOf(playerId);
      const team = teamOf(playerId, week);
      if (!USAGE_POSITIONS.includes(position) || !team || !(row.off_snp > 0)) continue;
      const total = totals.get(`${week}|${team}`);
      if (position === "QB") {
        // Same regression slots, QB meaning: targets = dropbacks, airYards = passing air yards.
        const dropbacks = (row.pass_att || 0) + (row.pass_sack || 0);
        if (dropbacks + (row.rush_att || 0) === 0) continue; // kneel-down / gadget snap only
        const redZone = (row.pass_rz_att || 0) + (row.rush_rz_att || 0);
        const airYards = Math.max(0, row.pass_air_yd || 0);
        rows.push({
          playerId, week, position, team,
          points: row.pts_ppr ?? 0,
          targets: dropbacks,
          carries: row.rush_att || 0,
          airYards,
          redZone,
          snapShare: share(row.off_snp, row.tm_off_snp || total.snaps),
          dropbackShare: Math.min(1, share(dropbacks, total.dropbacks)),
          carryShare: share(row.rush_att || 0, total.carries),
          redZoneShare: Math.min(1, share(redZone, total.redZone)),
          // Average depth of attempt, scaled so ~12 air yards per attempt = 1.
          depthScore: Math.min(1, share(airYards, row.pass_att || 0) / 12),
          targetShare: 0, airShare: 0
        });
        continue;
      }
      const redZone = (row.rec_rz_tgt || 0) + (row.rush_rz_att || 0);
      rows.push({
        playerId, week, position, team,
        points: row.pts_ppr ?? 0,
        targets: row.rec_tgt || 0,
        carries: row.rush_att || 0,
        airYards: Math.max(0, row.rec_air_yd || 0),
        redZone,
        snapShare: share(row.off_snp, row.tm_off_snp || total.snaps),
        targetShare: share(row.rec_tgt || 0, total.targets),
        airShare: share(Math.max(0, row.rec_air_yd || 0), total.airYards),
        carryShare: share(row.rush_att || 0, total.carries),
        redZoneShare: share(redZone, total.redZone)
      });
    }
  }
  return rows;
}

/** Solves (XᵀX + λI') b = Xᵀy by Gaussian elimination (intercept not penalized); null if singular. */
function leastSquares(features, targets, lambda = 0) {
  const k = features[0].length;
  const a = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  features.forEach((x, n) => {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) a[i][j] += x[i] * x[j];
      a[i][k] += x[i] * targets[n];
    }
  });
  for (let i = 1; i < k; i++) a[i][i] += lambda;
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let row = col + 1; row < k; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let j = col; j <= k; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row, i) => row[k] / row[i]);
}

/** Per-position xFP model: PPR points explained by volume only, refit each run, but guarded:
 * a feature with too little support (e.g. TE carries) keeps its fixed PPR value instead of being
 * fitted, the fit is ridge-regularized, and any non-finite or implausible coefficient rejects the
 * whole fit (fallback values). A wrong xFP would directly create false buy-low/sell-high signals. */
export function fitExpectedPoints(playerWeeks) {
  const models = {};
  for (const position of USAGE_POSITIONS) {
    const rows = playerWeeks.filter(row => row.position === position);
    const base = fallbackFor(position);
    const bounds = boundsFor(position);
    const fallback = { ...base, fitted: false, n: rows.length };
    if (rows.length < 30) { models[position] = fallback; continue; }
    const fitted = FEATURES.filter(feature => rows.filter(row => row[feature] !== 0).length >= MIN_FEATURE_SUPPORT);
    const fixed = FEATURES.filter(feature => !fitted.includes(feature));
    const residual = rows.map(row => row.points - fixed.reduce((sum, feature) => sum + base[feature] * row[feature], 0));
    const coefficients = leastSquares(rows.map(row => [1, ...fitted.map(feature => row[feature])]), residual, RIDGE_LAMBDA);
    const model = { intercept: coefficients?.[0], fitted: true, n: rows.length };
    fitted.forEach((feature, i) => { model[feature] = coefficients?.[i + 1]; });
    fixed.forEach(feature => { model[feature] = base[feature]; });
    const valid = coefficients && Number.isFinite(model.intercept) && Math.abs(model.intercept) <= 5 &&
      FEATURES.every(feature => Number.isFinite(model[feature]) && model[feature] >= bounds[feature][0] && model[feature] <= bounds[feature][1]);
    models[position] = valid ? { ...model, fixedFeatures: fixed } : fallback;
  }
  return models;
}

export function expectedPoints(row, model) {
  const value = model.intercept + model.targets * row.targets + model.carries * row.carries + model.redZone * row.redZone + model.airYards * row.airYards;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function weightedMean(rows, pick) {
  let sum = 0;
  let weights = 0;
  rows.forEach((row, index) => {
    const weight = RECENCY_WEIGHTS[index] ?? RECENCY_WEIGHTS.at(-1);
    sum += weight * pick(row);
    weights += weight;
  });
  return weights > 0 ? sum / weights : 0;
}

/** Usage Score, xFP and signals for every player with at least one played game. */
export function calculateUsageScores(playerWeeks) {
  const models = fitExpectedPoints(playerWeeks);
  const byPlayer = new Map();
  for (const row of playerWeeks) {
    if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
    byPlayer.get(row.playerId).push(row);
  }
  const players = [...byPlayer.entries()].map(([playerId, rows]) => {
    const games = [...rows].sort((a, b) => b.week - a.week); // most recent first
    const position = games[0].position;
    const weights = COMPOSITE[position];
    const composite = weightedMean(games, row => Object.entries(weights).reduce((sum, [key, w]) => sum + w * row[key], 0));
    const model = models[position];
    const xfp = weightedMean(games, row => expectedPoints(row, model));
    const ppg = weightedMean(games, row => row.points);
    const gap = ppg - xfp;
    const last = games[0];
    const previous = games.slice(1);
    const trend = previous.length
      ? Object.entries(weights).reduce((sum, [key, w]) => sum + w * last[key], 0) - weightedMean(previous, row => Object.entries(weights).reduce((sum, [key, w]) => sum + w * row[key], 0))
      : null;
    return {
      playerId, position, team: last.team, games: games.length, composite,
      snapShare: round(weightedMean(games, row => row.snapShare) * 100, 0),
      targetShare: round(weightedMean(games, row => row.targetShare) * 100, 0),
      airShare: round(weightedMean(games, row => row.airShare) * 100, 0),
      carryShare: round(weightedMean(games, row => row.carryShare) * 100, 0),
      redZoneShare: round(weightedMean(games, row => row.redZoneShare) * 100, 0),
      opportunities: round(weightedMean(games, row => row.targets + row.carries)),
      ppg: round(ppg), xfp: round(xfp), gap: round(gap),
      trend: trend === null ? null : round(trend * 100)
    };
  });
  // Usage Score = percentile of the composite within the position (only real contributors ranked).
  for (const position of USAGE_POSITIONS) {
    const pool = players.filter(player => player.position === position).sort((a, b) => a.composite - b.composite);
    // Ties share the average percentile of their block (identical usage = identical score).
    const percentileOf = new Map();
    for (let start = 0; start < pool.length;) {
      let end = start;
      while (end + 1 < pool.length && Math.abs(pool[end + 1].composite - pool[start].composite) < 1e-12) end++;
      const averageIndex = (start + end) / 2;
      for (let i = start; i <= end; i++) percentileOf.set(pool[i], pool.length > 1 ? Math.round(100 * averageIndex / (pool.length - 1)) : 50);
      start = end + 1;
    }
    pool.forEach(player => {
      player.usageScore = percentileOf.get(player);
      player.signal = player.games < MIN_GAMES_FOR_SIGNAL ? null
        : player.gap <= (SIGNAL_GAPS[position]?.buy ?? BUY_LOW_GAP) && player.usageScore >= 60 ? "BUY_LOW"
        // Elite usage (> 85) producing above volume is a star, not a fluke: never "sell high" on it.
        : player.gap >= (SIGNAL_GAPS[position]?.sell ?? SELL_HIGH_GAP) && player.usageScore <= 85 ? "SELL_HIGH"
        : null;
      delete player.composite;
    });
  }
  return { players: players.sort((a, b) => b.usageScore - a.usageScore), models };
}
