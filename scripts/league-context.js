#!/usr/bin/env node
/**
 * Adineu Fantasy — Contexte IA & Waiver Wire Report
 *
 * Usage :
 *   node scripts/league-context.js --team=t0z
 *   node scripts/league-context.js --free-agents
 *   node scripts/league-context.js --free-agents --position=RB
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  LEAGUE_METADATA_2026,
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026
} from "../public/assets/league-settings.js";
import { resolveOperationalWeek, resolveLastCompletedWeek } from "../public/assets/nfl-week.js";
import { findRosterByTeam, buildStarterSlotOrder, buildRosterSlots, listRosterIdentities } from "../public/assets/roster-view.js";
import { buildFaabHistory, buildTrendingAdds, summarizeFaabByPosition } from "../public/assets/league-market.js";
import { calculateFaabRemaining } from "../public/assets/team-metrics.js";
import { restOfSeasonEstimate } from "../public/assets/trade-score.js";
import { estimateBaselineProjectedPpg } from "../public/assets/trade-value.js";
import {
  FANTASY_POSITIONS,
  LAST_REGULAR_WEEK,
  PRICE_PER_POINT,
  buildOpportunitySignals,
  computeRosPpg,
  detectEvents,
  effectivePpg,
  evaluateMarket,
  evaluateRosterFit
} from "../public/assets/waiver-model.js";

export const DEFAULT_SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_CATALOG_URL = new URL("../public/data/players-catalog.json", import.meta.url);
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
const STARTER_SLOT_ORDER = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
const INJURY_STATUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // le dump Sleeper /players/nfl pèse ~15 Mo, on ne le refetch pas à chaque requête

// Statuts Sleeper connus : Questionable, Doubtful, Out, IR, PUP, Sus, NA.
export const SEVERITY_BY_STATUS = {
  Questionable: "WATCH",
  Doubtful: "ALERT",
  Out: "ALERT",
  IR: "ALERT",
  PUP: "ALERT",
  Sus: "ALERT",
  NA: "ALERT"
};

// Par fetchImpl, comme les caches hebdo : un fetch injecté ne partage jamais l'index réel.
const playersIndexCaches = new WeakMap();

/**
 * Index allégé (et mis en cache 6 h) du dump Sleeper /players/nfl (~15 Mo) : poste, équipe,
 * statut et zone de blessure, depth chart. Partagé par le Start/Sit Advisor, le Trade Finder
 * (/api/player-status) et le Waiver Wire v2 (événements : promotion, blessure du titulaire).
 */
export async function getPlayersIndex({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const now = Date.now();
  const hit = playersIndexCaches.get(fetchImpl);
  if (!forceRefresh && hit && (now - hit.at) < INJURY_STATUS_CACHE_TTL_MS) return hit.index;

  const response = await fetchImpl(`${SLEEPER_API}/players/nfl`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Sleeper API /players/nfl -> HTTP ${response.status}`);
  const raw = await response.json();

  const index = new Map();
  for (const [playerId, player] of Object.entries(raw || {})) {
    if (!player) continue;
    const position = player.position || player.fantasy_positions?.[0] || null;
    index.set(playerId, {
      id: playerId,
      name: player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || `Player #${playerId}`,
      position,
      nflTeam: player.team || null,
      injuryStatus: player.injury_status || null,
      injuryBodyPart: player.injury_body_part || null,
      depthOrder: Number.isFinite(player.depth_chart_order) ? player.depth_chart_order : null,
      searchRank: Number.isFinite(player.search_rank) ? player.search_rank : null,
      active: player.active !== false
    });
  }

  playersIndexCaches.set(fetchImpl, { at: now, index });
  return index;
}

