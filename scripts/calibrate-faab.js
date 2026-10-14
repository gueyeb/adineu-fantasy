#!/usr/bin/env node
/**
 * Adineu Fantasy — calibration du modèle d'enchères FAAB (docs/prd-model-challenge.md, chantier 1).
 *
 * Rebuilds, for every waiver leg of the season, what each team could see before the waivers ran:
 * rosters (current rosters with later transactions undone), remaining budgets, last three weeks of
 * usage and the target week's Sleeper projections (for each rival's lineup need). Every valid bid —
 * won or lost — becomes a sample; the quantity to predict is the best bid of the other teams.
 * Writes public/data/faab-auction-calibration.json with leave-one-leg-out and chronological scores.
 *
 * Automatic: the Tuesday job (runWeeklyJob) recalibrates and stores the fit in Supabase
 * (faab_auction_calibrations); the server reads the latest one. CLI: npm run calibrate:faab
 * [-- --dry-run] refreshes the committed fallback file only.
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AUCTION_FEATURES, RIVAL_NEED_POINTS, SD_INFLATION, TARGET_WIN_PROBABILITY, auctionFeatures, fitAuctionModel, lineupGain, scoreAuction } from "../public/assets/faab-auction.js";
import { buildOpportunitySignals } from "../public/assets/waiver-model.js";
import { GENERAL_SETTINGS_2026 } from "../public/assets/league-settings.js";

const SLEEPER = "https://api.sleeper.app/v1";
const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
export const CALIBRATION_PATH = new URL("../public/data/faab-auction-calibration.json", import.meta.url);
const INVALID_BID_NOTE = /roster will have too many players|already started playing/i;

/** Rosters as they stood before leg `leg` ran: every completed transaction of a later or equal leg undone. */
export function rostersBeforeLeg(rosters, transactions, leg) {
  const byRoster = new Map(rosters.map(roster => [roster.roster_id, new Set((roster.players || []).map(String))]));
  const undo = transactions.filter(row => row.status === "complete" && row.leg >= leg)
    .sort((a, b) => (b.status_updated ?? 0) - (a.status_updated ?? 0));
  for (const row of undo) {
    for (const [id, rosterId] of Object.entries(row.adds || {})) byRoster.get(rosterId)?.delete(String(id));
    for (const [id, rosterId] of Object.entries(row.drops || {})) byRoster.get(rosterId)?.add(String(id));
  }
  return byRoster;
}

/** Remaining FAAB before leg `leg`: the budget minus winning bids of earlier legs. */
export function budgetsBeforeLeg(rosters, transactions, leg, budget = GENERAL_SETTINGS_2026.waiver.budget) {
  const spent = new Map(rosters.map(roster => [roster.roster_id, 0]));
  for (const row of transactions) {
    if (row.type !== "waiver" || row.status !== "complete" || row.leg >= leg) continue;
    for (const rosterId of Object.values(row.adds || {})) spent.set(rosterId, (spent.get(rosterId) || 0) + Number(row.settings?.waiver_bid || 0));
  }
  return new Map([...spent].map(([rosterId, used]) => [rosterId, budget - used]));
}

/**
 * One sample per valid bid. A bid that Sleeper rejected for a full roster or a locked drop never
 * competed: it is neither a bidder nor a rival.
 * @param {Object} statsByWeek week -> Sleeper stats; projectionsByWeek week -> Sleeper projections.
 */
