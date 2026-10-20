#!/usr/bin/env node
/**
 * Adineu Fantasy — suivi hebdomadaire du modèle (docs/prd-model-tracking.md).
 *
 * Un seul job, le mardi (après le Monday Night, avant les waivers du mercredi) :
 *   1. BILAN de la semaine terminée W-1 :
 *      - enchères FAAB gagnées (Sleeper /transactions) comparées au marché estimé le mardi d'avant ;
 *      - précision des projections Sleeper selon leur ancienneté (1, 2, 3+ semaines avant le match) ;
 *      - suivi des signaux buy-low / sell-high émis les semaines précédentes ;
 *      - anomalies au format ALGO FEEDBACK (une règle à revoir, jamais une correction joueur par joueur).
 *   2. SNAPSHOT de la semaine W : marché waiver, projections futures Sleeper telles qu'elles sont
 *      aujourd'hui, Usage Score. Sleeper ne garde pas ces projections : sans archive, impossible de
 *      recalibrer le prix FAAB ou de mesurer le vieillissement des projections lointaines.
 *
 * Idempotent : relancer la même semaine remplace son snapshot et son bilan.
 * CLI : npm run track:weekly[:production] [-- --dry-run]
 * n8n : POST /api/model/weekly (Authorization: Bearer $MODEL_JOB_TOKEN).
 */
import { scoreExperts, formatExpertBenchmark } from "./expert-benchmark.js";
import { createSupabaseSosStore } from "./sos-store.js";
import { createSosService, sosService } from "./sos-service.js";
import { loadSosSources } from "./sos-sources.js";
import { trackSos } from "./sos-tracking.js";
import { pathToFileURL } from "node:url";
import { getFreeAgents, getUsageReport, getWeeklyProjections, getWeeklyStats, loadAuctionCalibration, primeAuctionCalibration } from "./league-context.js";
import { calibrateFaab, formatCalibrationLine, saveCalibration } from "./calibrate-faab.js";
import { AUCTION_FEATURES, RIVAL_NEED_POINTS, scoreAuction } from "../public/assets/faab-auction.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { GENERAL_SETTINGS_2026 } from "../public/assets/league-settings.js";
import { PRICE_PER_POINT } from "../public/assets/waiver-model.js";
import { DIRECT_PROJECTION_WEEKS, FAR_WEEK_USAGE_WEIGHT, FAR_WEEK_USAGE_WEIGHT_BY_POSITION } from "../public/assets/rest-of-season.js";

export const MODEL_VERSION = "waiver-v2 · usage RB/WR/TE 0.2, QB 0.5 · 2026-10-01";
const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER = "https://api.sleeper.app/v1";
const LAST_REGULAR_WEEK = GENERAL_SETTINGS_2026.playoffWeekStart - 1;
const MIN_SURPLUS_FOR_PRICE = 5;

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, digits = 2) => value === null || value === undefined ? null : Number(Number(value).toFixed(digits));

// ---------------------------------------------------------------------------------------------
// Pure feedback computations (tested in test/model-tracking.test.js)
// ---------------------------------------------------------------------------------------------

/** Winning claims vs the market the model estimated before the waivers ran. */
export function summarizeFaabCalibration(outcomes = [], marketById = new Map(), { pricePerPoint = PRICE_PER_POINT } = {}) {
  const claims = outcomes.map(outcome => {
    const market = marketById.get(outcome.sleeper_player_id) || null;
    const comparable = market && Number.isFinite(market.faab_low) && Number.isFinite(market.faab_high) && market.faab_low >= 0 && market.faab_high >= market.faab_low;
    const surplus = comparable ? Number(market.surplus_points) : null;
    return {
      playerId: outcome.sleeper_player_id,
      name: market?.name || outcome.name || outcome.sleeper_player_id,
      bid: outcome.bid,
      predicted: comparable ? [market.faab_low, market.faab_high] : null,
      surplus,
      inRange: comparable ? outcome.bid >= market.faab_low && outcome.bid <= market.faab_high : null,
      impliedPricePerPoint: surplus > MIN_SURPLUS_FOR_PRICE ? outcome.bid / surplus : null
    };
  });
  const covered = claims.filter(claim => claim.predicted);
  const prices = claims.map(claim => claim.impliedPricePerPoint).filter(Number.isFinite);
  const anomalies = covered.filter(claim => (claim.bid >= 30 && claim.predicted[1] === 0) || claim.bid > 2 * Math.max(claim.predicted[1], 10) || (claim.predicted[0] >= 30 && claim.bid < claim.predicted[0] / 3));
  return {
    claims: claims.length,
    covered: covered.length,
    inRangeRate: covered.length ? round(covered.filter(claim => claim.inRange).length / covered.length, 3) : null,
    medianImpliedPricePerPoint: round(median(prices)),
    pricePerPoint,
    pricedClaims: prices.length,
    anomalies: anomalies.map(claim => ({ name: claim.name, bid: claim.bid, predicted: claim.predicted, surplus: round(claim.surplus, 1) }))
  };
}

