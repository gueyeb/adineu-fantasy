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
import { pathToFileURL } from "node:url";
import { getFreeAgents, getUsageReport, getWeeklyProjections, getWeeklyStats } from "./league-context.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { GENERAL_SETTINGS_2026 } from "../public/assets/league-settings.js";
import { PRICE_PER_POINT } from "../public/assets/waiver-model.js";
import { DIRECT_PROJECTION_WEEKS, FAR_WEEK_USAGE_WEIGHT } from "../public/assets/rest-of-season.js";

export const MODEL_VERSION = "waiver-v2 · usage-0.2 · 2026-09-29";
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
    const surplus = market ? Number(market.surplus_points) : null;
    return {
      playerId: outcome.sleeper_player_id,
      name: market?.name || outcome.name || outcome.sleeper_player_id,
      bid: outcome.bid,
      predicted: market ? [market.faab_low, market.faab_high] : null,
      surplus,
      inRange: market ? outcome.bid >= market.faab_low && outcome.bid <= market.faab_high : null,
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

export function formatFeedbackMessage(report) {
  const lines = [`📈 SUIVI DU MODÈLE — ADINEU (semaine ${report.week} terminée)`, ""];
  const faab = report.faab;
  lines.push(`FAAB : ${faab.claims} enchère(s) gagnée(s), ${faab.covered} couverte(s) par un snapshot.`);
  if (faab.covered) lines.push(`• Dans la fourchette prédite : ${Math.round(faab.inRangeRate * 100)} %`);
  if (faab.medianImpliedPricePerPoint !== null) lines.push(`• Prix payé par point de surplus (médiane, ${faab.pricedClaims} cas) : ${faab.medianImpliedPricePerPoint} $ (modèle : ${faab.pricePerPoint} $)`);
  if (report.projections.length) {
    lines.push("", "Projections Sleeper (erreur moyenne selon l'ancienneté) :");
    for (const entry of report.projections) lines.push(`• ${entry.horizon} semaine(s) avant : ${entry.mae} pts (n=${entry.n})`);
  } else {
    lines.push("", "Projections : pas encore de snapshot antérieur à cette semaine.");
  }
  for (const [signal, stats] of Object.entries(report.signals)) {
    if (stats.n) lines.push(`${signal === "BUY_LOW" ? "🟢 Buy-low" : "🔥 Sell-high"} : ${stats.n} suivi(s), ${stats.changeVsFlagged > 0 ? "+" : ""}${stats.changeVsFlagged} pt/match depuis, ${Math.round(stats.improvedRate * 100)} % en hausse`);
  }
  if (report.algoFeedback.length) {
    lines.push("", "ALGO FEEDBACK :");
    for (const item of report.algoFeedback) lines.push(`• ${item}`);
  }
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

export async function takeSnapshot({ supabase, fetchImpl = fetch, season, week, dryRun = false }) {
  const [market, usage] = await Promise.all([
    getFreeAgents({ limitPerPosition: 40, fetchImpl }),
    getUsageReport({ fetchImpl })
  ]);
  const marketRows = Object.values(market.byPosition).flat().map(row => ({
    sleeper_player_id: row.sleeperId, name: row.name, position: row.position, nfl_team: row.nflTeam,
    category: row.waiver.category, market_score: row.waiver.score, faab_low: row.waiver.faabMarket[0], faab_high: row.waiver.faabMarket[1],
    surplus_points: row.surplusPoints, effective_ppg: row.effectivePpg, ros_ppg: row.rosPpg,
    news_override: Boolean(row.waiver.newsOverride), events: row.waiver.flags?.length ? { flags: row.waiver.flags, reasons: row.waiver.reasons, duration: row.waiver.duration } : null
  }));
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
    settings: { PRICE_PER_POINT, FAR_WEEK_USAGE_WEIGHT, DIRECT_PROJECTION_WEEKS },
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

export async function buildWeeklyFeedback({ supabase, fetchImpl = fetch, season, week, dryRun = false }) {
  // 1. FAAB outcomes of the waivers processed during `week` (transactions leg = week).
  const transactions = await getJson(`/league/${LEAGUE_ID}/transactions/${week}`, fetchImpl).catch(() => []);
  const outcomes = (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction.type === "waiver" && transaction.status === "complete" && Number.isFinite(Number(transaction.settings?.waiver_bid)))
    .flatMap(transaction => Object.entries(transaction.adds || {}).map(([playerId, rosterId]) => ({
      season, week, transaction_id: String(transaction.transaction_id), sleeper_player_id: playerId, roster_id: rosterId,
      bid: Number(transaction.settings.waiver_bid), processed_at: transaction.status_updated ? new Date(transaction.status_updated).toISOString() : null
    })));
  if (!dryRun && outcomes.length) {
    const { error } = await supabase.from("faab_outcomes").upsert(outcomes, { onConflict: "transaction_id,sleeper_player_id" });
    if (error) throw new Error(`faab_outcomes: ${error.message}`);
  }

  // 2. Snapshots up to (and including) the evaluated week.
  const { data: snapshots, error: snapshotError } = supabase
    ? await supabase.from("model_snapshots").select("id, week").eq("season", season).eq("kind", "weekly").lte("week", week)
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

  // 3. Projection accuracy for the completed week, by projection age.
  const stats = await getWeeklyStats({ week, season: String(season), fetchImpl }).catch(() => ({}));
  const actualById = new Map(Object.entries(stats || {}).filter(([, row]) => row?.off_snp > 0 || Number.isFinite(row?.pts_ppr)).map(([id, row]) => [id, Number(row.pts_ppr) || 0]));
  let projectionRows = [];
  if (snapshots?.length) {
    const { data } = await supabase.from("player_projection_snapshots").select("snapshot_id, sleeper_player_id, target_week, pts_ppr").in("snapshot_id", snapshots.map(snapshot => snapshot.id)).eq("target_week", week).limit(20000);
    projectionRows = (data || []).map(row => ({ ...row, snapshot_week: weekBySnapshot.get(row.snapshot_id) }));
  }
  const projections = projectionAccuracyByHorizon(projectionRows, actualById, week);

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

  const report = { season, week, generatedAt: new Date().toISOString(), modelVersion: MODEL_VERSION, faab, projections, signals };
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

/** Latest weekly feedback (public read: the publishable key is enough). */
export async function getLatestFeedback(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL et une clé Supabase sont requis pour lire le suivi du modèle.");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("model_feedback").select("season, week, generated_at, report, message").order("season", { ascending: false }).order("week", { ascending: false }).limit(1);
  if (error) throw new Error(`model_feedback: ${error.message}`);
  return data?.[0] || null;
}

/** Tuesday job: feedback on the completed week, then snapshot of the current week. */
export async function runWeeklyJob({ supabase, fetchImpl = fetch, dryRun = false } = {}) {
  const state = await getJson("/state/nfl", fetchImpl);
  const season = Number(state.season);
  const week = resolveOperationalWeek(state);
  if (state.season_type !== "regular" || week > LAST_REGULAR_WEEK) return { skipped: `hors saison régulière (${state.season_type}, semaine ${week})` };
  const feedback = week > 1 ? await buildWeeklyFeedback({ supabase, fetchImpl, season, week: week - 1, dryRun }) : null;
  const snapshot = await takeSnapshot({ supabase, fetchImpl, season, week, dryRun });
  return { season, week, snapshot, feedback: feedback?.report || null, message: feedback?.message || null };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = dryRun ? null : await createSupabaseFromEnv();
  const result = await runWeeklyJob({ supabase, dryRun });
  console.log(result.message || JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ snapshot: result.snapshot, skipped: result.skipped }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("Erreur :", error.message); process.exitCode = 1; });
}