export function buildAuctionSamples({ transactions, rosters, statsByWeek, projectionsByWeek, positionOf, yearsExpOf, slots, legs }) {
  const samples = [];
  for (const leg of legs) {
    const rosterSets = rostersBeforeLeg(rosters, transactions, leg);
    const budgets = budgetsBeforeLeg(rosters, transactions, leg);
    const targetWeek = leg + 1;
    const pointsOf = id => projectionsByWeek[targetWeek]?.[id]?.pts_ppr ?? 0;
    const window = [leg - 2, leg - 1, leg].filter(week => week >= 1 && statsByWeek[week]).map(week => ({ week, stats: statsByWeek[week] }));
    const bidsByPlayer = new Map();
    for (const row of transactions) {
      if (row.leg !== leg || row.type !== "waiver" || !["complete", "failed"].includes(row.status) || INVALID_BID_NOTE.test(row.metadata?.notes || "")) continue;
      const bid = Number(row.settings?.waiver_bid);
      if (!Number.isFinite(bid)) continue;
      for (const [id, rosterId] of Object.entries(row.adds || {})) {
        const bids = bidsByPlayer.get(id) || new Map();
        const previous = bids.get(rosterId);
        bids.set(rosterId, { bid: Math.max(bid, previous?.bid ?? -1), won: Boolean(previous?.won) || row.status === "complete" });
        bidsByPlayer.set(id, bids);
      }
    }
    for (const [playerId, bids] of bidsByPlayer) {
      const position = positionOf(playerId);
      if (!position) continue;
      const series = buildOpportunitySignals(playerId, window).series;
      const needs = new Map([...rosterSets].map(([rosterId, ids]) => [rosterId, lineupGain(ids, playerId, { pointsOf, positionOf, slots })]));
      const someoneWon = [...bids.values()].some(entry => entry.won);
      for (const [rosterId, entry] of bids) {
        const rivals = [...rosterSets.keys()].filter(id => id !== rosterId);
        const rivalBids = [...bids].filter(([id]) => id !== rosterId).map(([, other]) => other.bid);
        samples.push({ leg, playerId, rosterId, bid: entry.bid, won: someoneWon ? entry.won : null,
          x: auctionFeatures({ position, yearsExp: yearsExpOf(playerId), series, rivalNeeds: rivals.map(id => needs.get(id)) }),
          bestRivalBid: rivalBids.length ? Math.max(...rivalBids) : null,
          maxRivalBudget: Math.max(...rivals.map(id => budgets.get(id) ?? 0)) });
      }
    }
  }
  return samples.filter(sample => sample.x);
}

/** Leave-one-leg-out and chronological validation (train on earlier legs only, at least two).
 * The constant-rate reference uses the training legs' win rate, never the tested leg's. */
export function validateAuctionModel(samples, { sdInflation = SD_INFLATION } = {}) {
  const legs = [...new Set(samples.map(sample => sample.leg))].sort((a, b) => a - b);
  const run = chronological => {
    const parts = [];
    for (const leg of legs) {
      const train = samples.filter(sample => sample.leg !== leg && (!chronological || sample.leg < leg));
      if (chronological && new Set(train.map(sample => sample.leg)).size < 2) continue;
      const model = fitAuctionModel(train, { sdInflation });
      const decided = train.filter(sample => sample.won !== null);
      if (!model || !decided.length) continue;
      const part = scoreAuction(model, samples.filter(sample => sample.leg === leg), { baseRate: decided.filter(sample => sample.won).length / decided.length });
      if (part) parts.push(part);
    }
    if (!parts.length) return null;
    const total = key => parts.reduce((sum, part) => sum + part[key], 0);
    const weighted = (key, weight) => Number((parts.reduce((sum, part) => sum + (part[key] ?? 0) * part[weight], 0) / Math.max(1, total(weight))).toFixed(3));
    return { legsTested: parts.length, bids: total("bids"), brier: weighted("brier", "bids"), constantRateBrier: weighted("constantRateBrier", "bids"),
      contested: total("contested"), interquartileCoverage: weighted("interquartileCoverage", "contested") };
  };
  return { leaveOneLegOut: run(false), chronological: run(true) };
}

async function getJson(path, fetchImpl = fetch) {
  const response = await fetchImpl(`${SLEEPER}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Sleeper ${path} -> HTTP ${response.status}`);
  return response.json();
}

