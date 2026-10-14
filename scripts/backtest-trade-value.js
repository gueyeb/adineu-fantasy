#!/usr/bin/env node
/**
 * Adineu Fantasy — la valeur d'échange live contre les trades réels (docs/backtest-trade-value.md,
 * docs/prd-model-challenge.md chantier 3).
 *
 * For each of the 95 archived Yahoo trades (2019–2025), values both hauls the way the Trade Finder
 * now does (`buildLiveMarketValues`: weekly rate over the position's replacement level, scaled
 * 1–100, K/DEF capped) with only what was known on the trade date, then checks whether the side it
 * favours is the side the frozen verdict (`outcome`, points above replacement until the end of the
 * playoffs) says won. Weekly rates tested: season PPG to date, Sleeper's projection of the next
 * week, and their mean. Raw points to date (no replacement level) is the naive reference.
 * Data cached in .cache/backtest. Usage: npm run backtest:trade-value
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildLiveMarketValues } from "../public/assets/trade-value.js";
import { tradeStartWeek } from "../public/assets/trade-ledger.js";

const CACHE = new URL("../.cache/backtest/", import.meta.url);
const SLEEPER = "https://api.sleeper.app/v1";
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

async function cached(name, url) {
  const file = new URL(name, CACHE);
  try { return JSON.parse(await readFile(file, "utf8")); } catch {}
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const data = await response.json();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** Weekly rate of every player known before `week`: PPG to date, next-week projection, their mean. */
export function ratesBeforeWeek({ statsByWeek, projection, week, positionOf }) {
  const totals = new Map();
  for (let w = 1; w < week; w++) {
    for (const [id, row] of Object.entries(statsByWeek[w] || {})) {
      if (!(Number(row?.gp) > 0) || !POSITIONS.has(positionOf(id))) continue;
      const entry = totals.get(id) || { points: 0, games: 0 };
      entry.points += Number(row.pts_ppr) || 0;
      entry.games += 1;
      totals.set(id, entry);
    }
  }
  const ids = new Set([...totals.keys(), ...Object.keys(projection || {}).filter(id => POSITIONS.has(positionOf(id)))]);
  const rows = [];
  for (const id of ids) {
    const done = totals.get(id);
    const ppg = done?.games ? done.points / done.games : null;
    const projected = Number.isFinite(projection?.[id]?.pts_ppr) ? projection[id].pts_ppr : null;
    rows.push({ playerId: id, position: positionOf(id), ppg, projected, mean: ppg !== null && projected !== null ? (ppg + projected) / 2 : ppg ?? projected, points: done?.points ?? 0 });
  }
  return rows;
}

/** Which side each method favours, against the frozen verdict of every decided (WON) trade.
 * `valueOf(player)` prices one received player; a trade may carry its own (`trade.priceOf`). */
export function scoreTrades(trades, { valueOf = null } = {}) {
  let decided = 0, agree = 0, priced = 0, strongAgree = 0, strong = 0;
  const details = [];
  for (const trade of trades) {
    if (trade.outcome?.verdict !== "WON") continue;
    const price = Object.hasOwn(trade, "priceOf") ? trade.priceOf : valueOf;
    const sides = trade.sides.map(side => side.received.map(player => price(player)));
    if (sides.some(values => values.some(value => value === null))) { details.push({ ...trade.key, status: "UNPRICED" }); continue; }
    decided++;
    const totals = sides.map(values => values.reduce((sum, value) => sum + value, 0));
    if (totals[0] === totals[1]) { details.push({ ...trade.key, status: "TIE" }); continue; }
    priced++;
    const favoured = totals[0] > totals[1] ? trade.sides[0].manager : trade.sides[1].manager;
    const right = favoured === trade.outcome.winner;
    if (right) agree++;
    // A clear call: the favoured side is worth at least 25 % more.
    if (Math.max(...totals) >= 1.25 * Math.max(1e-9, Math.min(...totals))) { strong++; if (right) strongAgree++; }
    details.push({ ...trade.key, status: right ? "RIGHT" : "WRONG", totals: totals.map(value => Number(value.toFixed(1))) });
  }
  return { decided, priced, agreement: priced ? Number((agree / priced).toFixed(3)) : null, clearCalls: strong, clearCallAgreement: strong ? Number((strongAgree / strong).toFixed(3)) : null, details };
}

export async function runBacktest() {
  const archive = JSON.parse(await readFile(new URL("../public/data/yahoo-trades.json", import.meta.url), "utf8"));
  const history = JSON.parse(await readFile(new URL("../public/data/yahoo-history.json", import.meta.url), "utf8"));
  const players = await cached("players-nfl.json", `${SLEEPER}/players/nfl`);
  const positionOf = id => players[id]?.position ?? null;
  const methods = { ppgToDate: "ppg", nextWeekProjection: "projected", mean: "mean" };
  const valued = Object.fromEntries([...Object.keys(methods), "rawPointsToDate"].map(name => [name, []]));
  for (const season of archive.seasons) {
    const teams = history.seasons.find(entry => entry.year === season.year)?.teamCount ?? 12;
    const statsByWeek = {};
    for (let week = 1; week <= 17; week++) statsByWeek[week] = await cached(`stats-${season.year}-${week}.json`, `${SLEEPER}/stats/nfl/regular/${season.year}/${week}`);
    for (const [index, trade] of season.trades.entries()) {
      const week = tradeStartWeek(trade.date, season.year);
      const projection = await cached(`proj-${season.year}-${week}.json`, `${SLEEPER}/projections/nfl/regular/${season.year}/${week}`);
      const rows = ratesBeforeWeek({ statsByWeek, projection, week, positionOf });
      const key = { season: season.year, index, date: trade.date, week };
      for (const [name, field] of Object.entries(methods)) {
        const { values } = buildLiveMarketValues(rows.map(row => ({ playerId: row.playerId, position: row.position, rosPpg: row[field] })), { teams });
        valued[name].push({ ...trade, key, priceOf: player => player.sleeperId ? values.get(player.sleeperId)?.marketValue ?? (rows.some(row => row.playerId === player.sleeperId && row[field] !== null) ? 1 : 0) : null });
      }
      const raw = new Map(rows.map(row => [row.playerId, row.points]));
      valued.rawPointsToDate.push({ ...trade, key, priceOf: player => player.sleeperId ? raw.get(player.sleeperId) ?? 0 : null });
    }
  }
  return Object.fromEntries(Object.entries(valued).map(([name, trades]) => [name, scoreTrades(trades)]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBacktest().then(report => {
    for (const [name, score] of Object.entries(report)) console.log(name.padEnd(20), JSON.stringify({ ...score, details: undefined }));
    if (process.argv.includes("--details")) console.log(JSON.stringify(report.mean.details, null, 1));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
