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
import { findRosterByTeam, buildStarterSlotOrder, buildRosterSlots } from "../public/assets/roster-view.js";

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

let injuryStatusCache = null;
let injuryStatusCacheAt = 0;

/**
 * Récupère (et met en cache en mémoire) le statut blessure de chaque joueur NFL depuis Sleeper.
 * Ne conserve que les joueurs ayant un `injury_status` non nul, pour rester léger. Partagé par
 * le Start/Sit Advisor (lineup-advisor.js) et le Waiver Wire (getFreeAgents ci-dessous), pour
 * qu'un joueur en IR/Out n'y soit jamais recommandé avec une fausse projection.
 */
export async function getInjuryStatuses({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && injuryStatusCache && (now - injuryStatusCacheAt) < INJURY_STATUS_CACHE_TTL_MS) return injuryStatusCache;

  const response = await fetchImpl(`${SLEEPER_API}/players/nfl`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Sleeper API /players/nfl -> HTTP ${response.status}`);
  const raw = await response.json();

  const statuses = new Map();
  for (const [playerId, player] of Object.entries(raw)) {
    if (player?.injury_status) statuses.set(playerId, player.injury_status);
  }

  injuryStatusCache = statuses;
  injuryStatusCacheAt = now;
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

/**
 * Liste les joueurs du catalogue Adineu qui ne sont sur aucun des 12 rosters Sleeper,
 * groupés par poste et triés par rang expert (puis ADP).
 */
export async function getFreeAgents({
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL,
  position = null,
  limitPerPosition = 10,
  forceRefreshInjuryStatuses = false
} = {}) {
  const { catalog } = await loadPlayerCatalog(catalogUrl);
  const rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
  const rosteredIds = new Set(rosters.flatMap(roster => roster.players || []));

  let week = 1;
  let nflState = {};
  try {
    nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}

  const season = nflState?.season || "2026";
  let weeklyProjections = {};
  try {
    weeklyProjections = await sleeperGet(`/projections/nfl/regular/${season}/${week}`, { fetchImpl });
  } catch {}

  const recentScores = new Map();
  const lastCompletedWeek = resolveLastCompletedWeek(nflState);
  if (lastCompletedWeek > 0) {
    try {
      const matchups = await sleeperGet(`/league/${leagueId}/matchups/${lastCompletedWeek}`, { fetchImpl });
      for (const matchup of matchups || []) {
        for (const [playerId, points] of Object.entries(matchup.players_points || {})) {
          if (Number.isFinite(points)) recentScores.set(playerId, points);
        }
      }
    } catch {}
  }

  // Un free agent en IR/Out/Doubtful/PUP/Sus/NA ne peut pas jouer cette semaine (ni, pour l'IR,
  // avant plusieurs semaines) : jamais recommandé avec une projection fabriquée. Même sévérité
  // ALERT que le Start/Sit Advisor (SEVERITY_BY_STATUS ci-dessus).
  let injuryStatuses = new Map();
  try {
    injuryStatuses = await getInjuryStatuses({ fetchImpl, forceRefresh: forceRefreshInjuryStatuses });
  } catch {}

  const normalizedPosition = position ? String(position).toUpperCase() : null;
  const available = (catalog.players || [])
    .filter(player => !rosteredIds.has(player.sleeperId))
    .filter(player => !normalizedPosition || player.position === normalizedPosition)
    .filter(player => SEVERITY_BY_STATUS[injuryStatuses.get(player.sleeperId)] !== "ALERT")
    .map(player => {
      const projected = Number(weeklyProjections?.[player.sleeperId]?.pts_ppr);
      const recent = recentScores.get(player.sleeperId);
      const rank = player.quality?.expertRank ?? player.market?.sleeperAdp ?? 300;
      const baseline = Math.max(0, 16 - (rank / 18));
      const projectedPpg = Number.isFinite(projected) ? projected : baseline;
      const recentPpg = Number.isFinite(recent) ? recent : null;
      const score = Number((projectedPpg * 0.65 + (recentPpg ?? baseline) * 0.25 + baseline * 0.10).toFixed(1));
      const category = score >= 12 ? "PRIORITÉ" : score >= 8 ? "STREAMING" : score >= 5 ? "STASH" : "PROFONDEUR";
      const faabPct = category === "PRIORITÉ" ? [8, 15] : category === "STREAMING" ? [3, 7] : category === "STASH" ? [1, 3] : [0, 1];
      return { ...player, waiver: { score, category, projectedPpg: Number(projectedPpg.toFixed(1)), recentPpg, faabPct } };
    });

  const byPosition = {};
  for (const player of available) {
    const pos = player.position;
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(player);
  }

  for (const pos of Object.keys(byPosition)) {
    byPosition[pos].sort((a, b) => {
      if (a.waiver.score !== b.waiver.score) return b.waiver.score - a.waiver.score;
      const rankA = a.quality?.expertRank ?? Infinity;
      const rankB = b.quality?.expertRank ?? Infinity;
      if (rankA !== rankB) return rankA - rankB;
      const adpA = a.market?.sleeperAdp ?? Infinity;
      const adpB = b.market?.sleeperAdp ?? Infinity;
      return adpA - adpB;
    });
    byPosition[pos] = byPosition[pos].slice(0, limitPerPosition);
  }

  return { generatedAt: new Date().toISOString(), week, lastCompletedWeek, rankingModel: "IN_SEASON_V1", byPosition };
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
        ? ` · ${player.waiver.category} · Proj. ${player.waiver.projectedPpg} · FAAB ${player.waiver.faabPct[0]}–${player.waiver.faabPct[1]}%`
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