/** Projection error by age: a projection made `horizon` weeks before the game vs actual points. */
export function projectionAccuracyByHorizon(projectionRows = [], actualById = new Map(), targetWeek) {
  const byHorizon = new Map();
  for (const row of projectionRows) {
    if (row.target_week !== targetWeek || !actualById.has(row.sleeper_player_id)) continue;
    const horizon = targetWeek - row.snapshot_week;
    const error = Math.abs(Number(row.pts_ppr) - actualById.get(row.sleeper_player_id));
    if (!byHorizon.has(horizon)) byHorizon.set(horizon, []);
    byHorizon.get(horizon).push(error);
  }
  return [...byHorizon].sort((a, b) => a[0] - b[0]).map(([horizon, errors]) => ({ horizon, n: errors.length, mae: round(mean(errors)) }));
}

/**
 * Adineu vs Sleeper on one completed week, same cohort: every player with a Sleeper projection
 * for that week in a snapshot, the usage xFP of that same snapshot, and a played game. Three
 * predictors: Sleeper alone, usage xFP alone, and what our rest-of-season pace uses for that week
 * (Sleeper inside DIRECT_PROJECTION_WEEKS, then the position's usage blend). Grouped by
 * projection age and position; a blend that stops beating Sleeper shows up here.
 */
export function projectionScorecard(projectionRows = [], usageBySnapshotWeek = new Map(), actualById = new Map(), targetWeek) {
  const groups = new Map();
  const add = (key, errors) => {
    const group = groups.get(key) || { n: 0, sleeper: 0, usage: 0, adineu: 0 };
    group.n++;
    for (const name of ["sleeper", "usage", "adineu"]) group[name] += errors[name];
    groups.set(key, group);
  };
  for (const row of projectionRows) {
    if (row.target_week !== targetWeek || !actualById.has(row.sleeper_player_id)) continue;
    const usage = usageBySnapshotWeek.get(row.snapshot_week)?.get(row.sleeper_player_id);
    const weight = FAR_WEEK_USAGE_WEIGHT_BY_POSITION[usage?.position];
    if (!usage || !Number.isFinite(Number(usage.xfp)) || weight === undefined) continue;
    const horizon = targetWeek - row.snapshot_week;
    const sleeper = Number(row.pts_ppr);
    const xfp = Number(usage.xfp);
    const adineu = horizon >= DIRECT_PROJECTION_WEEKS ? (1 - weight) * sleeper + weight * xfp : sleeper;
    const actual = actualById.get(row.sleeper_player_id);
    const errors = { sleeper: Math.abs(sleeper - actual), usage: Math.abs(xfp - actual), adineu: Math.abs(adineu - actual) };
    add(`${horizon}|ALL`, errors);
    add(`${horizon}|${usage.position}`, errors);
  }
  return [...groups].map(([key, group]) => {
    const [horizon, position] = key.split("|");
    const mae = name => round(group[name] / group.n);
    return { horizon: Number(horizon), position, n: group.n, sleeperMae: mae("sleeper"), usageMae: mae("usage"), adineuMae: mae("adineu"),
      blendApplies: Number(horizon) >= DIRECT_PROJECTION_WEEKS, adineuBeatsSleeper: mae("adineu") < mae("sleeper") };
  }).sort((a, b) => a.horizon - b.horizon || (a.position === "ALL" ? -1 : b.position === "ALL" ? 1 : a.position.localeCompare(b.position)));
}