/** sleeperId -> injury_status, pour les joueurs qui en ont un. */
export async function getInjuryStatuses({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const index = await getPlayersIndex({ fetchImpl, forceRefresh });
  const statuses = new Map();
  for (const [playerId, player] of index) {
    if (player.injuryStatus) statuses.set(playerId, player.injuryStatus);
  }
  return statuses;
}

async function sleeperGet(path, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${SLEEPER_API}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Sleeper API ${path} -> HTTP ${response.status}`);
  return response.json();
}

async function loadPlayerCatalog(catalogUrl = DEFAULT_CATALOG_URL) {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const playerMap = new Map();
  for (const player of catalog.players || []) {
    playerMap.set(player.sleeperId, player);
    playerMap.set(player.name, player);
  }
  return { catalog, playerMap };
}

/**
 * Agrège les règles de ligue et le roster d'une équipe (titulaires/banc/IR) en un seul objet,
 * pensé pour être collé tel quel dans un assistant IA externe.
 */
export async function getLeagueContext({
  team = "t0z",
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL
} = {}) {
  const { playerMap } = await loadPlayerCatalog(catalogUrl);
  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl })
  ]);

  const { roster, ownerName, teamName } = findRosterByTeam(rosters, users, team);

  let week = 1;
  try {
    const nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}

  const { starters, bench, ir } = buildRosterSlots({ roster, playerMap, starterSlotOrder: STARTER_SLOT_ORDER });

  return {
    generatedAt: new Date().toISOString(),
    week,
    league: {
      id: leagueId,
      name: LEAGUE_METADATA_2026.name,
      teams: GENERAL_SETTINGS_2026.teams,
      format: "redraft",
      scoring: "full_ppr",
      rosterSettings: ROSTER_SETTINGS_2026,
      faab: GENERAL_SETTINGS_2026.waiver.budget,
      waiverClear: `${GENERAL_SETTINGS_2026.waiver.clearDay} ${GENERAL_SETTINGS_2026.waiver.clearTime}`,
      tradeDeadlineWeek: GENERAL_SETTINGS_2026.trades.deadlineWeek
    },
    myTeam: {
      rosterId: roster.roster_id,
      owner: ownerName,
      teamName,
      starters,
      bench,
      ir
    }
  };
}

function formatPlayerLine(player) {
  if (!player) return "EMPTY";
  const team = player.nflTeam ? ` ${player.nflTeam}` : "";
  return `${player.name}${team}`;
}

/** Rend le contexte en texte brut, prêt à coller dans un chat IA externe. */
export function formatContextText(context) {
  const { league, myTeam, week } = context;
  const startersLabel = Object.entries(league.rosterSettings.starters)
    .map(([pos, count]) => `${count}${pos}`)
    .join(" ");

  const lines = [
    `${league.name.toUpperCase()}`,
    `${league.teams} teams · Full PPR · ${startersLabel} · ${league.rosterSettings.benchSlots} bench · ${league.rosterSettings.reserveSlots} IR`,
    `FAAB: $${league.faab}`,
    `Waivers: ${league.waiverClear}`,
    `Semaine: ${week}`,
    "",
    `MON ROSTER — ${myTeam.teamName.toUpperCase()} (@${myTeam.owner})`,
    "",
    "TITULAIRES"
  ];

  for (const starter of myTeam.starters) lines.push(`${starter.slot} ${formatPlayerLine(starter.player)}`);

  lines.push("", "BANC");
  if (myTeam.bench.length === 0) lines.push("EMPTY");
  for (const player of myTeam.bench) lines.push(`${(player.position || "FLEX")} ${formatPlayerLine(player)}`);

  lines.push("", "IR");
  if (myTeam.ir.length === 0) lines.push("EMPTY");
  for (const player of myTeam.ir) lines.push(`${(player.position || "FLEX")} ${formatPlayerLine(player)}`);

  return lines.join("\n");
}

// Par fetchImpl : un fetch injecté (tests) ne partage jamais le cache du vrai Sleeper.
const weeklyCaches = new WeakMap();
/** Stats/projections Sleeper d'une semaine, en cache 1 h (une semaine terminée ne bouge presque plus). */
async function cachedWeekly(path, fetchImpl) {
  if (!weeklyCaches.has(fetchImpl)) weeklyCaches.set(fetchImpl, new Map());
  const cache = weeklyCaches.get(fetchImpl);
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const data = await sleeperGet(path, { fetchImpl });
  cache.set(path, { at: Date.now(), data });
  return data;
}

/** Projections Sleeper d'une semaine (cache 1 h), pour le Start/Sit Advisor. */
export async function getWeeklyProjections({ week, season = "2026", fetchImpl = fetch } = {}) {
  return cachedWeekly(`/projections/nfl/regular/${season}/${week}`, fetchImpl);
}

/**
 * Waiver Wire v2 (docs/prd-waiver-model-v2.md) : Event -> Opportunity -> Roster Fit -> FAAB.
 * Pool = tous les joueurs Sleeper non rostés (pas seulement le catalogue pré-draft), valorisés
 * sur le reste de la saison (projections Sleeper des semaines futures), l'usage réel des 3
 * dernières semaines (snaps, opportunités, red zone) et les événements (titulaire blessé devant
 * eux, explosion de snaps/usage). Avec `team`, ajoute le fit roster et le max FAAB pour cette équipe.
 */
export async function getFreeAgents({
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL,
  position = null,
  limitPerPosition = 10,
  team = null,
  forceRefreshInjuryStatuses = false
} = {}) {
  const { catalog } = await loadPlayerCatalog(catalogUrl);
  const catalogById = new Map((catalog.players || []).map(player => [player.sleeperId, player]));
  const rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
  const rosteredIds = new Set(rosters.flatMap(roster => roster.players || []));

  let week = 1;
  let nflState = {};
  try {
    nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}
  const season = nflState?.season || "2026";
  const lastCompletedWeek = resolveLastCompletedWeek(nflState);

  let index = new Map();
  try {
    index = await getPlayersIndex({ fetchImpl, forceRefresh: forceRefreshInjuryStatuses });
  } catch {}

  const projectionsByWeek = {};
  await Promise.all(Array.from({ length: Math.max(0, LAST_REGULAR_WEEK - week + 1) }, (_, i) => week + i).map(async w => {
    try { projectionsByWeek[w] = await cachedWeekly(`/projections/nfl/regular/${season}/${w}`, fetchImpl); } catch {}
  }));
  const statsByWeek = [];
  for (let w = Math.max(1, lastCompletedWeek - 2); w <= lastCompletedWeek && lastCompletedWeek > 0; w++) {
    try { statsByWeek.push({ week: w, stats: await cachedWeekly(`/stats/nfl/regular/${season}/${w}`, fetchImpl) }); } catch {}
  }

  const expectedProjectionWeeks = Math.max(0, LAST_REGULAR_WEEK - week + 1);
  const coverage = {
    projectionWeeks: `${Object.keys(projectionsByWeek).length}/${expectedProjectionWeeks}`,
    statsWeeks: `${statsByWeek.length}/${lastCompletedWeek > 0 ? Math.min(3, lastCompletedWeek) : 0}`,
    playersIndex: index.size > 0
  };
  const degraded = Object.keys(projectionsByWeek).length < expectedProjectionWeeks || !coverage.playersIndex ||
    statsByWeek.length < (lastCompletedWeek > 0 ? Math.min(3, lastCompletedWeek) : 0);

  const meta = id => index.get(id) || (catalogById.has(id) ? { id, name: catalogById.get(id).name, position: catalogById.get(id).position, nflTeam: catalogById.get(id).nflTeam, active: true } : null);
  const rosFor = (id, player) => computeRosPpg({ playerId: id, nflTeam: player?.nflTeam, projectionsByWeek, week });

  // Pool : index Sleeper complet (ou catalogue en repli), postes fantasy, équipe NFL active.
  // Le catalogue pré-draft ne sert de pool que si l'index Sleeper est indisponible.
  const candidateIds = new Set(index.size ? index.keys() : catalogById.keys());
  const byTeamPosition = new Map();
  for (const id of candidateIds) {
    const player = meta(id);
    if (!player?.nflTeam || !FANTASY_POSITIONS.includes(player.position)) continue;
    const key = `${player.nflTeam}:${player.position}`;
    if (!byTeamPosition.has(key)) byTeamPosition.set(key, []);
    byTeamPosition.get(key).push({ ...player, id, rosPpg: rosFor(id, player) });
  }

  const rows = [];
  for (const id of candidateIds) {
    if (rosteredIds.has(id)) continue;
    const player = meta(id);
    if (!player?.active || !player.nflTeam || !FANTASY_POSITIONS.includes(player.position)) continue;
    // Jamais recommandé s'il ne peut pas jouer (IR/Out/Doubtful/PUP/Sus/NA), même sévérité que le Start/Sit.
    if (SEVERITY_BY_STATUS[player.injuryStatus] === "ALERT") continue;
    const catalogEntry = catalogById.get(id) || {};
    // Repli étiqueté : sans couverture de projections futures, estimation par rang (ECR catalogue).
    const projectedRos = rosFor(id, player);
    const rankFallback = projectedRos === null && Number.isFinite(catalogEntry.quality?.expertRank ?? catalogEntry.market?.sleeperAdp)
      ? estimateBaselineProjectedPpg({ ...catalogEntry, projectedPpg: undefined, projection: undefined }) : null;
    const rosPpg = projectedRos ?? rankFallback;
    const signals = buildOpportunitySignals(id, statsByWeek);
    const weekProjection = projectionsByWeek[week]?.[id]?.pts_ppr ?? null;
    if (rosPpg === null && !signals.gamesPlayed) continue;
    const teammates = byTeamPosition.get(`${player.nflTeam}:${player.position}`) || [];
    const events = detectEvents({ player: { ...player, id, rosPpg }, teammates, signals });
    // Last game counts as role evidence only if he actually had the role (≥ 60 % of the snaps).
    const lastRolePoints = signals.last?.snapShare >= 0.6 ? signals.last.points : null;
    const pace = effectivePpg({ rosPpg, weekProjection, recentPpg: signals.recentPpg, lastRolePoints, duration: events.duration, share: events.share, week });
    rows.push({
      ...catalogEntry,
      sleeperId: id,
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      injuryStatus: player.injuryStatus,
      rosPpg,
      rosSource: projectedRos !== null ? "SLEEPER_PROJECTIONS" : rankFallback !== null ? "RANK_ESTIMATE" : "NONE",
      weekProjection: Number.isFinite(weekProjection) ? Number(weekProjection.toFixed(1)) : null,
      effectivePpg: pace.effective,
      signals,
      events: { ...events, rolePpg: pace.rolePpg, roleWeeks: pace.roleWeeks }
    });
  }

  const market = evaluateMarket({ rows, week });
  let users = [];
  try { users = await sleeperGet(`/league/${leagueId}/users`, { fetchImpl }); } catch {}
  let fitContext = null;
  if (team) {
    const { roster } = findRosterByTeam(rosters, users, team);
    const myPlayers = (roster.players || []).map(id => {
      const player = meta(id) || { name: `Player #${id}`, position: "FLEX" };
      return { ...(catalogById.get(id) || {}), ...player, sleeperId: id, projectedPpg: projectionsByWeek[week]?.[id]?.pts_ppr, injuryStatus: player.injuryStatus };
    });
    const fallback = restOfSeasonEstimate(week);
    const paceOf = player => player.effectivePpg ?? rosFor(player.sleeperId, player) ?? fallback(player);
    fitContext = { myPlayers, paceOf, faabRemaining: calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, roster.settings?.waiver_budget_used) };
  }

  const withWaiver = row => {
    const fit = fitContext ? evaluateRosterFit({ marketRow: row, week, ...fitContext }) : null;
    return {
      ...row,
      waiver: {
        score: row.marketScore,
        category: row.category,
        projectedPpg: row.weekProjection ?? row.rosPpg,
        rosPpg: row.rosPpg,
        rosSource: row.rosSource,
        recentPpg: row.signals.recentPpg,
        faabPct: row.faabPct,
        faabMarket: row.faabMarket,
        newsOverride: row.events.newsOverride,
        flags: row.events.flags,
        reasons: row.events.reasons,
        duration: row.events.duration,
        snapShare: row.signals.last?.snapShare ?? null,
        opportunities: row.signals.last?.opportunities ?? null,
        ...(fit ? { fit } : {})
      }
    };
  };

  const normalizedPosition = position ? String(position).toUpperCase() : null;
  const byPosition = {};
  for (const row of market) {
    if (normalizedPosition && row.position !== normalizedPosition) continue;
    if (!byPosition[row.position]) byPosition[row.position] = [];
    if (byPosition[row.position].length >= limitPerPosition) continue;
    byPosition[row.position].push(withWaiver(row));
  }

  // Signaux de marché de la ligue (benchmark Fantasy Life, lot 1) : enchères gagnées + trending Sleeper.
  const rosterNameById = new Map(listRosterIdentities(rosters, users).map(({ roster, teamName }) => [String(roster.roster_id), teamName]));
  const rosterOfPlayer = new Map(rosters.flatMap(roster => (roster.players || []).map(id => [id, rosterNameById.get(String(roster.roster_id)) || null])));
  const transactionsByWeek = [];
  for (let w = 1; w <= week; w++) {
    try { transactionsByWeek.push({ week: w, transactions: await cachedWeekly(`/league/${leagueId}/transactions/${w}`, fetchImpl) }); } catch {}
  }
  const faabHistory = buildFaabHistory(transactionsByWeek, { playerMeta: meta, rosterName: rosterId => rosterNameById.get(String(rosterId)) || null });
  let trendingRaw = [];
  try { trendingRaw = await cachedWeekly("/players/nfl/trending/add?lookback_hours=48&limit=25", fetchImpl); } catch {}
  const marketById = new Map(market.map(row => [row.sleeperId, row]));
  const trending = buildTrendingAdds(trendingRaw || [], {
    rosteredIds,
    rosterOf: id => rosterOfPlayer.get(id) || null,
    playerMeta: meta,
    modelRowOf: id => marketById.has(id) ? withWaiver(marketById.get(id)) : null
  });

  return {
    generatedAt: new Date().toISOString(), week, lastCompletedWeek, rankingModel: "WAIVER_V2", degraded, coverage,
    pricePerPoint: PRICE_PER_POINT, team: team || null, faabRemaining: fitContext?.faabRemaining ?? null, byPosition,
    faabHistory: faabHistory.slice(0, 30), faabByPosition: summarizeFaabByPosition(faabHistory), trending
  };
}

