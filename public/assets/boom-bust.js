/**
 * Adineu Fantasy — Boom / Bust (docs/prd-boom-bust-qb-usage.md).
 *
 * Pure functions. The uncertainty around a projection comes from real data, not an invented
 * variance: public/data/boom-bust-calibration.json stores, per position and projection bucket, the
 * quantiles (0, 5, …, 100 %) of actual / pregame-projected PPR over five Sleeper seasons.
 * A player projected `p` scores p × ratio, with ratio drawn from that empirical distribution.
 */

export const CALIBRATION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const PROJECTION_BUCKETS = [[1, 5], [5, 8], [8, 11], [11, 14], [14, 18], [18, 22], [22, 99]];
/** PPR thresholds for a "boom" week and a "bust" week, 12-team league. */
export const BOOM_BUST_THRESHOLDS = {
  QB: { boom: 25, bust: 12 },
  RB: { boom: 20, bust: 6 },
  WR: { boom: 20, bust: 6 },
  TE: { boom: 15, bust: 4 },
  K: { boom: 12, bust: 4 },
  DEF: { boom: 12, bust: 2 }
};
const UNAVAILABLE = new Set(["Out", "IR", "PUP", "Sus", "NA"]);
const FLOOR_INDEX = 4;    // 20th percentile in the 5 % grid
const CEILING_INDEX = 16; // 80th percentile

export function bucketFor(projection) {
  // Below the first bucket -> first bucket (a 0.5-pt projection is not a 22+ pt one).
  const bucket = projection < PROJECTION_BUCKETS[0][0] ? PROJECTION_BUCKETS[0]
    : PROJECTION_BUCKETS.find(([low, high]) => projection >= low && projection < high) || PROJECTION_BUCKETS.at(-1);
  return `${bucket[0]}-${bucket[1]}`;
}

/** Quantile grid for a position/projection, falling back to the nearest bucket with enough data. */
function ratiosFor(position, projection, calibration) {
  const rows = calibration?.[position];
  if (!rows) return null;
  const index = rows.findIndex(row => row.bucket === bucketFor(projection));
  for (let distance = 0; distance < rows.length; distance++) {
    for (const candidate of [index - distance, index + distance]) {
      if (rows[candidate]?.ratios) return rows[candidate].ratios;
    }
  }
  return null;
}

/** P(ratio <= x) from the quantile grid, linear between grid points. */
function cdf(ratios, x) {
  if (x <= ratios[0]) return 0;
  if (x >= ratios.at(-1)) return 1;
  const step = 1 / (ratios.length - 1);
  for (let i = 1; i < ratios.length; i++) {
    if (x <= ratios[i]) {
      const span = ratios[i] - ratios[i - 1];
      const within = span > 0 ? (x - ratios[i - 1]) / span : 1;
      return (i - 1 + within) * step;
    }
  }
  return 1;
}

const round = (value, digits = 1) => Number(value.toFixed(digits));

/**
 * @returns {{ floor, median, ceiling, boomPct, bustPct } | null} null when the position or the
 * projection can't be calibrated (no projection, unknown position): never an invented number.
 */
export function boomBust({ position, projection, calibration, injuryStatus = null, volatility = 1 }) {
  if (UNAVAILABLE.has(injuryStatus)) return { floor: 0, median: 0, ceiling: 0, boomPct: 0, bustPct: 100 };
  const thresholds = BOOM_BUST_THRESHOLDS[position];
  if (!thresholds || !Number.isFinite(projection) || projection <= 0) return null;
  const baseRatios = ratiosFor(position, projection, calibration);
  if (!baseRatios) return null;
  // Player-specific volatility: widen (> 1) or narrow (< 1) the spread around the median ratio.
  const median = baseRatios[Math.floor(baseRatios.length / 2)];
  const ratios = volatility === 1 ? baseRatios : baseRatios.map(ratio => Math.max(0, median + (ratio - median) * volatility));
  return {
    floor: round(projection * ratios[FLOOR_INDEX]),
    median: round(projection * ratios[Math.floor(ratios.length / 2)]),
    ceiling: round(projection * ratios[CEILING_INDEX]),
    boomPct: Math.round(100 * (1 - cdf(ratios, thresholds.boom / projection))),
    bustPct: Math.round(100 * cdf(ratios, thresholds.bust / projection))
  };
}

/**
 * Player volatility multiplier from past games: his median absolute deviation of actual/projected
 * relative to his position's, shrunk toward 1 with VOLATILITY_PRIOR_GAMES pseudo-games and clamped,
 * so 3 wild games can't make a player "the most explosive in the league".
 */
export const VOLATILITY_PRIOR_GAMES = 10;
export function playerVolatility(playerRatios, positionMad, { priorGames = VOLATILITY_PRIOR_GAMES } = {}) {
  if (!playerRatios.length || !(positionMad > 0)) return 1;
  const sorted = [...playerRatios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map(ratio => Math.abs(ratio - median)).sort((a, b) => a - b);
  const raw = deviations[Math.floor(deviations.length / 2)] / positionMad;
  const shrunk = (playerRatios.length * raw + priorGames) / (playerRatios.length + priorGames);
  return Number(Math.min(1.6, Math.max(0.6, shrunk)).toFixed(3));
}

/** Which lineup to play given the pregame win estimate (percent for my team). */
export function recommendLineupMode(winPct) {
  if (!Number.isFinite(winPct)) return "OPTIMAL";
  if (winPct < 40) return "BOOM";
  if (winPct > 60) return "SAFE";
  return "OPTIMAL";
}