/** Signals issued at earlier snapshots: points per game since, vs the ppg they had when flagged. */
export function signalOutcomes(usageRows = [], pointsByPlayerWeek = new Map(), evaluatedWeek) {
  const groups = { BUY_LOW: [], SELL_HIGH: [] };
  for (const row of usageRows) {
    if (!groups[row.signal]) continue;
    const since = [];
    for (let week = row.snapshot_week; week <= evaluatedWeek; week++) {
      const points = pointsByPlayerWeek.get(`${row.sleeper_player_id}|${week}`);
      if (Number.isFinite(points)) since.push(points);
    }
    if (since.length) groups[row.signal].push(mean(since) - Number(row.ppg));
  }
  return Object.fromEntries(Object.entries(groups).map(([signal, changes]) => [signal, {
    n: changes.length,
    changeVsFlagged: round(mean(changes)),
    improvedRate: changes.length ? round(changes.filter(change => change > 0).length / changes.length, 3) : null
  }]));
}

const INVALID_BID_NOTE = /roster will have too many players|already started playing/i;

/** Every bid that competed in a leg, won or lost (a full roster or a locked drop never competed). */
export function competingBids(transactions = []) {
  const best = new Map();
  for (const row of Array.isArray(transactions) ? transactions : []) {
    if (row.type !== "waiver" || !["complete", "failed"].includes(row.status) || INVALID_BID_NOTE.test(row.metadata?.notes || "")) continue;
    const bid = Number(row.settings?.waiver_bid);
    if (!Number.isFinite(bid)) continue;
    for (const [playerId, rosterId] of Object.entries(row.adds || {})) {
      const key = `${playerId}|${rosterId}`;
      const previous = best.get(key);
      best.set(key, { playerId, rosterId, bid: Math.max(bid, previous?.bid ?? -1), won: Boolean(previous?.won) || row.status === "complete" });
    }
  }
  return [...best.values()];
}

/**
 * Out-of-sample check of the auction model on one leg: each real bid scored with the inputs the
 * Tuesday snapshot archived (rival needs, features) and the model it used, the bidder removed
 * from its own rivals. Bids on players absent from the snapshot are counted, not scored.
 */
export function scoreAuctionLeg(bids = [], marketById = new Map(), { model = null, rosterBudgets = {}, baseRate = null } = {}) {
  if (!model) return { bids: bids.length, scored: 0, reason: "NO_ARCHIVED_MODEL" };
  const needIndex = AUCTION_FEATURES.indexOf("rivalNeedShare");
  const samples = [];
  for (const bid of bids) {
    const inputs = marketById.get(bid.playerId)?.events?.auction;
    if (!inputs?.features || !inputs.rivalNeeds) continue;
    const rivals = Object.entries(inputs.rivalNeeds).filter(([rosterId]) => String(rosterId) !== String(bid.rosterId));
    const x = AUCTION_FEATURES.map(name => inputs.features[name] ?? 0);
    x[needIndex] = rivals.length ? rivals.filter(([, need]) => need > RIVAL_NEED_POINTS).length / rivals.length : 0;
    const others = bids.filter(other => other.playerId === bid.playerId && String(other.rosterId) !== String(bid.rosterId)).map(other => other.bid);
    const budgets = Object.entries(rosterBudgets).filter(([rosterId]) => String(rosterId) !== String(bid.rosterId)).map(([, budget]) => budget);
    const someoneWon = bids.some(other => other.playerId === bid.playerId && other.won);
    samples.push({ x, bid: bid.bid, won: someoneWon ? bid.won : null, bestRivalBid: others.length ? Math.max(...others) : null, maxRivalBudget: budgets.length ? Math.max(...budgets) : undefined });
  }
  return { ...(scoreAuction(model, samples, { baseRate }) ?? {}), bids: bids.length, scored: samples.length };
}

