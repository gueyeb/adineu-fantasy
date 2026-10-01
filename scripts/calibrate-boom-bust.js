#!/usr/bin/env node
/**
 * Adineu Fantasy — calibrage Boom / Bust (docs/prd-boom-bust-qb-usage.md).
 *
 * Pour chaque poste et tranche de projection : distribution du ratio score réel / projection
 * d'avant-match (Sleeper, saisons régulières), en quantiles de 5 %. Écrit
 * public/data/boom-bust-calibration.json et un rapport de validation hors échantillon
 * (calibrage sur les saisons d'entraînement, test sur la dernière).
 *
 * Usage : npm run calibrate:boom-bust [-- --seasons=2021,2022,2023,2024,2025]
 * Données mises en cache dans .cache/backtest (partagé avec npm run backtest).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { BOOM_BUST_THRESHOLDS, CALIBRATION_POSITIONS, PROJECTION_BUCKETS, bucketFor, boomBust, playerVolatility } from "../public/assets/boom-bust.js";

const CACHE = new URL("../.cache/backtest/", import.meta.url);
const OUTPUT = new URL("../public/data/boom-bust-calibration.json", import.meta.url);
const MIN_GAMES_FOR_VOLATILITY = 4;
const SLEEPER = "https://api.sleeper.app/v1";
const QUANTILES = Array.from({ length: 21 }, (_, i) => i * 0.05);
const MIN_PROJECTION = 1;

async function cached(name, load) {
  const file = new URL(name, CACHE);
  try { return JSON.parse(await readFile(file, "utf8")); } catch {}
  const data = await load();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}
const getJson = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
};

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Pregame projection vs actual for every player-week that was played. */
export async function collectSamples(seasons) {
  const players = await cached("players-v3.json", async () => {
    const raw = await getJson(`${SLEEPER}/players/nfl`);
    return Object.fromEntries(Object.entries(raw).filter(([, p]) => ["RB", "WR", "TE", "QB", "FB", "K"].includes(p?.position)).map(([id, p]) => [id, { gsis: p.gsis_id || null, position: p.position, name: p.full_name }]));
  });
  const samples = [];
  for (const season of seasons) {
    for (let week = 1; week <= 18; week++) {
      const stats = await cached(`stats-${season}-${week}.json`, () => getJson(`${SLEEPER}/stats/nfl/regular/${season}/${week}`));
      const projections = await cached(`proj-${season}-${week}.json`, () => getJson(`${SLEEPER}/projections/nfl/regular/${season}/${week}`));
      for (const [playerId, projection] of Object.entries(projections)) {
        const projected = Number(projection?.pts_ppr);
        const row = stats[playerId];
        // DEF and K are keyed by team / have no snaps: a played game = a stat line with points.
        const position = players[playerId]?.position || (/^[A-Z]{2,3}$/.test(playerId) ? "DEF" : null) || projection.position || null;
        const played = row && (row.off_snp > 0 || (["DEF", "K"].includes(position) && Number.isFinite(Number(row.pts_ppr))));
        if (!position || !Number.isFinite(projected) || projected < MIN_PROJECTION || !played) continue;
        samples.push({ season, week, playerId, position, projected, actual: Number(row.pts_ppr) || 0 });
      }
    }
  }
  return samples;
}

export function buildCalibration(samples) {
  const table = {};
  for (const position of CALIBRATION_POSITIONS) {
    table[position] = PROJECTION_BUCKETS.map(([low, high]) => {
      const ratios = samples.filter(sample => sample.position === position && bucketFor(sample.projected) === `${low}-${high}`)
        .map(sample => sample.actual / sample.projected).sort((a, b) => a - b);
      return { bucket: `${low}-${high}`, n: ratios.length, ratios: ratios.length >= 30 ? QUANTILES.map(q => Number(quantile(ratios, q).toFixed(3))) : null };
    });
  }
  return table;
}

