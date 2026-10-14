#!/usr/bin/env node
/**
 * Adineu Fantasy — challenger de l'usage : expected points ffopportunity (docs/backtest-ffopportunity.md,
 * docs/prd-model-challenge.md chantier 4).
 *
 * ffverse/ffopportunity publishes, per player and week, the fantasy points a play-by-play model
 * expected from each opportunity (`total_fantasy_points_exp`). This replays the same decisions as
 * `npm run backtest` (weeks 4→13 of 2021–2025, data known at the time) and adds that challenger:
 * its average over the same three past weeks, alone and blended with Sleeper's projection, against
 * our usage xFP. Weights are chosen leave-one-season-out, so no season grades its own weight.
 * Downloads are cached in .cache/backtest. Usage: npm run backtest:ffopportunity
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildSamples } from "./backtest-usage.js";

const CACHE = new URL("../.cache/backtest/", import.meta.url);
const FFOPP = season => `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`;
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const WEIGHTS = Array.from({ length: 11 }, (_, i) => i / 10);

async function cached(name, load) {
  const file = new URL(name, CACHE);
  try { return JSON.parse(await readFile(file, "utf8")); } catch {}
  const data = await load();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** [gsis, week, expected points] rows of one season (regular season weeks only). */
export function parseExpectedPoints(text) {
  const [header, ...lines] = text.trim().split("\n");
  const columns = header.split(",");
  const at = name => columns.indexOf(name);
  const [id, week, expected] = ["player_id", "week", "total_fantasy_points_exp"].map(at);
  return lines.map(line => line.split(",")).map(cells => [cells[id], Number(cells[week]), Number(cells[expected])])
    .filter(([gsis, week, points]) => gsis && week >= 1 && week <= 18 && Number.isFinite(points));
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const mae = (rows, predict, target) => mean(rows.map(row => Math.abs(predict(row) - row[target])));
const round = (value, digits = 2) => Number(value.toFixed(digits));

/** Average expected points of the player over the decision's window (weeks it has a row). */
export function attachExpectedPoints(samples, { expectedBySeason, gsisOf }) {
  return samples.map(sample => {
    const byKey = expectedBySeason[sample.season];
    const gsis = gsisOf(sample.playerId);
    const values = [sample.decision - 3, sample.decision - 2, sample.decision - 1].map(week => byKey?.get(`${gsis}|${week}`)).filter(Number.isFinite);
    return { ...sample, ffopp: gsis && values.length >= 2 ? mean(values) : null };
  });
}

/** Leave-one-season-out: the weight of `other` in a blend with the projection, picked on the other seasons. */
export function heldOutBlend(rows, other, target) {
  const seasons = [...new Set(rows.map(row => row.season))];
  const errors = [];
  const weights = {};
  for (const season of seasons) {
    const train = rows.filter(row => row.season !== season);
    const test = rows.filter(row => row.season === season);
    if (!train.length || !test.length) continue;
    const weight = WEIGHTS.reduce((best, w) => mae(train, row => (1 - w) * row.projection + w * row[other], target) < mae(train, row => (1 - best) * row.projection + best * row[other], target) ? w : best, 0);
    weights[season] = weight;
    errors.push(...test.map(row => Math.abs((1 - weight) * row.projection + weight * row[other] - row[target])));
  }
  return { mae: round(mean(errors)), weights };
}

export function compare(rows, target) {
  const usable = rows.filter(row => [row[target], row.projection, row.xfp, row.ffopp].every(Number.isFinite));
  if (!usable.length) return { n: 0 };
  return {
    n: usable.length,
    sleeper: round(mae(usable, row => row.projection, target)),
    usageXfp: round(mae(usable, row => row.xfp, target)),
    ffopportunity: round(mae(usable, row => row.ffopp, target)),
    pastPpg: round(mae(usable, row => row.ppg, target)),
    liveBlend: round(mae(usable, row => 0.8 * row.projection + 0.2 * row.xfp, target)),
    heldOutSleeperXfp: heldOutBlend(usable, "xfp", target),
    heldOutSleeperFfopp: heldOutBlend(usable, "ffopp", target)
  };
}

export async function runBacktest({ seasons = SEASONS } = {}) {
  const players = await cached("players-v2.json", () => { throw new Error("Run npm run backtest first to cache players-v2.json"); });
  const expectedBySeason = {};
  for (const season of seasons) {
    const rows = await cached(`ffopp-${season}.json`, async () => {
      const response = await fetch(FFOPP(season));
      if (!response.ok) throw new Error(`ffopportunity ${season} -> HTTP ${response.status}`);
      return parseExpectedPoints(await response.text());
    });
    expectedBySeason[season] = new Map(rows.map(([gsis, week, points]) => [`${gsis}|${week}`, points]));
  }
  const samples = attachExpectedPoints(await buildSamples(seasons), { expectedBySeason, gsisOf: id => players[id]?.gsis ?? null });
  const positions = ["QB", "RB", "WR", "TE"];
  return {
    seasons, samples: samples.length, withFfopp: samples.filter(sample => Number.isFinite(sample.ffopp)).length,
    far: compare(samples, "far"), next: compare(samples, "next"),
    byPosition: Object.fromEntries(positions.map(position => [position, { far: compare(samples.filter(sample => sample.position === position), "far"), next: compare(samples.filter(sample => sample.position === position), "next") }])),
    bySeason: Object.fromEntries(seasons.map(season => [season, compare(samples.filter(sample => sample.season === season), "far")]))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBacktest().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
