#!/usr/bin/env node
/**
 * Adineu Fantasy — journal des décisions réelles (docs/prd-model-challenge.md, chantier 5).
 *
 * Rebuilds the team's moves from Sleeper (claims won/lost, free adds, cuts, trades, lineups),
 * evaluates them over a fixed window and upserts them into Supabase `decision_log` (private:
 * RLS on, no policy). The operator's reason is never overwritten by a sync. The model's view of
 * a move comes from the recommendations recorded for that week: the Tuesday plan (MODEL_PLAN
 * rows written by the weekly job) and, for the backfill, the local decision snapshots.
 *
 * CLI: npm run decisions:sync[:production] -- [--team=t0z] [--dry-run]
 */
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { GENERAL_SETTINGS_2026, LEAGUE_METADATA_2026, ROSTER_SETTINGS_2026 } from "../public/assets/league-settings.js";
import { findRosterByTeam } from "../public/assets/roster-view.js";
import { resolveLastCompletedWeek, resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { leaguePoints } from "../public/assets/weekly-leaders.js";
import { computeOptimalLineupPoints } from "../public/assets/weekly-recap.js";
import { applyPlanChoice, attachModelView, buildLineupEntries, buildMoveEntries, currentCounterfactuals, cutEntry, decisionWeekOf, declinedCuts, evaluateDeclinedCut, evaluateMove, evaluateSkippedRecommendation, evaluateTradeOption, formatCounterfactualLine, lastKickoffByWeek, normalizePlanChoice, normalizeReason, planChoiceRows, postWaiverReview, skippedEntry, skippedRecommendations, skippedTradeOptions, SKIPPED_KIND, summarizeCounterfactuals, summarizeDecisionLog, tradeEntry, winningClaims } from "../public/assets/decision-log.js";
import { createSupabaseFromEnv } from "./model-tracking.js";
import { getPlayersIndex, getSchedule } from "./league-context.js";

const SLEEPER = "https://api.sleeper.app/v1";
const TABLE = "decision_log";
const SNAPSHOT_DIR = new URL("../output/decision-snapshots/", import.meta.url);

async function getJson(path, fetchImpl) {
  const response = await fetchImpl(`${SLEEPER}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Sleeper ${path} -> HTTP ${response.status}`);
  return response.json();
}

/** Recommendations of one report (live plan or archived snapshot), in the journal's shape. */
export function recommendationsFromReport(report, source) {
  const rows = Object.values(report?.byPosition || {}).flat();
  const planned = new Map((report?.acquisitionPlan?.steps || []).map(step => [String(step.playerId), step]));
  return rows.filter(row => row.waiver?.decision?.recommendedAction).map(row => {
    // The cut is the plan step's when planned, else the row's own fit; it lets the counterfactual remove him.
    const cut = planned.get(String(row.sleeperId))?.dropCandidate ?? row.waiver.fit?.dropCandidate ?? null;
    return { playerId: String(row.sleeperId), name: row.name, position: row.position ?? null, action: row.waiver.decision.recommendedAction,
      suggestedBid: planned.get(String(row.sleeperId))?.suggestedBid ?? row.waiver.suggestedBid ?? null, inPlan: planned.has(String(row.sleeperId)),
      cutPlayerId: cut?.sleeperId ? String(cut.sleeperId) : null, cutName: cut?.name ?? null, source };
  });
}

/** Local decision snapshots of this team, by target week (the first one of a week wins). */
export async function loadSnapshotRecommendations(team, { directory = SNAPSHOT_DIR } = {}) {
  const byWeek = {};
  let files = [];
  try { files = (await readdir(directory)).filter(name => name.endsWith(".json")).sort(); } catch { return byWeek; }
  for (const name of files) {
    try {
      const snapshot = JSON.parse(await readFile(new URL(name, directory), "utf8"));
      const report = snapshot.report;
      const snapshotTeam = snapshot.inputs?.team ?? report?.decisionScope?.roster ?? null;
      if (!report?.week || (snapshotTeam && snapshotTeam !== team) || byWeek[report.week]) continue;
      byWeek[report.week] = recommendationsFromReport(report, `LOCAL_SNAPSHOT:${name}`);
    } catch {}
  }
  return byWeek;
}

/**
 * Pure assembly, testable without network: every move and lineup of the roster, evaluated and
 * compared with the recorded recommendations.
 */
export function assembleDecisionLog({ transactions, matchupsByWeek, statsByWeek, scoring, schedule, rosterId, season, lastCompletedWeek, playerOf, recommendationsByWeek = {}, tradeOptionsByWeek = {} }) {
  const kickoffs = lastKickoffByWeek(schedule);
  const weekOf = timestamp => decisionWeekOf(timestamp, kickoffs);
  const pointsOf = (id, week) => {
    const row = statsByWeek[week]?.[id];
    return row ? leaguePoints(row, scoring) : null;
  };
  const startedOf = (id, week) => {
    const mine = (matchupsByWeek[week] || []).find(row => row.roster_id === rosterId);
    return mine && (mine.starters || []).includes(id) ? Number(mine.players_points?.[id] ?? 0) : 0;
  };
  const winners = winningClaims(transactions);
  const moves = buildMoveEntries({ transactions, rosterId, season, weekOf, playerOf }).map(entry => {
    const evaluated = { ...entry, outcome: evaluateMove(entry, { pointsOf, startedOf, lastCompletedWeek }) };
    if (entry.kind !== "CLAIM_LOST") return evaluated;
    const leg = transactions.find(row => `${season}:${rosterId}:${row.transaction_id}` === entry.id)?.leg;
    const winner = entry.added[0] ? winners.get(`${leg}|${entry.added[0].id}`) : null;
    return { ...evaluated, lostTo: winner ? { rosterId: winner.rosterId, bid: winner.bid } : null };
  });
  const optimalOf = (playerIds, playersPoints) => computeOptimalLineupPoints({ playerIds, playersPoints, playerCatalog: new Map(playerIds.map(id => [id, playerOf(id)])), rosterSettings: ROSTER_SETTINGS_2026 });
  const lineups = buildLineupEntries({ matchupsByWeek, rosterId, season, lastCompletedWeek, optimalOf: row => optimalOf(row.players || [], row.players_points || {}) });
  const entries = [...moves, ...lineups].map(entry => attachModelView(entry, recommendationsByWeek));
  const skipped = skippedRecommendations(moves, recommendationsByWeek);
  const context = { transactions, matchupsByWeek, statsByWeek, rosterId, season, lastCompletedWeek, playerOf, weekOf, pointsOf, optimalOf };
  return { entries, skipped, counterfactuals: [...evaluateSkipped(skipped, context), ...evaluateDeclined(moves, recommendationsByWeek, tradeOptionsByWeek, context)],
    summary: summarizeDecisionLog(entries) };
}

/** The team's own Sleeper matchup roster of a week, and stats that did not load as unavailable (null), never zero. */
const counterfactualSources = ({ matchupsByWeek, statsByWeek, rosterId, pointsOf }) => ({
  rosterOf: week => {
    const mine = (matchupsByWeek[week] || []).find(row => row.roster_id === rosterId);
    return mine ? { playerIds: (mine.players || []).map(String), playersPoints: mine.players_points || {} } : null;
  },
  loadedPointsOf: (id, week) => Object.keys(statsByWeek[week] || {}).length > 0 ? pointsOf(id, week) ?? 0 : null
});

/** Plan cuts the team kept and Coach trade options not executed (Adineu estimates). */
function evaluateDeclined(moves, recommendationsByWeek, tradeOptionsByWeek, context) {
  const { season, rosterId, lastCompletedWeek, playerOf, optimalOf } = context;
  const { rosterOf, loadedPointsOf } = counterfactualSources(context);
  const options = { rosterOf, pointsOf: loadedPointsOf, optimalOf, lastCompletedWeek };
  const cuts = declinedCuts(moves, recommendationsByWeek).map(row => {
    const filled = { ...row, name: row.name ?? playerOf(row.playerId)?.name ?? null };
    return cutEntry(filled, evaluateDeclinedCut(filled, options), { season, rosterId });
  });
  const trades = skippedTradeOptions(moves, tradeOptionsByWeek).map(row => tradeEntry(row, evaluateTradeOption(row, options), { season, rosterId }));
  return [...cuts, ...trades];
}

/**
 * Counterfactual of each recommendation not placed (Adineu estimate). The roster is the team's own
 * Sleeper matchup row of each week; a week whose stats did not load is unavailable, not zero.
 */
function evaluateSkipped(skipped, context) {
  const { transactions, rosterId, season, lastCompletedWeek, playerOf, weekOf, optimalOf } = context;
  const { rosterOf, loadedPointsOf } = counterfactualSources(context);
  const takenByOf = (week, playerId) => {
    const row = transactions.find(item => item.status === "complete" && ["waiver", "free_agent"].includes(item.type)
      && Object.entries(item.adds || {}).some(([id, owner]) => id === playerId && owner !== rosterId) && weekOf(Number(item.status_updated ?? item.created)) === week);
    return row ? { rosterId: row.adds[playerId], type: row.type, bid: row.type === "waiver" ? Number(row.settings?.waiver_bid ?? 0) : null } : null;
  };
  return skipped.map(row => {
    const filled = { ...row, position: row.position ?? playerOf(row.playerId)?.position ?? null, cutName: row.cutName ?? (row.cutPlayerId ? playerOf(row.cutPlayerId)?.name ?? null : null) };
    const outcome = evaluateSkippedRecommendation(filled, { rosterOf, optimalOf, lastCompletedWeek, takenBy: takenByOf(row.week, row.playerId), pointsOf: loadedPointsOf });
    return skippedEntry(filled, outcome, { season, rosterId });
  });
}

const toRow = entry => ({ id: entry.id, season: Number(entry.season), roster_id: entry.rosterId, week: entry.week, kind: entry.kind, occurred_at: entry.occurredAt,
  details: { added: entry.added, dropped: entry.dropped, bid: entry.bid, note: entry.note, lostTo: entry.lostTo ?? null },
  outcome: entry.outcome ?? null, model: entry.model ?? null, source: "SLEEPER_SYNC", updated_at: new Date().toISOString() });
const fromRow = row => ({ id: row.id, season: row.season, rosterId: row.roster_id, week: row.week, kind: row.kind, occurredAt: row.occurred_at,
  added: row.details?.added ?? [], dropped: row.details?.dropped ?? [], bid: row.details?.bid ?? null, note: row.details?.note ?? null, lostTo: row.details?.lostTo ?? null,
  recommendations: row.details?.recommendations ?? null, choices: row.details?.choices ?? null, outcome: row.outcome, model: row.model, reason: row.reason ?? null, reasonAt: row.reason_at ?? null });
/** Not journal entries: the Tuesday plan, the last Coach state used for change-only bulletins and the counterfactuals. */
const NON_ENTRY_KINDS = ["MODEL_PLAN", "COACH_STATE", SKIPPED_KIND];

export function createDecisionLogStore({ getSupabase = createSupabaseFromEnv, season = LEAGUE_METADATA_2026.season } = {}) {
  let client = null;
  const supabase = async () => (client ||= await getSupabase());
  return {
    async list(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("*").eq("season", Number(season)).eq("roster_id", rosterId).order("week", { ascending: false }).order("occurred_at", { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data || []).map(fromRow);
      const entries = rows.filter(row => !NON_ENTRY_KINDS.includes(row.kind));
      const plans = rows.filter(row => row.kind === "MODEL_PLAN");
      const counterfactuals = currentCounterfactuals(rows.filter(row => row.kind === SKIPPED_KIND), entries);
      return { entries, plans, planChoices: planChoiceRows(plans, entries, counterfactuals), counterfactuals,
        counterfactualSummary: summarizeCounterfactuals(counterfactuals), summary: summarizeDecisionLog(entries) };
    },
    /** Choice on one recommendation of a stored Tuesday plan; the plan itself is never rewritten. */
    async setChoice(rosterId, planId, playerId, input) {
      const { choice, reason } = normalizePlanChoice(input);
      if (typeof planId !== "string" || !planId.startsWith(`${season}:${rosterId}:plan:`)) throw new Error("Plan inconnu");
      const client = await supabase();
      const { data: row, error: readError } = await client.from(TABLE).select("id, details").eq("id", planId).eq("roster_id", rosterId).eq("kind", "MODEL_PLAN").maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) throw new Error("Plan inconnu");
      const details = applyPlanChoice(row.details ?? {}, playerId, { choice, reason });
      const { error } = await client.from(TABLE).update({ details, updated_at: new Date().toISOString() }).eq("id", planId).eq("roster_id", rosterId);
      if (error) throw new Error(error.message);
      return { planId, playerId: String(playerId), ...(details.choices[String(playerId)] ?? { choice: null, reason: null, at: null }) };
    },
    /** Last Coach state sent by the change-only bulletin (one row per roster, overwritten). */
    async coachState(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("details, updated_at").eq("id", `${season}:${rosterId}:coach-state`).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.details?.state ?? null;
    },
    async saveCoachState(rosterId, state) {
      const { error } = await (await supabase()).from(TABLE).upsert({ id: `${season}:${rosterId}:coach-state`, season: Number(season), roster_id: rosterId, week: state.week ?? null,
        kind: "COACH_STATE", occurred_at: state.capturedAt ?? new Date().toISOString(), details: { state }, source: "COACH_BULLETIN", updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) throw new Error(error.message);
      return true;
    },
    /** Only the reason is writable from the page, and only on an existing row of that roster. */
    async setReason(rosterId, id, reason) {
      const text = normalizeReason(reason);
      if (typeof id !== "string" || !id.startsWith(`${season}:${rosterId}:`)) throw new Error("Entrée inconnue");
      const { data, error } = await (await supabase()).from(TABLE).update({ reason: text, reason_at: text ? new Date().toISOString() : null }).eq("id", id).eq("roster_id", rosterId).select("id, reason, reason_at");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("Entrée inconnue");
      return { id, reason: data[0].reason, reasonAt: data[0].reason_at };
    },
    /** Sync never sends `reason`: PostgREST updates only the columns present. */
    async upsert(entries) {
      if (!entries.length) return 0;
      const { error } = await (await supabase()).from(TABLE).upsert(entries.map(toRow), { onConflict: "id" });
      if (error) throw new Error(error.message);
      return entries.length;
    },
    async plans(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("week, details").eq("season", Number(season)).eq("roster_id", rosterId).eq("kind", "MODEL_PLAN");
      if (error) throw new Error(error.message);
      return Object.fromEntries((data || []).map(row => [row.week, row.details?.recommendations ?? []]));
    },
    /** Coach trade option of each Tuesday plan: null when the plan predates the recording (not guessed). */
    async tradeOptions(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("week, details").eq("season", Number(season)).eq("roster_id", rosterId).eq("kind", "MODEL_PLAN");
      if (error) throw new Error(error.message);
      return Object.fromEntries((data || []).map(row => [row.week, row.details?.tradeOption ?? null]));
    },
    /** Adds the Coach trade option to that week's Tuesday plan; the first write wins, no plan = nothing written. */
    async recordTradeOption(rosterId, week, option) {
      const id = `${season}:${rosterId}:plan:${week}`;
      const client = await supabase();
      const { data: row, error: readError } = await client.from(TABLE).select("id, details").eq("id", id).eq("kind", "MODEL_PLAN").maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) return { id, skipped: "NO_PLAN" };
      if (row.details?.tradeOption) return { id, skipped: "exists" };
      const { error } = await client.from(TABLE).update({ details: { ...(row.details ?? {}), tradeOption: option }, updated_at: new Date().toISOString() }).eq("id", id).eq("roster_id", rosterId);
      if (error) throw new Error(error.message);
      return { id, recorded: option.status };
    },
    /** The Tuesday plan, before the waivers: the first write of a week wins. */
    async recordPlan(rosterId, week, recommendations) {
      const id = `${season}:${rosterId}:plan:${week}`;
      const { data: existing } = await (await supabase()).from(TABLE).select("id").eq("id", id).maybeSingle();
      if (existing) return { id, skipped: "exists" };
      const { error } = await (await supabase()).from(TABLE).insert({ id, season: Number(season), roster_id: rosterId, week, kind: "MODEL_PLAN", occurred_at: new Date().toISOString(),
        details: { recommendations }, source: "WEEKLY_JOB", updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return { id, recorded: recommendations.length };
    }
  };
}

/** Fetch, assemble and (unless dry-run) upsert the whole season of one team. */
export async function syncDecisionLog({ team = "t0z", fetchImpl = fetch, store = null, dryRun = false, leagueId = LEAGUE_METADATA_2026.leagueId } = {}) {
  const [league, rosters, users, state, index] = await Promise.all([getJson(`/league/${leagueId}`, fetchImpl), getJson(`/league/${leagueId}/rosters`, fetchImpl),
    getJson(`/league/${leagueId}/users`, fetchImpl), getJson("/state/nfl", fetchImpl), getPlayersIndex({ fetchImpl })]);
  const season = String(league.season);
  const { roster } = findRosterByTeam(rosters, users, team);
  const week = resolveOperationalWeek(state);
  const lastCompletedWeek = resolveLastCompletedWeek(state);
  const legs = Array.from({ length: week }, (_, i) => i + 1);
  const transactions = (await Promise.all(legs.map(leg => getJson(`/league/${leagueId}/transactions/${leg}`, fetchImpl).catch(() => [])))).flat();
  const completed = Array.from({ length: lastCompletedWeek }, (_, i) => i + 1);
  const matchupsByWeek = Object.fromEntries(await Promise.all(completed.map(async w => [w, await getJson(`/league/${leagueId}/matchups/${w}`, fetchImpl).catch(() => [])])));
  const statsByWeek = Object.fromEntries(await Promise.all(completed.map(async w => [w, await getJson(`/stats/nfl/regular/${season}/${w}`, fetchImpl).catch(() => ({}))])));
  const schedule = await getSchedule({ season, fetchImpl });
  const recorded = store && !dryRun ? await store.plans(roster.roster_id).catch(() => ({})) : {};
  const recommendationsByWeek = { ...(await loadSnapshotRecommendations(team)), ...recorded };
  const tradeOptionsByWeek = store && !dryRun && typeof store.tradeOptions === "function" ? await store.tradeOptions(roster.roster_id).catch(() => ({})) : {};
  const result = assembleDecisionLog({ transactions, matchupsByWeek, statsByWeek, scoring: league.scoring_settings, schedule, rosterId: roster.roster_id, season,
    lastCompletedWeek, playerOf: id => index.get(String(id)) ?? null, recommendationsByWeek, tradeOptionsByWeek });
  const written = !dryRun && store ? await store.upsert([...result.entries, ...result.counterfactuals]) : 0;
  const teamNames = new Map(rosters.map(row => {
    const owner = users.find(user => user.user_id === row.owner_id);
    return [row.roster_id, owner?.metadata?.team_name || owner?.display_name || null];
  }));
  const budgetLeft = Number(league.settings?.waiver_budget ?? GENERAL_SETTINGS_2026.waiver.budget) - Number(roster.settings?.waiver_budget_used || 0);
  return { team, rosterId: roster.roster_id, season, week, lastCompletedWeek, written, teamNames, budgetLeft, ...result };
}

/** Thursday refresh (n8n, after Wednesday's waivers): re-sync the journal, then review this week's claims. */
export async function refreshDecisionJournal({ team = process.env.COACH_TEAM || "t0z", fetchImpl = fetch, store = createDecisionLogStore() } = {}) {
  const sync = await syncDecisionLog({ team, fetchImpl, store });
  const review = postWaiverReview({ entries: sync.entries, skipped: sync.skipped, week: sync.week, teamName: sync.teamNames.get(sync.rosterId),
    budgetLeft: sync.budgetLeft, teamNameOf: rosterId => sync.teamNames.get(rosterId) });
  return { team, week: sync.week, written: sync.written, summary: sync.summary, review, message: review.message };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const team = process.argv.find(arg => arg.startsWith("--team="))?.slice(7) || "t0z";
  const dryRun = process.argv.includes("--dry-run");
  const store = dryRun ? null : createDecisionLogStore();
  syncDecisionLog({ team, store, dryRun }).then(result => {
    console.log(JSON.stringify({ team: result.team, written: result.written, summary: result.summary, skipped: result.skipped.length }, null, 2));
    if (process.argv.includes("--verbose")) for (const entry of result.entries) console.log(entry.week, entry.kind, entry.added.map(p => p.name).join("+") || "-", "/", entry.dropped.map(p => p.name).join("+") || "-", entry.bid ?? "", JSON.stringify(entry.outcome), entry.model?.verdict ?? "");
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
