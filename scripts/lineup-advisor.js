#!/usr/bin/env node
/**
 * Adineu Fantasy — Start/Sit Advisor
 *
 * Croise le lineup d'une équipe avec le statut blessure Sleeper et les bye weeks
 * pour flaguer chaque titulaire à risque, puis propose le meilleur remplaçant
 * (banc en priorité, sinon un free agent du marché).
 *
 * Usage :
 *   node scripts/lineup-advisor.js --team=t0z
 */

import { pathToFileURL } from "node:url";
import { getLeagueContext, getFreeAgents } from "./league-context.js";
import { calculatePlayerTradeProfile } from "../public/assets/trade-value.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";

const SLEEPER_API = "https://api.sleeper.app/v1";
const FLEX_ELIGIBLE = ["RB", "WR", "TE"];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // le dump Sleeper /players/nfl pèse ~15 Mo, on ne le refetch pas à chaque requête

// Statuts Sleeper connus : Questionable, Doubtful, Out, IR, PUP, Sus, NA.
const SEVERITY_BY_STATUS = {
  Questionable: "WATCH",
  Doubtful: "ALERT",
  Out: "ALERT",
  IR: "ALERT",
  PUP: "ALERT",
  Sus: "ALERT",
  NA: "ALERT"
};

let statusCache = null;
let statusCacheAt = 0;

/**
 * Récupère (et met en cache en mémoire) le statut blessure de chaque joueur NFL depuis Sleeper.
 * Ne conserve que les joueurs ayant un `injury_status` non nul, pour rester léger.
 */
export async function getInjuryStatuses({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && statusCache && (now - statusCacheAt) < CACHE_TTL_MS) return statusCache;

  const response = await fetchImpl(`${SLEEPER_API}/players/nfl`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Sleeper API /players/nfl -> HTTP ${response.status}`);
  const raw = await response.json();

  const statuses = new Map();
  for (const [playerId, player] of Object.entries(raw)) {
    if (player?.injury_status) statuses.set(playerId, player.injury_status);
  }

  statusCache = statuses;
  statusCacheAt = now;
  return statuses;
}

function isEligibleForSlot(position, slot) {
  if (slot === "FLEX") return FLEX_ELIGIBLE.includes(position);
  return position === slot;
}

function isFlagged(player, playerStatuses) {
  const status = playerStatuses.get(player.sleeperId);
  return Boolean(SEVERITY_BY_STATUS[status]);
}

function bestBenchReplacement(slot, bench, playerStatuses) {
  const candidates = bench.filter(player => isEligibleForSlot(player.position, slot) && !isFlagged(player, playerStatuses));
  if (candidates.length === 0) return null;
  return candidates
    .map(player => ({ player, tradeValue: calculatePlayerTradeProfile(player).tradeValue }))
    .sort((a, b) => b.tradeValue - a.tradeValue)[0].player;
}

function bestFreeAgentReplacement(slot, freeAgentsByPosition) {
  const positions = slot === "FLEX" ? FLEX_ELIGIBLE : [slot];
  const candidates = positions.flatMap(pos => freeAgentsByPosition[pos] || []);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const rankA = a.quality?.expertRank ?? Infinity;
    const rankB = b.quality?.expertRank ?? Infinity;
    return rankA - rankB;
  })[0];
}

function findReplacement(slot, bench, playerStatuses, freeAgentsByPosition) {
  const fromBench = bestBenchReplacement(slot, bench, playerStatuses);
  if (fromBench) return { source: "bench", player: fromBench };
  const fromMarket = bestFreeAgentReplacement(slot, freeAgentsByPosition);
  if (fromMarket) return { source: "free_agent", player: fromMarket };
  return null;
}

/**
 * Diagnostique un lineup titulaire : slot vide, blessure, bye week — avec un remplaçant suggéré.
 * @param {Object} options
 * @param {Object} options.myTeam Forme renvoyée par getLeagueContext().myTeam (starters/bench/ir)
 * @param {Map<string,string>} [options.playerStatuses] sleeperId -> injury_status Sleeper
 * @param {Object} [options.freeAgentsByPosition] Sortie de getFreeAgents().byPosition
 * @param {Object} [options.byeWeeks] Team NFL (abbr) -> numéro de semaine de bye
 * @param {number} [options.currentWeek]
 */
export function diagnoseLineup({
  myTeam,
  playerStatuses = new Map(),
  freeAgentsByPosition = {},
  byeWeeks = {},
  currentWeek = null
}) {
  const bench = myTeam.bench || [];
  const alerts = [];

  for (const starter of myTeam.starters) {
    const player = starter.player;

    if (!player) {
      alerts.push({
        slot: starter.slot,
        player: null,
        severity: "ALERT",
        reason: "Slot vide",
        replacement: findReplacement(starter.slot, bench, playerStatuses, freeAgentsByPosition)
      });
      continue;
    }

    const status = playerStatuses.get(player.sleeperId) || null;
    const onBye = currentWeek != null && byeWeeks[player.nflTeam] === currentWeek;
    const statusSeverity = SEVERITY_BY_STATUS[status] || null;
    if (!statusSeverity && !onBye) continue;

    alerts.push({
      slot: starter.slot,
      player,
      severity: onBye ? "ALERT" : statusSeverity,
      reason: onBye ? `Bye Week (semaine ${currentWeek})` : status,
      replacement: findReplacement(starter.slot, bench, playerStatuses, freeAgentsByPosition)
    });
  }

  return { alerts };
}

function describePlayer(player) {
  if (!player) return "Slot vide";
  const team = player.nflTeam ? ` ${player.nflTeam}` : "";
  return `${player.name} (${player.position}${team})`;
}

/** Rend le diagnostic en bulletin texte, prêt à coller. */
export function formatLineupAdvisory({ alerts }) {
  if (alerts.length === 0) return "✅ START/SIT ADVISOR — ADINEU\n\nAucune alerte : lineup complet, personne à risque signalé par Sleeper.";

  const lines = ["🚨 START/SIT ADVISOR — ADINEU"];
  for (const alert of alerts) {
    const icon = alert.severity === "ALERT" ? "🔴" : "🟡";
    lines.push("", `${icon} ${alert.slot} — ${describePlayer(alert.player)}`, `   Raison : ${alert.reason}`);
    if (alert.replacement) {
      const sourceLabel = alert.replacement.source === "bench" ? "banc" : "free agent";
      lines.push(`   Remplaçant conseillé (${sourceLabel}) : ${describePlayer(alert.replacement.player)}`);
    } else {
      lines.push("   Aucun remplaçant évident trouvé.");
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const team = (args.find(arg => arg.startsWith("--team=")) || "--team=t0z").split("=")[1];

  const [context, playerStatuses, freeAgents] = await Promise.all([
    getLeagueContext({ team }),
    getInjuryStatuses(),
    getFreeAgents({ limitPerPosition: 5 })
  ]);

  const diagnosis = diagnoseLineup({
    myTeam: context.myTeam,
    playerStatuses,
    freeAgentsByPosition: freeAgents.byPosition,
    byeWeeks: BYE_WEEKS_2026,
    currentWeek: context.week
  });

  console.log(args.includes("--json") ? JSON.stringify(diagnosis, null, 2) : formatLineupAdvisory(diagnosis));
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch(error => {
    console.error("Erreur d'exécution :", error.message);
    process.exitCode = 1;
  });
}