/** Fits the auction model on every bid of the season so far; throws when there are too few bids. */
export async function calibrateFaab({ fetchImpl = fetch, leagueId = LEAGUE_ID } = {}) {
  const get = path => getJson(path, fetchImpl);
  const [league, rosters, state, players] = await Promise.all([get(`/league/${leagueId}`), get(`/league/${leagueId}/rosters`), get("/state/nfl"), get("/players/nfl")]);
  const season = league.season;
  const lastLeg = Math.max(0, Number(state.leg ?? state.week) - 1);
  const legs = Array.from({ length: lastLeg }, (_, i) => i + 1);
  const transactions = (await Promise.all([...legs, lastLeg + 1].map(leg => get(`/league/${leagueId}/transactions/${leg}`)))).flat();
  const statsByWeek = Object.fromEntries(await Promise.all(legs.map(async week => [week, await get(`/stats/nfl/regular/${season}/${week}`)])));
  const projectionsByWeek = Object.fromEntries(await Promise.all(legs.map(async leg => [leg + 1, await get(`/projections/nfl/regular/${season}/${leg + 1}`)])));
  const slots = (league.roster_positions || []).filter(slot => !["BN", "IR", "TAXI"].includes(slot));
  const positionOf = id => players[id]?.position || players[id]?.fantasy_positions?.[0] || null;
  const yearsExpOf = id => Number.isFinite(players[id]?.years_exp) ? players[id].years_exp : null;
  const samples = buildAuctionSamples({ transactions, rosters, statsByWeek, projectionsByWeek, positionOf, yearsExpOf, slots, legs });
  const model = fitAuctionModel(samples);
  if (!model) throw new Error(`Not enough bids to fit (${samples.length})`);
  return {
    generatedAt: new Date().toISOString(), season, leagueId, legs,
    method: "Best rival bid: P(any) logistic + log-normal amount (ridge), sd inflated; rival budgets cap",
    features: AUCTION_FEATURES, rivalNeedPoints: RIVAL_NEED_POINTS, sdInflation: SD_INFLATION, targetWinProbability: TARGET_WIN_PROBABILITY,
    sample: { bids: samples.length, contested: samples.filter(sample => sample.bestRivalBid !== null).length, won: samples.filter(sample => sample.won).length },
    model: { rivalBidWeights: model.rivalBidWeights.map(value => Number(value.toFixed(4))), amountWeights: model.amountWeights.map(value => Number(value.toFixed(4))), sd: Number(model.sd.toFixed(4)) },
    validation: validateAuctionModel(samples),
    limits: ["Sleeper projections of past weeks are read today (rival need only)", "Ties and waiver priority ignored", "No per-manager effect at this sample size"]
  };
}

const TABLE = "faab_auction_calibrations";

/** Appends one calibration (history kept); the latest of the season is the live one. */
export async function saveCalibration(supabase, calibration) {
  const { error } = await supabase.from(TABLE).insert({ season: Number(calibration.season), last_leg: Math.max(0, ...calibration.legs), generated_at: calibration.generatedAt, calibration });
  if (error) throw new Error(`${TABLE}: ${error.message}`);
}

/** Latest calibration of `season`, or null. */
export async function loadLatestCalibration(supabase, season) {
  const { data, error } = await supabase.from(TABLE).select("calibration").eq("season", Number(season)).order("generated_at", { ascending: false }).limit(1);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return data?.[0]?.calibration ?? null;
}

/** One line for the weekly message: sample and held-out scores of the new fit. */
export function formatCalibrationLine(calibration) {
  const v = calibration?.validation?.leaveOneLegOut;
  const c = calibration?.validation?.chronological;
  const pct = value => Number.isFinite(value) ? `${Math.round(value * 100)} %` : "n/d";
  return `Enchères FAAB recalibrées : ${calibration.sample.bids} enchères (legs 1–${Math.max(0, ...calibration.legs)}), fourchette p25–p75 ${pct(v?.interquartileCoverage)} hors échantillon / ${pct(c?.interquartileCoverage)} chronologique, Brier ${v?.brier ?? "n/d"} vs taux constant ${v?.constantRateBrier ?? "n/d"}.`;
}

async function main({ dryRun }) {
  const output = await calibrateFaab();
  if (!dryRun) await writeFile(CALIBRATION_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ written: !dryRun, sample: output.sample, validation: output.validation }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main({ dryRun: process.argv.includes("--dry-run") }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
