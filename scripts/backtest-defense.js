#!/usr/bin/env node
/**
 * Adineu Fantasy — backtest of the defense matchup estimate on 2021–2025 (docs/backtest-defense.md).
 *
 * Replays every regular-season week 1→17 with only the data known before kickoff (team stats of
 * the previous games, prior season included; that week's Vegas lines) and compares, for each
 * defense, the Adineu expected score, Sleeper's pregame projection (rescored at league scoring) and
 * blends of the two against the points the defense actually scored at league scoring.
 *
 * Metrics: MAE, Pearson r, mean within-week Spearman (ranking is what streaming needs), and the
 * average actual score of each predictor's weekly top 5 and top 10.
 * Downloads are cached in .cache/backtest (gitignored). Usage: node scripts/backtest-defense.js [--seasons=2021,2022]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluateDefenseMatchup } from "../public/assets/defense-matchup.js";
import { leaguePoints } from "../public/assets/weekly-leaders.js";

const CACHE = new URL("../.cache/backtest/", import.meta.url);
const SLEEPER = "https://api.sleeper.app/v1";
const LEAGUE_ID = "1392715510830878721";
const TEAM_STATS = season => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
const GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const TEAM = { LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" };
const team = code => TEAM[code] || code;
export const BLENDS = [0, 0.25, 0.5, 0.75, 1];

async function cached(name, load, { text = false } = {}) {
  const file = new URL(name, CACHE);
  try { const raw = await readFile(file, "utf8"); return text ? raw : JSON.parse(raw); } catch {}
  const data = await load();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, text ? data : JSON.stringify(data));
  return data;
}
const getJson = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`); return response.json(); };
const getText = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`); return response.text(); };
const splitCsv = line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, ""));
function parseCsv(text) {
  const [header, ...lines] = text.trim().split("\n");
  const columns = splitCsv(header);
  return lines.map(line => Object.fromEntries(splitCsv(line).map((cell, index) => [columns[index], cell])));
}

async function teamWeeks(season) {
  const rows = parseCsv(await cached(`team-week-${season}.csv`, () => getText(TEAM_STATS(season)), { text: true }));
  const number = value => Number(value) || 0;
  return rows.filter(row => row.season_type === "REG").map(row => ({
    season: Number(row.season), week: Number(row.week), gameId: row.game_id, team: team(row.team), opponent: team(row.opponent_team),
    attempts: number(row.attempts), sacksSuffered: number(row.sacks_suffered), interceptions: number(row.passing_interceptions),
    fumblesLost: number(row.fumbles_lost_total), carries: number(row.carries), defSacks: number(row.def_sacks),
    defTds: number(row.def_tds), specialTeamsTds: number(row.special_teams_tds)
  }));
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function pearson(xs, ys) {
  const mx = mean(xs); const my = mean(ys);
  let num = 0; let dx = 0; let dy = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return num / Math.sqrt(dx * dy);
}
const ranks = values => {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
  const result = new Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end++;
    for (let i = start; i <= end; i++) result[order[i][1]] = (start + end) / 2;
    start = end + 1;
  }
  return result;
};
const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));
const round = (value, digits = 2) => Number(value.toFixed(digits));

/** Scores a list of { week, predicted, actual } samples. */
export function scorePredictor(samples) {
  const byWeek = new Map();
  for (const sample of samples) {
    if (!byWeek.has(sample.key)) byWeek.set(sample.key, []);
    byWeek.get(sample.key).push(sample);
  }
  const weeks = [...byWeek.values()].filter(list => list.length >= 10);
  const top = n => mean(weeks.flatMap(list => [...list].sort((a, b) => b.predicted - a.predicted).slice(0, n).map(sample => sample.actual)));
  return {
    n: samples.length,
    mae: round(mean(samples.map(sample => Math.abs(sample.predicted - sample.actual)))),
    pearson: round(pearson(samples.map(sample => sample.predicted), samples.map(sample => sample.actual)), 3),
    spearmanByWeek: round(mean(weeks.map(list => spearman(list.map(sample => sample.predicted), list.map(sample => sample.actual)))), 3),
    top5Actual: round(top(5)), top10Actual: round(top(10))
  };
}

async function main() {
  const arg = process.argv.find(value => value.startsWith("--seasons="));
  const seasons = arg ? arg.slice(10).split(",").map(Number) : [2021, 2022, 2023, 2024, 2025];
  const league = await cached("league.json", () => getJson(`${SLEEPER}/league/${LEAGUE_ID}`));
  const scoring = league.scoring_settings;
  const games = parseCsv(await cached("games.csv", () => getText(GAMES), { text: true }));
  const rows = [];
  for (const season of seasons) {
    const history = [...await teamWeeks(season - 1), ...await teamWeeks(season)];
    for (let week = 1; week <= 17; week++) {
      const stats = await cached(`stats-${season}-${week}.json`, () => getJson(`${SLEEPER}/stats/nfl/regular/${season}/${week}`));
      const projections = await cached(`proj-${season}-${week}.json`, () => getJson(`${SLEEPER}/projections/nfl/regular/${season}/${week}`));
      for (const game of games.filter(row => Number(row.season) === season && row.game_type === "REG" && Number(row.week) === week)) {
        const matchup = { home: team(game.home_team), away: team(game.away_team), spread: game.spread_line === "" ? null : Number(game.spread_line), total: game.total_line === "" ? null : Number(game.total_line) };
        for (const defense of [matchup.home, matchup.away]) {
          const actualRow = stats[defense];
          const projectionRow = projections[defense];
          if (!(Number(actualRow?.gp) > 0) || !projectionRow) continue;
          const row = evaluateDefenseMatchup({ defense, game: matchup, teamWeeks: history, scoring, target: { season, week } });
          if (!Number.isFinite(row.expected.total)) continue;
          rows.push({ key: `${season}-${week}`, season, week, defense, adineu: row.expected.total, sleeper: leaguePoints(projectionRow, scoring), actual: leaguePoints(actualRow, scoring), reliability: row.reliability });
        }
      }
    }
  }
  const results = {};
  for (const weight of BLENDS) {
    results[`adineu_${weight}`] = scorePredictor(rows.map(row => ({ key: row.key, predicted: weight * row.adineu + (1 - weight) * row.sleeper, actual: row.actual })));
  }
  const bySeason = Object.fromEntries(seasons.map(season => {
    const list = rows.filter(row => row.season === season);
    return [season, { sleeper: scorePredictor(list.map(row => ({ key: row.key, predicted: row.sleeper, actual: row.actual }))),
      adineu: scorePredictor(list.map(row => ({ key: row.key, predicted: row.adineu, actual: row.actual }))),
      blend50: scorePredictor(list.map(row => ({ key: row.key, predicted: (row.adineu + row.sleeper) / 2, actual: row.actual }))) }];
  }));
  const late = rows.filter(row => row.week >= 5);
  const lateResults = Object.fromEntries(BLENDS.map(weight => [`adineu_${weight}`, scorePredictor(late.map(row => ({ key: row.key, predicted: weight * row.adineu + (1 - weight) * row.sleeper, actual: row.actual })))]));
  console.log(JSON.stringify({ samples: rows.length, meanActual: round(mean(rows.map(row => row.actual))), results, weeks5plus: lateResults, bySeason }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("Erreur :", error.message); process.exitCode = 1; });
}
