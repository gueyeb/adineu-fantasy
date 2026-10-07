#!/usr/bin/env node
/**
 * Adineu Fantasy — Start/Sit Advisor
 *
 * Croise le lineup d'une équipe avec le statut blessure Sleeper et les bye weeks
 * pour flaguer chaque titulaire à risque, puis propose le meilleur remplaçant
 * (banc en priorité, sinon une cible à acquérir, avec sa disponibilité et l'action du plan).
 *
 * Usage :
 *   node scripts/lineup-advisor.js --team=t0z
 */

import { groupLineupMovements } from "./lineup-movements.js";
import { pathToFileURL } from "node:url";
import { getLeagueContext, getFreeAgents, getInjuryStatuses, getPlayersIndex, getSchedule, getWeeklyProjections, getWeeklyStats, SEVERITY_BY_STATUS } from "./league-context.js";
import { loadPlayerValues } from "./analyze-trades.js";
import { buildDefenseVsPosition, buildOpponents, matchupFor } from "../public/assets/defense-vs-position.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { boomBust, recommendLineupMode } from "../public/assets/boom-bust.js";
import { estimatePregameWinProbability } from "../public/assets/win-probability.js";
import { readFile } from "node:fs/promises";

let boomBustCalibration = null;
async function loadBoomBustCalibration() {
  if (!boomBustCalibration) {
    const file = await readFile(new URL("../public/data/boom-bust-calibration.json", import.meta.url), "utf8");
    const parsed = JSON.parse(file);
    boomBustCalibration = { positions: parsed.positions, volatility: parsed.volatility || {} };
  }
  return boomBustCalibration;
}

/** Current, optimal (projection), Boom (ceilings) and Safe (floors) lineups for one roster. */
export function buildBoomSafeLineups(players, starterIds) {
  const pool = players.filter(player => Number.isFinite(player.projection));
  const lineup = key => buildProjectedLineup(pool, { estimate: player => player[key] ?? 0 });
  const totals = slots => {
    const ids = new Set(slots.map(slot => slot.sleeperId).filter(Boolean));
    const chosen = pool.filter(player => ids.has(String(player.sleeperId)));
    const sum = key => Number(chosen.reduce((total, player) => total + (player[key] ?? 0), 0).toFixed(1));
    return { projection: sum("projection"), floor: sum("floor"), ceiling: sum("ceiling") };
  };
  const pick = key => {
    const built = lineup(key);
    return { slots: built.slots.map(slot => ({ slot: slot.slot, sleeperId: slot.sleeperId, name: slot.name })), ...totals(built.slots) };
  };
  const currentSlots = pool.filter(player => starterIds.has(String(player.sleeperId))).map(player => ({ sleeperId: String(player.sleeperId) }));
  return { current: totals(currentSlots), optimal: pick("projection"), boom: pick("ceiling"), safe: pick("floor") };
}
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

// A player outside the roster is a target to acquire, never a "free agent" by default: his
// availability, the action and the bid come from the same evaluation as the waiver report.
const acquisitionView = row => ({ availability: row.availability?.availability ?? "UNKNOWN", availabilitySource: row.availability?.availabilitySource ?? "NONE",
  waiverProcessesAt: row.availability?.waiverProcessesAt ?? null, recommendedAction: row.waiver?.decision?.recommendedAction ?? row.recommendedAction ?? null,
  confirmation: row.waiver?.decision?.confirmation ?? null, suggestedBid: row.waiver?.suggestedBid ?? row.suggestedBid ?? null,
  personalMaxBid: row.waiver?.personalMaxBid ?? row.personalMaxBid ?? null });

function findReplacement(slot, bench, playerStatuses, freeAgentsByPosition, acquisitionPlan = null) {
  const fromBench = bestBenchReplacement(slot, bench, playerStatuses);
  if (fromBench) return { source: "bench", player: fromBench };
  // The plan's own step for that slot first: Start/Sit and the waiver plan name the same player.
  const positions = slot === "FLEX" ? FLEX_ELIGIBLE : [slot];
  const step = (acquisitionPlan?.steps || []).find(row => positions.includes(row.position));
  if (step) return { source: "acquisition_plan", player: { sleeperId: step.playerId, name: step.name, position: step.position, nflTeam: step.availability?.nflTeam ?? null },
    acquisition: acquisitionView(step) };
  const fromMarket = bestFreeAgentReplacement(slot, freeAgentsByPosition);
  if (fromMarket) return { source: "acquisition_target", player: fromMarket, acquisition: acquisitionView(fromMarket) };
  return null;
}