export function formatFeedbackMessage(report) {
  const lines = [`📈 SUIVI DU MODÈLE — ADINEU (semaine ${report.week} terminée)`, ""];
  const faab = report.faab;
  lines.push(`FAAB (enchères du mercredi suivant le snapshot S${report.week}) : ${faab.claims} gagnée(s), ${faab.covered} couverte(s) par le snapshot.`);
  lines.push(`Couverture FAAB : ${faab.covered}/${faab.claims}${faab.covered ? " — comparaison descriptive des seules enchères couvertes" : " — calibration indisponible"}.`);
  if (!faab.covered && faab.claims) lines.push("À vérifier : IDs joueurs, date et pool du snapshot, fenêtre des transactions. Aucune conclusion sur les montants prédits.");
  if (faab.covered) lines.push(`• Dans la fourchette prédite : ${Math.round(faab.inRangeRate * 100)} %`);
  if (faab.medianImpliedPricePerPoint !== null) lines.push(`• Prix payé par point de surplus (médiane, ${faab.pricedClaims} cas) : ${faab.medianImpliedPricePerPoint} $ (modèle : ${faab.pricePerPoint} $)`);
  const auction = report.faabAuction;
  if (auction?.scored) lines.push(`• Modèle d'enchères (rivaux) : ${auction.scored}/${auction.bids} enchère(s) notée(s) · Brier ${auction.brier} (taux constant ${auction.constantRateBrier}) · meilleure enchère rivale dans la fourchette p25–p75 : ${Math.round((auction.interquartileCoverage ?? 0) * 100)} % (cible 50 %, n=${auction.contested})`);
  else if (auction?.bids) lines.push(`• Modèle d'enchères (rivaux) : aucune des ${auction.bids} enchères notée (${auction.reason || "joueurs absents du snapshot"}).`);
  if (report.projections.length) {
    lines.push("", "Projections Sleeper — MAE (erreur absolue moyenne, pts) selon l'ancienneté :");
    for (const entry of report.projections) lines.push(`• ${entry.horizon} semaine(s) avant : ${entry.mae} pts (n=${entry.n})`);
    lines.push("Horizon 0 ne certifie pas une capture avant kickoff ; ventilation par poste et comparaison sur cohorte identique restent nécessaires.");
  } else {
    lines.push("", "Projections : pas encore de snapshot antérieur à cette semaine.");
  }
  const scorecard = (report.scorecard || []).filter(row => row.position === "ALL");
  if (scorecard.length) {
    lines.push("", "Adineu contre Sleeper (même cohorte, MAE en pts ; Adineu = Sleeper avant " + DIRECT_PROJECTION_WEEKS + " semaines, puis mélange usage) :");
    for (const row of scorecard) lines.push(`• ${row.horizon} sem. avant (n=${row.n}) : Sleeper ${row.sleeperMae} · usage seul ${row.usageMae} · Adineu ${row.adineuMae}${row.blendApplies ? (row.adineuBeatsSleeper ? " ✅" : " ⚠️ le mélange ne bat pas Sleeper") : ""}`);
  }
  for (const [signal, stats] of Object.entries(report.signals)) {
    if (stats.n) lines.push(`${signal === "BUY_LOW" ? "🟢 Buy-low" : "🔥 Sell-high"} : ${stats.n} suivi(s), ${stats.changeVsFlagged > 0 ? "+" : ""}${stats.changeVsFlagged} pt/match depuis, ${Math.round(stats.improvedRate * 100)} % en hausse`);
  }
  if (Object.values(report.signals).some(stats => stats.n)) lines.push("Signaux : suivi descriptif, horizon variable ; pas de preuve d’avantage ni de rentabilité d’un trade. SELL_HIGH n’est pas une consigne de coupe.");
  if (report.algoFeedback.length) {
    lines.push("", "ALGO FEEDBACK :");
    for (const item of report.algoFeedback) lines.push(`• ${item}`);
  }
  if (report.experts) lines.push("", ...formatExpertBenchmark(report.experts));
  return lines.join("\n");
}