/** Per-player volatility multipliers from a set of samples (players with enough games only). */
export function buildVolatility(samples) {
  const byPosition = new Map();
  const byPlayer = new Map();
  for (const sample of samples) {
    const ratio = sample.actual / sample.projected;
    if (!byPosition.has(sample.position)) byPosition.set(sample.position, []);
    byPosition.get(sample.position).push(ratio);
    if (!byPlayer.has(sample.playerId)) byPlayer.set(sample.playerId, { position: sample.position, ratios: [] });
    byPlayer.get(sample.playerId).ratios.push(ratio);
  }
  const mad = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const deviations = sorted.map(value => Math.abs(value - median)).sort((a, b) => a - b);
    return deviations[Math.floor(deviations.length / 2)];
  };
  const positionMad = new Map([...byPosition].map(([position, ratios]) => [position, mad(ratios)]));
  const volatility = {};
  for (const [playerId, { position, ratios }] of byPlayer) {
    if (ratios.length >= MIN_GAMES_FOR_VOLATILITY) volatility[playerId] = playerVolatility(ratios, positionMad.get(position));
  }
  return volatility;
}

/** Brier score of boom/bust probabilities on a sample set (lower is better). */
export function brier(samples, calibration, volatility = {}) {
  let boom = 0;
  let bust = 0;
  let n = 0;
  for (const sample of samples) {
    const result = boomBust({ position: sample.position, projection: sample.projected, calibration, volatility: volatility[sample.playerId] ?? 1 });
    if (!result) continue;
    const thresholds = BOOM_BUST_THRESHOLDS[sample.position];
    boom += (result.boomPct / 100 - (sample.actual >= thresholds.boom ? 1 : 0)) ** 2;
    bust += (result.bustPct / 100 - (sample.actual <= thresholds.bust ? 1 : 0)) ** 2;
    n++;
  }
  return { n, boom: Number((boom / n).toFixed(4)), bust: Number((bust / n).toFixed(4)) };
}

/** Out-of-sample check: predicted boom/bust % vs observed frequency, by predicted-probability bin. */
export function validate(samples, calibration) {
  const report = {};
  for (const kind of ["boom", "bust"]) {
    const bins = Array.from({ length: 5 }, (_, i) => ({ range: `${i * 20}-${i * 20 + 20}%`, predicted: [], observed: [] }));
    for (const sample of samples) {
      const result = boomBust({ position: sample.position, projection: sample.projected, calibration });
      if (!result) continue;
      const probability = kind === "boom" ? result.boomPct / 100 : result.bustPct / 100;
      const threshold = BOOM_BUST_THRESHOLDS[sample.position][kind];
      const hit = kind === "boom" ? sample.actual >= threshold : sample.actual <= threshold;
      const bin = bins[Math.min(4, Math.floor(probability * 5))];
      bin.predicted.push(probability);
      bin.observed.push(hit ? 1 : 0);
    }
    report[kind] = bins.filter(bin => bin.predicted.length).map(bin => ({
      range: bin.range,
      n: bin.predicted.length,
      predicted: Number((100 * bin.predicted.reduce((a, b) => a + b, 0) / bin.predicted.length).toFixed(1)),
      observed: Number((100 * bin.observed.reduce((a, b) => a + b, 0) / bin.observed.length).toFixed(1))
    }));
  }
  return report;
}

async function main() {
  const arg = process.argv.find(value => value.startsWith("--seasons="));
  const seasons = arg ? arg.split("=")[1].split(",").map(Number) : [2021, 2022, 2023, 2024, 2025];
  const samples = await collectSamples(seasons);
  const holdout = seasons.at(-1);
  const train = samples.filter(sample => sample.season !== holdout);
  const test = samples.filter(sample => sample.season === holdout);
  const trainCalibration = buildCalibration(train);
  const validation = validate(test, trainCalibration);
  // Does player volatility (learned on train seasons only) improve the held-out season?
  const trainVolatility = buildVolatility(train);
  const volatilityCheck = { without: brier(test, trainCalibration), with: brier(test, trainCalibration, trainVolatility), players: Object.keys(trainVolatility).length };
  const useVolatility = volatilityCheck.with.boom <= volatilityCheck.without.boom && volatilityCheck.with.bust <= volatilityCheck.without.bust;
  const calibration = buildCalibration(samples); // production table uses every season
  await writeFile(OUTPUT, `${JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    seasons,
    quantiles: QUANTILES,
    thresholds: BOOM_BUST_THRESHOLDS,
    samples: samples.length,
    validation: { trainSeasons: seasons.slice(0, -1), testSeason: holdout, ...validation, volatilityCheck, useVolatility },
    positions: calibration,
    volatility: useVolatility ? buildVolatility(samples) : {}
  }, null, 1)}\n`);
  console.log(JSON.stringify({ samples: samples.length, test: test.length, volatilityCheck, useVolatility }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