/** One sentence for every output: what to do about an alert, and how sure the model is. */
export function formatReplacement(alert) {
  const replacement = alert?.replacement;
  if (!replacement) return null;
  const name = replacement.player?.name || "n/d";
  if (replacement.source === "bench") {
    return alert.replacementRole === "FALLBACK_IF_INACTIVE"
      ? `surveiller ${alert.player?.name || "le titulaire"} ; ${name} en secours s'il est indisponible`
      : `remplaçant du banc : ${name}`;
  }
  const a = replacement.acquisition || {};
  const state = a.availabilitySource === "LEAGUE_RULES_INFERRED" ? `${a.availability} déduite — à confirmer dans Sleeper` : a.availability || "UNKNOWN";
  const action = ({ ADD_NOW: "ajout libre", CLAIM_IF_CHEAP: `claim${Number.isFinite(a.suggestedBid) ? ` ${a.suggestedBid} $` : ""}${Number.isFinite(a.personalMaxBid) ? ` (plafond ${a.personalMaxBid} $)` : ""}` })[a.recommendedAction] || "aucune action exécutable";
  return `cible à acquérir : ${name} — disponibilité ${state} ; ${action}${replacement.source === "acquisition_plan" ? " (étape du plan)" : ""}`;
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
  currentWeek = null,
  acquisitionPlan = null
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
        replacementRole: "REPLACE",
        replacement: findReplacement(starter.slot, bench, playerStatuses, freeAgentsByPosition, acquisitionPlan)
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
      // Questionable alone justifies no swap: the bench player is a fallback, not a replacement.
      replacementRole: !onBye && statusSeverity === "WATCH" ? "FALLBACK_IF_INACTIVE" : "REPLACE",
      replacement: findReplacement(starter.slot, bench, playerStatuses, freeAgentsByPosition, acquisitionPlan)
    });
  }

  for (const alert of alerts) alert.advice = formatReplacement(alert);
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
  const changes = gain > 0 ? optimal.slots.map((slot, index) => {
    const currentPlayer = current[index]?.player || null;
    const incoming = slot.sleeperId ? byId.get(String(slot.sleeperId)) : null;
    if (String(currentPlayer?.sleeperId || "") === String(incoming?.sleeperId || "")) return null;
    return {
      slot: slot.slot,
      in: incoming,
      out: currentPlayer,
      gain: Number(((incoming ? weeklyEstimate(incoming) : 0) - (currentPlayer ? weeklyEstimate(currentPlayer) : 0)).toFixed(1))
    };
  }).filter(Boolean) : [];
  return {
    currentTotal: Number(currentTotal.toFixed(1)),
    optimalTotal: optimal.total,
    gain: gain > 0 ? gain : 0,
    // Changes only when they actually gain points, and never "start" a player projected at 0 (Out/IR).
    promote: gain > 0 ? [...optimalIds].filter(id => !currentIds.has(id)).map(id => byId.get(id)).filter(player => weeklyEstimate(player) > 0) : [],
    bench: gain > 0 ? [...currentIds].filter(id => !optimalIds.has(id)).map(id => byId.get(String(id))) : [],
    changes,
    movementGroups: groupLineupMovements(changes),
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

  const [projections, games, values, calibration] = await Promise.all([
    getWeeklyProjections({ week: currentWeek, fetchImpl }).catch(() => ({})),
    getSchedule({ fetchImpl }).catch(() => []),
    loadPlayerValues({ fetchImpl, week: currentWeek, playerIds: requested }).catch(() => ({ byId: new Map() })),
    loadBoomBustCalibration().catch(() => null)
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
  }).map(player => ({ ...player, ...(boomBust({ position: player.position, projection: player.projection, calibration: calibration?.positions, injuryStatus: player.injuryStatus, volatility: calibration?.volatility?.[player.sleeperId] ?? 1 }) || {}) }));

  // Boom / Safe lineups and the recommendation for this week's matchup (team mode only).
  let lineups = null;
  if (context && calibration) {
    lineups = buildBoomSafeLineups(players, starterIds);
    const sameAs = (a, b) => a.slots.map(slot => slot.sleeperId).sort().join() === b.slots.map(slot => slot.sleeperId).sort().join();
    lineups.boomDiffers = !sameAs(lineups.boom, lineups.optimal);
    lineups.safeDiffers = !sameAs(lineups.safe, lineups.optimal);
    try {
      const response = await fetchImpl(`https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID || "1392715510830878721"}/matchups/${currentWeek}`, { signal: AbortSignal.timeout(10_000) });
      const rows = response.ok ? await response.json() : [];
      const mine = rows.find(row => row.roster_id === context.myTeam.rosterId);
      // No matchup_id yet (schedule not published / bye): no opponent rather than a wrong one.
      const opponent = mine && mine.matchup_id != null ? rows.find(row => row.matchup_id === mine.matchup_id && row.roster_id !== mine.roster_id) : null;
      if (opponent) {
        const opponentProjection = Number((opponent.starters || []).filter(id => id && id !== "0").reduce((total, id) => {
          const status = index.get(id)?.injuryStatus;
          const points = projections?.[id]?.pts_ppr;
          return total + (["Out", "IR", "PUP", "Sus", "NA"].includes(status) || !Number.isFinite(points) ? 0 : points);
        }, 0).toFixed(1));
        const chances = estimatePregameWinProbability(lineups.optimal.projection, opponentProjection);
        lineups.opponent = { rosterId: opponent.roster_id, projection: opponentProjection };
        lineups.winPct = chances?.teamA ?? null;
        lineups.recommended = recommendLineupMode(lineups.winPct);
      }
    } catch { /* no matchup published yet: recommendation simply absent */ }
  }
  return { week: currentWeek, team, completedWeeks: statsByWeek.map(entry => entry.week), players, lineups };
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
      // Same sentence as every other output: fallback vs swap, target to acquire vs bench.
      lines.push(`   ${alert.advice ? `Conseil : ${alert.advice}` : `Remplaçant conseillé (${alert.replacement.source === "bench" ? "banc" : "cible à acquérir"}) : ${describePlayer(alert.replacement.player)}`}`);
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
