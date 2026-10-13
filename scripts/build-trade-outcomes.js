#!/usr/bin/env node
/**
 * Adineu Fantasy — who won each archived trade (docs/prd-trade-ledger.md).
 *
 * Reads public/data/yahoo-trades.json, resolves every Yahoo player to a Sleeper id, sums what each
 * side's haul scored after the trade (Sleeper weekly /stats, PPR) — raw points and points above
 * the week's replacement level — and writes `outcome` back into the archive. Run once after a new extraction: the result is frozen evidence, never
 * recomputed at runtime. Weekly stats are cached in .cache/backtest (gitignored).
 *
 * Player join: Sleeper `yahoo_id` first. Sleeper stopped filling it for recent rookies, so the
 * fallback is normalized name + position with exactly one candidate who played that season —
 * never a name alone. An unresolved player leaves his trade `INCOMPLETE`.
 *
 * Usage: node scripts/build-trade-outcomes.js [--dry-run]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateSeasonTrades, replacementLevel, REPLACEMENT_SLOTS, SEASON_CALENDAR } from "../public/assets/trade-ledger.js";

const ARCHIVE = new URL("../public/data/yahoo-trades.json", import.meta.url);
const CACHE = new URL("../.cache/backtest/", import.meta.url);
const SLEEPER = "https://api.sleeper.app/v1";
const dryRun = process.argv.includes("--dry-run");

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

const normalize = name => String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

const archive = JSON.parse(await readFile(ARCHIVE, "utf8"));
const history = JSON.parse(await readFile(new URL("../public/data/yahoo-history.json", import.meta.url), "utf8"));
const players = await cached("players-nfl.json", `${SLEEPER}/players/nfl`);
const byYahooId = new Map(Object.entries(players).filter(([, player]) => player?.yahoo_id != null).map(([id, player]) => [String(player.yahoo_id), id]));
const byName = new Map();
for (const [id, player] of Object.entries(players)) {
  if (!player?.full_name) continue;
  const key = `${normalize(player.full_name)}|${player.position}`;
  byName.set(key, [...(byName.get(key) || []), id]);
}

const unresolved = [];
for (const season of archive.seasons) {
  const { lastWeek } = SEASON_CALENDAR[season.year];
  const stats = {};
  for (let week = 1; week <= lastWeek; week++) stats[week] = await cached(`stats-${season.year}-${week}.json`, `${SLEEPER}/stats/nfl/regular/${season.year}/${week}`);
  const playedThisSeason = id => Object.values(stats).some(week => Number(week[id]?.gp) > 0);

  for (const trade of season.trades) {
    for (const side of trade.sides) {
      for (const player of side.received) {
        delete player.sleeperId; delete player.matchedBy; delete player.points; delete player.games; delete player.untilWeek; delete player.value;
        const direct = byYahooId.get(player.yahooId);
        const candidates = direct ? [direct] : (byName.get(`${normalize(player.name)}|${player.position}`) || []).filter(playedThisSeason);
        if (candidates.length === 1) { player.sleeperId = candidates[0]; player.matchedBy = direct ? "yahoo_id" : "name+position"; }
        else unresolved.push(`${season.year} ${player.name} (${candidates.length} candidats)`);
      }
    }
  }
  const pointsOf = (id, week) => (Number(stats[week]?.[id]?.gp) > 0 ? Number(stats[week][id].pts_ppr) || 0 : null);
  const teamCount = history.seasons.find(entry => entry.year === season.year).teamCount;
  const replacement = {};
  for (const [week, rows] of Object.entries(stats)) {
    const scores = {};
    for (const [id, row] of Object.entries(rows)) {
      const position = players[id]?.position;
      if (REPLACEMENT_SLOTS[position] && Number(row?.gp) > 0) (scores[position] ||= []).push(Number(row.pts_ppr) || 0);
    }
    replacement[week] = Object.fromEntries(Object.entries(scores).map(([position, list]) => [position, replacementLevel(list, position, teamCount)]));
  }
  season.trades = evaluateSeasonTrades(season, pointsOf, (position, week) => replacement[week]?.[position] ?? 0);
}

archive.outcomes = {
  computedAt: new Date().toISOString().slice(0, 10),
  scoring: "Sleeper pts_ppr",
  rule: "Valeur = points au-dessus du niveau de remplacement hebdomadaire du poste (dernier titulaire : équipes × QB 1, RB 2,5, WR 2,5, TE 1, K 1), de la première semaine NFL suivant le trade à la dernière semaine des playoffs de la ligue. Chaque trade est jugé seul."
};
const verdicts = {};
for (const season of archive.seasons) for (const trade of season.trades) verdicts[trade.outcome.verdict] = (verdicts[trade.outcome.verdict] || 0) + 1;
console.log(JSON.stringify({ verdicts, unresolved }, null, 1));
if (!dryRun) await writeFile(ARCHIVE, `${JSON.stringify(archive, null, 1)}\n`);