/** Rend la liste de free agents en un bulletin texte, groupé par poste. */
export function formatWaiverReport({ byPosition, week }) {
  const lines = [`📋 WAIVER WIRE REPORT — ADINEU${week ? ` (Semaine ${week})` : ""}`];

  for (const pos of POSITION_ORDER) {
    const players = byPosition[pos] || [];
    if (players.length === 0) continue;
    lines.push("", pos);
    players.forEach((player, index) => {
      const rank = Number.isFinite(player.quality?.expertRank) ? ` · ECR #${player.quality.expertRank}` : "";
      const adp = Number.isFinite(player.market?.sleeperAdp) ? ` · ADP ${player.market.sleeperAdp}` : "";
      const note = player.adineu?.thesis ? ` — ${player.adineu.thesis}` : "";
      const waiver = player.waiver
        ? ` · ${player.waiver.category} · ROS ${player.waiver.rosPpg ?? "n/d"} · FAAB marché ${player.waiver.faabPct[0]}–${player.waiver.faabPct[1]}%` +
          (player.waiver.fit ? ` · Fit ${player.waiver.fit.fitScore} · Max ${player.waiver.fit.faabMaxForMe} $` : "") +
          (player.waiver.newsOverride ? ` · ⚡ ${player.waiver.reasons.join(" ; ")}` : "")
        : "";
      lines.push(`${index + 1}. ${player.name} (${player.nflTeam || "FA"})${waiver}${rank}${adp}${note}`);
    });
  }

  if (lines.length === 1) lines.push("", "Aucun free agent disponible pour ce filtre.");

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--free-agents")) {
    const position = (args.find(arg => arg.startsWith("--position=")) || "").split("=")[1] || null;
    const limit = Number((args.find(arg => arg.startsWith("--limit=")) || "").split("=")[1]) || 10;
    const report = await getFreeAgents({ position, limitPerPosition: limit });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatWaiverReport(report));
    return;
  }

  const team = (args.find(arg => arg.startsWith("--team=")) || "--team=t0z").split("=")[1];
  const context = await getLeagueContext({ team });
  console.log(args.includes("--json") ? JSON.stringify(context, null, 2) : formatContextText(context));
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch(error => {
    console.error("Erreur d'exécution :", error.message);
    process.exitCode = 1;
  });
}
