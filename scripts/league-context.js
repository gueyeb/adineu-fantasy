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

export const DEFAULT_SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_CATALOG_URL = new URL("../public/data/players-catalog.json", import.meta.url);
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

// Ordre des slots titulaires côté Sleeper : QB, RB, RB, WR, WR, TE, FLEX, K, DEF.
function buildStarterSlotOrder() {
  const order = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    for (let i = 0; i < (ROSTER_SETTINGS_2026.starters[pos] || 0); i++) order.push(pos);
  }
  for (let i = 0; i < (ROSTER_SETTINGS_2026.starters.FLEX || 0); i++) order.push("FLEX");
  for (let i = 0; i < (ROSTER_SETTINGS_2026.starters.K || 0); i++) order.push("K");
  for (let i = 0; i < (ROSTER_SETTINGS_2026.starters.DEF || 0); i++) order.push("DEF");
  return order;
}

const STARTER_SLOT_ORDER = buildStarterSlotOrder();

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

function resolvePlayer(playerMap, id) {
  return playerMap.get(id) || { sleeperId: id, name: `Player #${id}`, position: "FLEX" };
}

function findRosterByTeam(rosters, users, team) {
  const normalizedTeam = String(team).trim().toLowerCase();
  const userById = new Map(users.map(user => [user.user_id, user]));
  const named = rosters.map(roster => {
    const user = userById.get(roster.owner_id);
    const ownerName = user?.display_name || `Manager ${roster.roster_id}`;
    const teamName = user?.metadata?.team_name || ownerName;
    return { roster, ownerName, teamName };
  });
  const found = named.find(entry =>
    entry.ownerName.toLowerCase() === normalizedTeam ||
    entry.teamName.toLowerCase() === normalizedTeam ||
    String(entry.roster.roster_id) === normalizedTeam
  );
  if (!found) throw new Error(`Équipe Sleeper inconnue : ${team}`);
  return found;
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
    week = nflState?.display_week || nflState?.week || 1;
  } catch {}

  const starterIds = roster.starters || [];
  const reserveIds = new Set(roster.reserve || []);
  const startedIds = new Set(starterIds.filter(id => id && id !== "0"));

  const starters = starterIds.map((id, index) => ({
    slot: STARTER_SLOT_ORDER[index] || "FLEX",
    player: (!id || id === "0") ? null : resolvePlayer(playerMap, id)
  }));

  const bench = (roster.players || [])
    .filter(id => !startedIds.has(id) && !reserveIds.has(id))
    .map(id => resolvePlayer(playerMap, id));

  const ir = [...reserveIds].map(id => resolvePlayer(playerMap, id));

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
  limitPerPosition = 10
} = {}) {
  const { catalog } = await loadPlayerCatalog(catalogUrl);
  const rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
  const rosteredIds = new Set(rosters.flatMap(roster => roster.players || []));

  let week = 1;
  try {
    const nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = nflState?.display_week || nflState?.week || 1;
  } catch {}

  const normalizedPosition = position ? String(position).toUpperCase() : null;
  const available = (catalog.players || [])
    .filter(player => !rosteredIds.has(player.sleeperId))
    .filter(player => !normalizedPosition || player.position === normalizedPosition);

  const byPosition = {};
  for (const player of available) {
    const pos = player.position;
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(player);
  }

  for (const pos of Object.keys(byPosition)) {
    byPosition[pos].sort((a, b) => {
      const rankA = a.quality?.expertRank ?? Infinity;
      const rankB = b.quality?.expertRank ?? Infinity;
      if (rankA !== rankB) return rankA - rankB;
      const adpA = a.market?.sleeperAdp ?? Infinity;
      const adpB = b.market?.sleeperAdp ?? Infinity;
      return adpA - adpB;
    });
    byPosition[pos] = byPosition[pos].slice(0, limitPerPosition);
  }

  return { generatedAt: new Date().toISOString(), week, byPosition };
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
      lines.push(`${index + 1}. ${player.name} (${player.nflTeam || "FA"})${rank}${adp}${note}`);
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
