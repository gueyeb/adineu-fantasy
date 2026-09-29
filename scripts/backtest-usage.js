#!/usr/bin/env node
/**
 * Adineu Fantasy — Backtest of the usage model on 2024–2025 (docs/backtest-usage.md).
 *
 * Replays each decision week N (4→13) with ONLY the data known at that time, using the exact
 * live functions (buildPlayerWeeks / calculateUsageScores), and scores each predictor against
 * what players actually scored afterwards:
 *   - "far" target: mean PPR over weeks N+2..N+5 (games played, ≥ 2) — the horizon where the
 *     live model blends Sleeper projections with usage;
 *   - "next" target: PPR in week N (the next game).
 * Predictors: past PPG (recency-weighted, last 3 games), usage xFP, Sleeper's pregame projection
 * for week N (a proxy for the projection level carried forward), and blends of them.
 *
 * Data: Sleeper /stats and /projections (same format as live), nflverse weekly player stats for
 * the player's team each week (Sleeper weekly stats have no team). Downloads are cached in
 * .cache/backtest (gitignored). Usage: node scripts/backtest-usage.js [--seasons=2024,2025] [--json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildPlayerWeeks, calculateUsageScores } from "../public/assets/usage-score.js";

const CACHE = new URL("../.cache/backtest/", import.meta.url);
const SLEEPER = "https://api.sleeper.app/v1";
const NFLVERSE = season => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
const POSITIONS = ["RB", "WR", "TE"];

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

function parseCsv(text) {
  const [header, ...lines] = text.trim().split("\n");
  const columns = header.split(",");
  const index = name => columns.indexOf(name);
  const [id, week, team, type] = ["player_id", "week", "team", "season_type"].map(index);
  // Only the 4 columns we need; none of them contain quoted commas.
  return lines.map(line => {
    const cells = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    return { gsis: cells[id], week: Number(cells[week]), team: cells[team], seasonType: cells[type] };
  }).filter(row => row.seasonType === "REG");
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function pearson(xs, ys) {
  const mx = mean(xs); const my = mean(ys);
  let num = 0; let dx = 0; let dy = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return num / Math.sqrt(dx * dy);
}
const mae = (xs, ys) => mean(xs.map((x, i) => Math.abs(x - ys[i])));
const round = (value, digits = 2) => Number(value.toFixed(digits));

export async function buildSamples(seasons) {
  const players = await cached("players-v2.json", async () => {
    const raw = await getJson(`${SLEEPER}/players/nfl`);
    // QBs/FBs too: their carries and targets belong in the team totals, exactly like the live model.
    return Object.fromEntries(Object.entries(raw).filter(([, p]) => [...POSITIONS, "QB", "FB"].includes(p?.position)).map(([id, p]) => [id, { gsis: p.gsis_id || null, position: p.position, name: p.full_name }]));
  });
  const samples = [];
  for (const season of seasons) {
    const stats = {};
    const projections = {};
    for (let week = 1; week <= 18; week++) {
      stats[week] = await cached(`stats-${season}-${week}.json`, () => getJson(`${SLEEPER}/stats/nfl/regular/${season}/${week}`));
      projections[week] = await cached(`proj-${season}-${week}.json`, () => getJson(`${SLEEPER}/projections/nfl/regular/${season}/${week}`));
    }
    const teams = await cached(`nflverse-teams-${season}.json`, async () => {
      const response = await fetch(NFLVERSE(season));
      if (!response.ok) throw new Error(`nflverse ${season} -> HTTP ${response.status}`);
      return parseCsv(await response.text()).map(row => [row.gsis, row.week, row.team]);
    });
    const teamByGsisWeek = new Map(teams.map(([gsis, week, team]) => [`${gsis}|${week}`, team]));
    const teamOf = (id, week) => {
      const gsis = players[id]?.gsis;
      return gsis ? teamByGsisWeek.get(`${gsis}|${week}`) || null : null;
    };
    const positionOf = id => players[id]?.position || null;
    const played = (week, id) => stats[week]?.[id]?.off_snp > 0;

    for (let decision = 4; decision <= 13; decision++) {
      const window = [decision - 3, decision - 2, decision - 1].map(week => ({ week, stats: stats[week] }));
      const rows = buildPlayerWeeks(window, { teamOf, positionOf });
      const { players: usage } = calculateUsageScores(rows);
      for (const player of usage) {
        if (player.games < 2) continue;
        const projection = projections[decision]?.[player.playerId]?.pts_ppr;
        const farWeeks = [decision + 2, decision + 3, decision + 4, decision + 5].filter(week => week <= 18 && played(week, player.playerId));
        const far = farWeeks.length >= 2 ? mean(farWeeks.map(week => stats[week][player.playerId].pts_ppr ?? 0)) : null;
        const next = played(decision, player.playerId) ? stats[decision][player.playerId].pts_ppr ?? 0 : null;
        samples.push({
          season, decision, playerId: player.playerId, position: player.position,
          ppg: player.ppg, xfp: player.xfp, projection: Number.isFinite(projection) ? projection : null,
          usageScore: player.usageScore, signal: player.signal, far, next
        });
      }
    }
  }
  return samples;
}

function evaluate(samples, target) {
  const rows = samples.filter(sample => Number.isFinite(sample[target]) && Number.isFinite(sample.projection));
  const y = rows.map(row => row[target]);
  const predictors = {
    "Points passés (PPG)": rows.map(row => row.ppg),
    "Usage (xFP)": rows.map(row => row.xfp),
    "Projection Sleeper": rows.map(row => row.projection),
    "50/50 projection + xFP (modèle live)": rows.map(row => 0.5 * row.projection + 0.5 * row.xfp)
  };
  const results = Object.entries(predictors).map(([name, x]) => ({ name, mae: round(mae(x, y)), r: round(pearson(x, y), 3) }));
  // Grid over the simplex: projection / xFP / PPG weights by 0.1.
  let best = null;
  for (let a = 0; a <= 10; a++) {
    for (let b = 0; a + b <= 10; b++) {
      const c = 10 - a - b;
      const x = rows.map(row => (a * row.projection + b * row.xfp + c * row.ppg) / 10);
      const score = mae(x, y);
      if (!best || score < best.mae) best = { projection: a / 10, xfp: b / 10, ppg: c / 10, mae: round(score), r: round(pearson(x, y), 3) };
    }
  }
  return { n: rows.length, results, best };
}

function evaluateSignals(samples) {
  const rows = samples.filter(sample => Number.isFinite(sample.far));
  const summarize = list => list.length ? {
    n: list.length,
    changeVsPast: round(mean(list.map(row => row.far - row.ppg))),
    improvedRate: round(list.filter(row => row.far > row.ppg).length / list.length, 3)
  } : { n: 0 };
  return {
    BUY_LOW: summarize(rows.filter(row => row.signal === "BUY_LOW")),
    SELL_HIGH: summarize(rows.filter(row => row.signal === "SELL_HIGH")),
    ALL: summarize(rows)
  };
}

export async function runBacktest({ seasons = [2024, 2025] } = {}) {
  const samples = await buildSamples(seasons);
  const byPosition = Object.fromEntries(POSITIONS.map(position => [position, {
    far: evaluate(samples.filter(sample => sample.position === position), "far"),
    next: evaluate(samples.filter(sample => sample.position === position), "next")
  }]));
  return { seasons, samples: samples.length, far: evaluate(samples, "far"), next: evaluate(samples, "next"), byPosition, signals: evaluateSignals(samples) };
}

async function main() {
  const seasonsArg = process.argv.find(arg => arg.startsWith("--seasons="));
  const seasons = seasonsArg ? seasonsArg.split("=")[1].split(",").map(Number) : [2024, 2025];
  const report = await runBacktest({ seasons });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
