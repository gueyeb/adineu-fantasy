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
import { getLeagueContext, getFreeAgents, getInjuryStatuses, getPlayersIndex, getSchedule, getWeeklyProjections, getWeeklyStats, SEVERITY_BY_STATUS } from "./league-context.js";
import { loadPlayerValues } from "./analyze-trades.js";
import { buildDefenseVsPosition, buildOpponents, matchupFor } from "../public/assets/defense-vs-position.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { calculatePlayerTradeProfile } from "../public/assets/trade-value.js";
import { buildProjectedLineup, weeklyEstimate } from "../public/assets/trade-score.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";

const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

export { getInjuryStatuses };

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
    // Waiver v2 market score first (in-season value), expert rank only as a tie-break.
    const scoreDiff = (b.waiver?.score ?? -1) - (a.waiver?.score ?? -1);
    if (scoreDiff !== 0) return scoreDiff;
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

/**
 * Lineup optimisée vs lineup actuelle (benchmark Fantasy Life, lot 1) : même moteur que le Trade
 * Finder (buildProjectedLineup + weeklyEstimate : projection Sleeper de la semaine, 0 si Out/IR).
 * IR exclu du pool. Retourne le gain en points projetés et les changements à faire.
 */
export function compareWithOptimalLineup({ myTeam, projections = {}, playerStatuses = new Map() }) {
  const enrich = player => player && {
    ...player,
    projectedPpg: Number.isFinite(projections[player.sleeperId]?.pts_ppr) ? projections[player.sleeperId].pts_ppr : undefined,
    injuryStatus: playerStatuses.get(player.sleeperId) || null
  };
  const current = myTeam.starters.map(starter => ({ slot: starter.slot, player: enrich(starter.player) }));
  const currentTotal = current.reduce((sum, starter) => sum + (starter.player ? weeklyEstimate(starter.player) : 0), 0);
  const pool = [...current.map(starter => starter.player).filter(Boolean), ...(myTeam.bench || []).map(enrich)];
  const optimal = buildProjectedLineup(pool, { estimate: weeklyEstimate });
  const currentIds = new Set(current.map(starter => starter.player?.sleeperId).filter(Boolean));
  const optimalIds = new Set(optimal.slots.map(slot => slot.sleeperId).filter(Boolean));
  const byId = new Map(pool.map(player => [String(player.sleeperId), player]));
  const gain = Number((optimal.total - currentTotal).toFixed(1));
  return {
    currentTotal: Number(currentTotal.toFixed(1)),
    optimalTotal: optimal.total,
    gain: gain > 0 ? gain : 0,
    // Changes only when they actually gain points, and never "start" a player projected at 0 (Out/IR).
    promote: gain > 0 ? [...optimalIds].filter(id => !currentIds.has(id)).map(id => byId.get(id)).filter(player => weeklyEstimate(player) > 0) : [],
    bench: gain > 0 ? [...currentIds].filter(id => !optimalIds.has(id)).map(id => byId.get(String(id))) : [],
    slots: optimal.slots
  };
}

export const MAX_COMPARE = 8;

/**
 * Comparateur Start/Sit (benchmark Fantasy Life, lot 3) : pour les joueurs demandés (par défaut
 * le roster de l'équipe), projection Sleeper de la semaine, valeur reste de saison, usage, statut
 * blessure et difficulté du matchup (DvP : points concédés par l'adversaire à ce poste).
 */
export async function getStartSit({ team = null, ids = [], fetchImpl = fetch } = {}) {
  const context = team ? await getLeagueContext({ team, fetchImpl }) : null;
  const week = context?.week ?? null;
  const index = await getPlayersIndex({ fetchImpl });
  const rosterIds = context ? [...context.myTeam.starters.map(starter => starter.player?.sleeperId), ...context.myTeam.bench.map(player => player.sleeperId)].filter(Boolean) : [];
  const starterIds = new Set(context ? context.myTeam.starters.map(starter => starter.player?.sleeperId).filter(Boolean) : []);
  const requested = ids.length ? ids.slice(0, MAX_COMPARE) : rosterIds;
  // Sans équipe (comparateur libre), la semaine vient de l'état NFL Sleeper — jamais une semaine 1 par défaut.
  let currentWeek = week;
  if (!Number.isFinite(currentWeek)) {
    const state = await fetchImpl("https://api.sleeper.app/v1/state/nfl", { signal: AbortSignal.timeout(10_000) }).then(res => res.json()).catch(() => null);
    currentWeek = state ? resolveOperationalWeek(state) : null;
  }
  if (!Number.isFinite(currentWeek)) throw new Error("Semaine NFL courante introuvable (Sleeper /state/nfl).");

  const [projections, games, values] = await Promise.all([
    getWeeklyProjections({ week: currentWeek, fetchImpl }).catch(() => ({})),
    getSchedule({ fetchImpl }).catch(() => []),
    loadPlayerValues({ fetchImpl, week: currentWeek, playerIds: requested }).catch(() => ({ byId: new Map() }))
  ]);
  const statsByWeek = [];
  for (let w = 1; w < currentWeek; w++) {
    try { statsByWeek.push({ week: w, stats: await getWeeklyStats({ week: w, fetchImpl }) }); } catch {}
  }
  const opponents = buildOpponents(games);
  const dvp = buildDefenseVsPosition(statsByWeek, {
    teamOf: id => index.get(id)?.nflTeam || null,
    positionOf: id => index.get(id)?.position || null,
    opponents
  });
  const players = requested.map(id => {
    const meta = index.get(id) || {};
    const value = values.byId.get(id) || {};
    const projection = projections?.[id]?.pts_ppr;
    return {
      sleeperId: id,
      name: meta.name || `Player #${id}`,
      position: meta.position || null,
      nflTeam: meta.nflTeam || null,
      injuryStatus: meta.injuryStatus || null,
      starter: starterIds.has(id),
      projection: Number.isFinite(projection) && !["Out", "IR", "PUP", "Sus", "NA", "Doubtful"].includes(meta.injuryStatus) ? Number(projection.toFixed(1)) : (["Out", "IR", "PUP", "Sus", "NA"].includes(meta.injuryStatus) ? 0 : null),
      rosPpg: value.rosPpg ?? null,
      usageScore: value.usageScore ?? null,
      signal: value.signal ?? null,
      matchup: meta.nflTeam ? matchupFor({ team: meta.nflTeam, position: meta.position, week: currentWeek, opponents, dvp }) : null
    };
  });
  return { week: currentWeek, team, completedWeeks: statsByWeek.map(entry => entry.week), players };
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
