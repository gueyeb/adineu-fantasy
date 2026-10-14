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
import { attachModelView, buildLineupEntries, buildMoveEntries, decisionWeekOf, evaluateMove, lastKickoffByWeek, normalizeReason, postWaiverReview, skippedRecommendations, summarizeDecisionLog, winningClaims } from "../public/assets/decision-log.js";
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
  return rows.filter(row => row.waiver?.decision?.recommendedAction).map(row => ({
    playerId: String(row.sleeperId), name: row.name, action: row.waiver.decision.recommendedAction,
    suggestedBid: planned.get(String(row.sleeperId))?.suggestedBid ?? row.waiver.suggestedBid ?? null, inPlan: planned.has(String(row.sleeperId)), source }));
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
export function assembleDecisionLog({ transactions, matchupsByWeek, statsByWeek, scoring, schedule, rosterId, season, lastCompletedWeek, playerOf, recommendationsByWeek = {} }) {
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
  const lineups = buildLineupEntries({ matchupsByWeek, rosterId, season, lastCompletedWeek,
    optimalOf: row => computeOptimalLineupPoints({ playerIds: row.players || [], playersPoints: row.players_points || {}, playerCatalog: new Map((row.players || []).map(id => [id, playerOf(id)])), rosterSettings: ROSTER_SETTINGS_2026 }) });
  const entries = [...moves, ...lineups].map(entry => attachModelView(entry, recommendationsByWeek));
  return { entries, skipped: skippedRecommendations(moves, recommendationsByWeek), summary: summarizeDecisionLog(entries) };
}

const toRow = entry => ({ id: entry.id, season: Number(entry.season), roster_id: entry.rosterId, week: entry.week, kind: entry.kind, occurred_at: entry.occurredAt,
  details: { added: entry.added, dropped: entry.dropped, bid: entry.bid, note: entry.note, lostTo: entry.lostTo ?? null },
  outcome: entry.outcome ?? null, model: entry.model ?? null, source: "SLEEPER_SYNC", updated_at: new Date().toISOString() });
const fromRow = row => ({ id: row.id, season: row.season, rosterId: row.roster_id, week: row.week, kind: row.kind, occurredAt: row.occurred_at,
  added: row.details?.added ?? [], dropped: row.details?.dropped ?? [], bid: row.details?.bid ?? null, note: row.details?.note ?? null, lostTo: row.details?.lostTo ?? null,
  recommendations: row.details?.recommendations ?? null, outcome: row.outcome, model: row.model, reason: row.reason ?? null, reasonAt: row.reason_at ?? null });

export function createDecisionLogStore({ getSupabase = createSupabaseFromEnv, season = LEAGUE_METADATA_2026.season } = {}) {
  let client = null;
  const supabase = async () => (client ||= await getSupabase());
  return {
    async list(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("*").eq("season", Number(season)).eq("roster_id", rosterId).order("week", { ascending: false }).order("occurred_at", { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data || []).map(fromRow);
      const entries = rows.filter(row => row.kind !== "MODEL_PLAN");
      return { entries, plans: rows.filter(row => row.kind === "MODEL_PLAN"), summary: summarizeDecisionLog(entries) };
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
  const result = assembleDecisionLog({ transactions, matchupsByWeek, statsByWeek, scoring: league.scoring_settings, schedule, rosterId: roster.roster_id, season,
    lastCompletedWeek, playerOf: id => index.get(String(id)) ?? null, recommendationsByWeek });
  const written = !dryRun && store ? await store.upsert(result.entries) : 0;
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