export function buildAlgoFeedback({ faab, projections }) {
  const items = [];
  for (const anomaly of faab.anomalies) {
    items.push(`FAAB — ${anomaly.name} : enchère ${anomaly.bid} $ vs prédit ${anomaly.predicted[0]}–${anomaly.predicted[1]} $ (surplus ${anomaly.surplus}). Cause probable : rôle/actualité non captés ou marché de la ligue différent. Règle à revoir : événements NEWS_OVERRIDE ou prix du point.`);
  }
  if (faab.pricedClaims >= 8 && faab.medianImpliedPricePerPoint !== null && Math.abs(faab.medianImpliedPricePerPoint - faab.pricePerPoint) / faab.pricePerPoint > 0.4) {
    items.push(`PRICE_PER_POINT — la ligue paie ${faab.medianImpliedPricePerPoint} $/pt (médiane de ${faab.pricedClaims} enchères) vs ${faab.pricePerPoint} $ dans le modèle : recalibrer.`);
  }
  const near = projections.find(entry => entry.horizon <= 1);
  const far = projections.filter(entry => entry.horizon >= 3 && entry.n >= 30);
  if (near && far.length && mean(far.map(entry => entry.mae)) > near.mae * 1.15) {
    items.push(`FAR_WEEK_USAGE_WEIGHT — les projections à 3+ semaines se trompent ${round(mean(far.map(entry => entry.mae)) / near.mae, 2)}× plus qu'à 1 semaine : envisager plus de poids à l'usage au-delà de ${DIRECT_PROJECTION_WEEKS} semaines.`);
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// I/O: Sleeper -> Supabase
// ---------------------------------------------------------------------------------------------

async function getJson(path, fetchImpl) {
  const response = await fetchImpl(`${SLEEPER}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Sleeper ${path} -> HTTP ${response.status}`);
  return response.json();
}

async function insertChunks(supabase, table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** One waiver-market row of the weekly snapshot. The role profile and its trend are archived in
 * the existing `events` JSON (no schema change) so they can later be compared with real outcomes,
 * WATCH/IGNORE candidates included: that is the dataset the role thresholds are waiting for. */
export function marketSnapshotRow(row, { trendingById = new Map() } = {}) {
  const emerging = row.emergingRole;
  const role = row.roleProfile?.profile ? { roleProfile: row.roleProfile.profile, roleBasis: row.roleProfile.basis ?? [] } : null;
  const trend = emerging?.comparable ? { progression: emerging.progression, progressionSource: emerging.progressionSource ?? null,
    xfpDelta: emerging.xfpDelta ?? null, opportunitiesDelta: emerging.opportunitiesDelta ?? null, weeksCompared: emerging.weeksCompared } : null;
  const flags = row.waiver.flags?.length ? { flags: row.waiver.flags, reasons: row.waiver.reasons, duration: row.waiver.duration } : null;
  // Auction inputs (features, each roster's need) and Sleeper's 48 h trending adds: the bids of the
  // next run are scored against them, and trending cannot be rebuilt after the fact.
  const auction = row.waiver.auctionInputs ? { auction: row.waiver.auctionInputs } : null;
  const trending = trendingById.has(String(row.sleeperId)) ? { trendingAdds48h: trendingById.get(String(row.sleeperId)) } : null;
  return {
    sleeper_player_id: row.sleeperId, name: row.name, position: row.position, nfl_team: row.nflTeam,
    category: row.waiver.category, market_score: row.waiver.score, faab_low: row.waiver.faabMarket?.[0] ?? null, faab_high: row.waiver.faabMarket?.[1] ?? null,
    surplus_points: row.surplusPoints, effective_ppg: row.effectivePpg, ros_ppg: row.rosPpg,
    news_override: Boolean(row.waiver.newsOverride),
    events: flags || role || trend || auction || trending ? { ...(flags ?? {}), ...(role ?? {}), ...(trend ?? {}), ...(auction ?? {}), ...(trending ?? {}) } : null
  };
}

export async function takeSnapshot({ supabase, fetchImpl = fetch, season, week, dryRun = false, force = false }) {
  // First write wins: the snapshot must describe the market BEFORE Wednesday's waivers. A re-run
  // later in the week (manual test, retry) would replace it with a post-waiver state where the
  // claimed players are no longer free agents, which silently breaks the FAAB calibration.
  if (!dryRun && !force) {
    const { data: existing } = await supabase.from("model_snapshots").select("id, taken_at").eq("season", season).eq("week", week).eq("kind", "weekly").maybeSingle();
    if (existing) return { season, week, skipped: "exists", snapshotId: existing.id, takenAt: existing.taken_at };
  }
  const [market, usage] = await Promise.all([
    getFreeAgents({ limitPerPosition: 40, fetchImpl }),
    getUsageReport({ fetchImpl })
  ]);
  const trendingById = new Map((market.trending || []).map(row => [String(row.playerId), row.adds]));
  const marketRows = Object.values(market.byPosition).flat().map(row => marketSnapshotRow(row, { trendingById }));
  const calibration = await loadAuctionCalibration();
  const rosters = await getJson(`/league/${LEAGUE_ID}/rosters`, fetchImpl).catch(() => []);
  const rosterBudgets = Object.fromEntries(rosters.map(roster => [roster.roster_id, GENERAL_SETTINGS_2026.waiver.budget - Number(roster.settings?.waiver_budget_used || 0)]));
  const projectionRows = [];
  for (let target = week; target <= LAST_REGULAR_WEEK; target++) {
    const projections = await getWeeklyProjections({ week: target, season: String(season), fetchImpl }).catch(() => ({}));
    for (const [playerId, stats] of Object.entries(projections || {})) {
      if (Number.isFinite(stats?.pts_ppr) && stats.pts_ppr >= 1) projectionRows.push({ sleeper_player_id: playerId, target_week: target, pts_ppr: Number(stats.pts_ppr.toFixed(2)) });
    }
  }
  const usageRows = usage.players.map(player => ({ sleeper_player_id: player.playerId, position: player.position, usage_score: player.usageScore, xfp: player.xfp, ppg: player.ppg, signal: player.signal }));
  const summary = { season, week, market: marketRows.length, projections: projectionRows.length, usage: usageRows.length, degraded: Boolean(market.degraded || usage.degraded) };
  if (dryRun) return summary;

  const { data: snapshot, error } = await supabase.from("model_snapshots").upsert({
    season, week, kind: "weekly", taken_at: new Date().toISOString(), model_version: MODEL_VERSION,
    settings: { PRICE_PER_POINT, FAR_WEEK_USAGE_WEIGHT, FAR_WEEK_USAGE_WEIGHT_BY_POSITION, DIRECT_PROJECTION_WEEKS, rosterBudgets,
      faabAuction: calibration ? { model: calibration.model, generatedAt: calibration.generatedAt, baseRate: calibration.sample?.bids ? calibration.sample.won / calibration.sample.bids : null } : null },
    coverage: { ...market.coverage, usageWeeks: usage.weeks, degraded: summary.degraded }
  }, { onConflict: "season,week,kind" }).select("id").single();
  if (error) throw new Error(`model_snapshots: ${error.message}`);
  for (const table of ["waiver_market_snapshots", "player_projection_snapshots", "player_usage_snapshots"]) {
    const { error: deleteError } = await supabase.from(table).delete().eq("snapshot_id", snapshot.id);
    if (deleteError) throw new Error(`${table}: ${deleteError.message}`);
  }
  const withId = rows => rows.map(row => ({ snapshot_id: snapshot.id, ...row }));
  await insertChunks(supabase, "waiver_market_snapshots", withId(marketRows));
  await insertChunks(supabase, "player_projection_snapshots", withId(projectionRows));
  await insertChunks(supabase, "player_usage_snapshots", withId(usageRows));
  return { ...summary, snapshotId: snapshot.id };
}

/**
 * Sleeper files the Wednesday waivers that follow week L's games under transactions leg L, while
 * the snapshot taken the Tuesday just before them is labelled with the operational week L + 1.
 * So the bids to compare with the snapshot of the evaluated week E are those of leg E - 1.
 */
export const faabLegForSnapshotWeek = week => week - 1;

export async function buildWeeklyFeedback({ supabase, fetchImpl = fetch, season, week, dryRun = false, scoreExpertBenchmark = scoreExperts }) {
  // 1. FAAB outcomes of the waivers that ran right after this week's snapshot (leg week - 1).
  const leg = faabLegForSnapshotWeek(week);
  const transactions = leg >= 1 ? await getJson(`/league/${LEAGUE_ID}/transactions/${leg}`, fetchImpl).catch(() => []) : [];
  const outcomes = (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction.type === "waiver" && transaction.status === "complete" && Number.isFinite(Number(transaction.settings?.waiver_bid)))
    .flatMap(transaction => Object.entries(transaction.adds || {}).map(([playerId, rosterId]) => ({
      season, week: leg, transaction_id: String(transaction.transaction_id), sleeper_player_id: playerId, roster_id: rosterId,
      bid: Number(transaction.settings.waiver_bid), processed_at: transaction.status_updated ? new Date(transaction.status_updated).toISOString() : null
    })));
  if (!dryRun && outcomes.length) {
    const { error } = await supabase.from("faab_outcomes").upsert(outcomes, { onConflict: "transaction_id,sleeper_player_id" });
    if (error) throw new Error(`faab_outcomes: ${error.message}`);
  }

  // 2. Snapshots up to (and including) the evaluated week.
  const { data: snapshots, error: snapshotError } = supabase
    ? await supabase.from("model_snapshots").select("id, week, settings").eq("season", season).eq("kind", "weekly").lte("week", week)
    : { data: [], error: null }; // --dry-run without Supabase: no history to compare against
  if (snapshotError) throw new Error(`model_snapshots: ${snapshotError.message}`);
  const weekBySnapshot = new Map((snapshots || []).map(snapshot => [snapshot.id, snapshot.week]));
  const sameWeek = (snapshots || []).find(snapshot => snapshot.week === week);
  let marketById = new Map();
  if (sameWeek) {
    const { data } = await supabase.from("waiver_market_snapshots").select("*").eq("snapshot_id", sameWeek.id);
    marketById = new Map((data || []).map(row => [row.sleeper_player_id, row]));
  }
  const faab = summarizeFaabCalibration(outcomes, marketById);
  const faabAuction = scoreAuctionLeg(competingBids(transactions), marketById, { model: sameWeek?.settings?.faabAuction?.model ?? null,
    rosterBudgets: sameWeek?.settings?.rosterBudgets ?? {}, baseRate: sameWeek?.settings?.faabAuction?.baseRate ?? null });

  // 3. Projection accuracy for the completed week, by projection age.
  const stats = await getWeeklyStats({ week, season: String(season), fetchImpl }).catch(() => ({}));
  const actualById = new Map(Object.entries(stats || {}).filter(([, row]) => row?.off_snp > 0 || Number.isFinite(row?.pts_ppr)).map(([id, row]) => [id, Number(row.pts_ppr) || 0]));
  let projectionRows = [];
  if (snapshots?.length) {
    const { data } = await supabase.from("player_projection_snapshots").select("snapshot_id, sleeper_player_id, target_week, pts_ppr").in("snapshot_id", snapshots.map(snapshot => snapshot.id)).eq("target_week", week).limit(20000);
    projectionRows = (data || []).map(row => ({ ...row, snapshot_week: weekBySnapshot.get(row.snapshot_id) }));
  }
  const projections = projectionAccuracyByHorizon(projectionRows, actualById, week);
  const usageBySnapshotWeek = new Map();
  if (snapshots?.length) {
    const { data } = await supabase.from("player_usage_snapshots").select("snapshot_id, sleeper_player_id, position, xfp").in("snapshot_id", snapshots.map(snapshot => snapshot.id)).limit(20000);
    for (const row of data || []) {
      const snapshotWeek = weekBySnapshot.get(row.snapshot_id);
      if (!usageBySnapshotWeek.has(snapshotWeek)) usageBySnapshotWeek.set(snapshotWeek, new Map());
      usageBySnapshotWeek.get(snapshotWeek).set(row.sleeper_player_id, row);
    }
  }
  const scorecard = projectionScorecard(projectionRows, usageBySnapshotWeek, actualById, week);

  // 4. Signals issued at earlier snapshots, followed through the evaluated week.
  let signals = { BUY_LOW: { n: 0 }, SELL_HIGH: { n: 0 } };
  const earlier = (snapshots || []).filter(snapshot => snapshot.week <= week);
  if (earlier.length) {
    const { data } = await supabase.from("player_usage_snapshots").select("snapshot_id, sleeper_player_id, ppg, signal").in("snapshot_id", earlier.map(snapshot => snapshot.id)).not("signal", "is", null);
    const pointsByPlayerWeek = new Map();
    for (const snapshot of earlier) {
      for (let w = snapshot.week; w <= week; w++) {
        if (pointsByPlayerWeek.has(`__week${w}`)) continue;
        const weekStats = w === week ? stats : await getWeeklyStats({ week: w, season: String(season), fetchImpl }).catch(() => ({}));
        for (const [id, row] of Object.entries(weekStats || {})) if (row?.off_snp > 0) pointsByPlayerWeek.set(`${id}|${w}`, Number(row.pts_ppr) || 0);
        pointsByPlayerWeek.set(`__week${w}`, true);
      }
    }
    signals = signalOutcomes((data || []).map(row => ({ ...row, snapshot_week: weekBySnapshot.get(row.snapshot_id) })), pointsByPlayerWeek, week);
  }

  const experts = await scoreExpertBenchmark({ season, week, supabase, fetchImpl }).catch(() => ({ status: "SCORING_FAILED" }));
  const report = { experts, season, week, faabLeg: leg, generatedAt: new Date().toISOString(), modelVersion: MODEL_VERSION, faab, faabAuction, projections, scorecard, signals };
  report.algoFeedback = buildAlgoFeedback(report);
  const message = formatFeedbackMessage(report);
  if (!dryRun) {
    const { error } = await supabase.from("model_feedback").upsert({ season, week, generated_at: report.generatedAt, report, message }, { onConflict: "season,week" });
    if (error) throw new Error(`model_feedback: ${error.message}`);
  }
  return { report, message };
}

/** Loaded on demand: the web server keeps booting even if the Supabase client isn't installed. */
export async function createSupabaseFromEnv(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL et SUPABASE_SECRET_KEY sont requis pour le suivi du modèle.");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Public project URL and publishable key (already shipped in the site's JS): reads never depend
// on server secrets. Row-level security allows select only.
const PUBLIC_SUPABASE_URL = "https://juosrzsffvjprqhdyado.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_7Bu9q2dKz0WEol94OGVhHw_xjSwHeHu";

/** Latest weekly feedback (public read). */
export async function getLatestFeedback(env = process.env) {
  const url = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("model_feedback").select("season, week, generated_at, report, message").order("season", { ascending: false }).order("week", { ascending: false }).limit(1);
  if (error) throw new Error(`model_feedback: ${error.message}`);
  return data?.[0] || null;
}

/** Decision journal of the operator's team (COACH_TEAM, default t0z): the Tuesday plan is
 * recorded before the waivers (first write wins), then the season's moves are re-synced. */
export async function recordDecisionJournal({ supabase, fetchImpl = fetch, week, team = process.env.COACH_TEAM || "t0z" }) {
  const { createDecisionLogStore, recommendationsFromReport, syncDecisionLog } = await import("./decision-log.js");
  const store = createDecisionLogStore({ getSupabase: async () => supabase });
  const report = await getFreeAgents({ team, limitPerPosition: 15, fetchImpl });
  const rosterId = report.rosterId ?? (await getJson(`/league/${LEAGUE_ID}/rosters`, fetchImpl).then(async rosters => {
    const { findRosterByTeam } = await import("../public/assets/roster-view.js");
    return findRosterByTeam(rosters, await getJson(`/league/${LEAGUE_ID}/users`, fetchImpl), team).roster.roster_id;
  }));
  const plan = await store.recordPlan(rosterId, week, recommendationsFromReport(report, "WEEKLY_JOB"));
  const sync = await syncDecisionLog({ team, fetchImpl, store });
  return { plan, written: sync.written, summary: sync.summary };
}

/** Tuesday job: feedback on the completed week, then snapshot of the current week. */
export async function runWeeklyJob({ supabase, fetchImpl = fetch, dryRun = false, force = false } = {}) {
  const state = await getJson("/state/nfl", fetchImpl);
  const season = Number(state.season);
  const week = resolveOperationalWeek(state);
  const sos = season === 2026 && ["regular", "post"].includes(state.season_type)
    ? await trackSos({ dryRun, service: fetchImpl === fetch ? sosService : createSosService({ load: () => loadSosSources({ fetchImpl }) }),
      ...(supabase ? { store: createSupabaseSosStore({ getSupabase: async () => supabase }) } : {}) }).catch(() => ({ error: "SOS_TRACKING_UNAVAILABLE" })) : { skipped: "hors saison SOS 2026" };
  if (state.season_type !== "regular" || week > LAST_REGULAR_WEEK) return { skipped: `hors saison régulière (${state.season_type}, semaine ${week})`, sos };
  // Recalibrate on every bid through last Wednesday before the snapshot and the plan use it.
  const auction = await calibrateFaab({ fetchImpl }).then(async calibration => {
    if (!dryRun) { await saveCalibration(supabase, calibration); primeAuctionCalibration(calibration); }
    return { line: formatCalibrationLine(calibration), sample: calibration.sample, validation: calibration.validation };
  }).catch(error => ({ error: error.message, line: `Enchères FAAB : recalibration échouée (${error.message}), calibration précédente conservée.` }));
  const feedback = week > 1 ? await buildWeeklyFeedback({ supabase, fetchImpl, season, week: week - 1, dryRun }) : null;
  const snapshot = await takeSnapshot({ supabase, fetchImpl, season, week, dryRun, force });
  const journal = dryRun ? null : await recordDecisionJournal({ supabase, fetchImpl, week }).catch(error => ({ error: error.message }));
  const message = feedback?.message ? `${feedback.message}\n\n${auction.line}` : auction.line;
  return { season, week, auction, snapshot, journal, sos, feedback: feedback?.report || null, message };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force-snapshot");
  const supabase = dryRun ? null : await createSupabaseFromEnv();
  const result = await runWeeklyJob({ supabase, dryRun, force });
  console.log(result.message || JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ snapshot: result.snapshot, skipped: result.skipped }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("Erreur :", error.message); process.exitCode = 1; });
}
