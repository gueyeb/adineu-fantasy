#!/usr/bin/env node
/**
 * Adineu Fantasy — Analyseur de Trades pour n8n & CLI
 *
 * Usage :
 *   node scripts/analyze-trades.js
 *   node scripts/analyze-trades.js --team=t0z
 *   node scripts/analyze-trades.js --team=all
 *   node scripts/analyze-trades.js --json
 *   node scripts/analyze-trades.js --give=5859 --receive=4046,12519   (une offre précise)
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { diagnoseRoster, findTradeProposals } from "../public/assets/trade-recommender.js";
import { scoreTradeRecommendation, tradeReturnScenarios } from "../public/assets/trade-score.js";
import { resolveOperationalWeek } from "../public/assets/nfl-week.js";
import { usageAdjustedRosPpg, projectedRosOnly } from "../public/assets/rest-of-season.js";
import { BYE_WEEKS_2026, GENERAL_SETTINGS_2026 } from "../public/assets/league-settings.js";
import { buildLiveMarketValues } from "../public/assets/trade-value.js";
import { getInjuryStatuses, getPlayersIndex, getUsageReport, getWeeklyProjections } from "./league-context.js";

export const DEFAULT_SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_CATALOG_URL = new URL("../public/data/players-catalog.json", import.meta.url);

async function sleeperGet(path, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${SLEEPER_API}${path}`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Sleeper API ${path} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function loadPlayerCatalog(catalogUrl = DEFAULT_CATALOG_URL) {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const playerMap = new Map();
  for (const player of catalog.players || []) {
    playerMap.set(player.sleeperId, player);
    playerMap.set(player.name, player);
  }
  return playerMap;
}

/**
 * Valeurs joueur partagées par le Trade Finder (page), /api/trades et n8n : valeur reste de saison
 * (projections Sleeper sur 2 semaines puis mélange avec le xFP d'usage, rest-of-season.js) et
 * signaux d'usage. Une seule source pour que la page et le bulletin calculent la même chose.
 */
export async function loadPlayerValues({ leagueId = DEFAULT_SLEEPER_LEAGUE_ID, fetchImpl = fetch, week = null, season = "2026", playerMap = null, playerIds = null } = {}) {
  if (!Number.isFinite(week)) {
    try {
      const nflState = await sleeperGet("/state/nfl", { fetchImpl });
      week = resolveOperationalWeek(nflState);
      season = nflState?.season || season;
    } catch { week = 1; }
  }
  const catalog = playerMap || await loadPlayerCatalog();
  const projectionsByWeek = {};
  await Promise.all(Array.from({ length: Math.max(0, GENERAL_SETTINGS_2026.playoffWeekStart - week) }, (_, index) => week + index).map(async w => {
    try { projectionsByWeek[w] = await getWeeklyProjections({ week: w, season, fetchImpl }); } catch {}
  }));
  let usageById = new Map();
  try {
    const usage = await getUsageReport({ leagueId, fetchImpl });
    usageById = new Map(usage.players.map(player => [player.playerId, player]));
  } catch {}
  let ids = playerIds;
  if (!ids) {
    const rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
    ids = rosters.flatMap(roster => roster.players || []);
  }
  // Players drafted or signed after the pre-draft catalog still have a position and team in Sleeper.
  const index = await getPlayersIndex({ fetchImpl }).catch(() => new Map());
  const infoOf = playerId => catalog.get(playerId) || index.get(playerId) || {};
  const byId = new Map();
  for (const playerId of ids) {
    const info = infoOf(playerId);
    const usage = usageById.get(playerId);
    // Same rule as the waiver engine: a player Sleeper does not project keeps the catalog-based
    // estimate (with its injury discount) instead of a value built from past volume alone.
    const ros = projectedRosOnly(usageAdjustedRosPpg({ playerId, position: info.position, nflTeam: info.nflTeam, projectionsByWeek, week, xfp: usage?.xfp }));
    const values = {};
    if (ros) { values.rosPpg = ros.ppg; values.rosSource = ros.source; }
    if (usage) {
      values.usageScore = usage.usageScore;
      values.usageTrend = usage.trend;
      values.xfp = usage.xfp;
      values.actualPpg = usage.ppg;
      values.usageGap = usage.gap;
      values.signal = usage.signal;
    }
    byId.set(playerId, values);
  }
  // Live market value (value over replacement on the rostered pool), replacing the pre-draft rank.
  // A market values a player per game: rosPpg averages a remaining bye in as 0 (right for lineup
  // gains), so the market reads the rate over the games he actually plays.
  const remaining = Math.max(1, GENERAL_SETTINGS_2026.playoffWeekStart - week);
  const perGame = (rosPpg, nflTeam) => {
    const bye = BYE_WEEKS_2026[nflTeam];
    return Number.isFinite(rosPpg) && bye >= week && bye < GENERAL_SETTINGS_2026.playoffWeekStart && remaining > 1 ? rosPpg * remaining / (remaining - 1) : rosPpg;
  };
  const { values: market } = buildLiveMarketValues([...byId].map(([playerId, values]) => ({ playerId, position: infoOf(playerId).position, rosPpg: perGame(values.rosPpg, infoOf(playerId).nflTeam) })));
  for (const [playerId, entry] of market) Object.assign(byId.get(playerId), entry, { marketSource: "LIVE_VALUE_OVER_REPLACEMENT" });
  return { week, byId, weeklyProjections: projectionsByWeek[week] || {}, projectionsByWeek };
}

/** Live rosters with every player's catalog info, injury status, projection, rest-of-season and
 * market value, and past weekly scores: the shared input of the Trade Finder and of one offer. */
async function loadLeagueRosters({ leagueId = DEFAULT_SLEEPER_LEAGUE_ID, fetchImpl = fetch, catalogUrl = DEFAULT_CATALOG_URL, getStatuses = getInjuryStatuses } = {}) {
  const playerMap = await loadPlayerCatalog(catalogUrl);
  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl })
  ]);
  const userById = new Map(users.map(user => [user.user_id, user]));

  // Récupération facultative de l'état NFL, des projections et des scores hebdomadaires
  let currentWeek = 1;
  let season = "2026";
  try {
    const nflState = await sleeperGet("/state/nfl", { fetchImpl });
    currentWeek = resolveOperationalWeek(nflState);
    season = nflState?.season || "2026";
  } catch {}

  const playerValues = await loadPlayerValues({ leagueId, fetchImpl, week: currentWeek, season, playerMap });
  const weeklyProjections = playerValues.weeklyProjections;

  // Statuts blessure Sleeper (Out/IR…) : sans eux, un joueur blessé n'a juste « pas de projection ».
  let injuryStatuses = new Map();
  try {
    injuryStatuses = await getStatuses({ fetchImpl });
  } catch {}

  const playerWeeklyScores = new Map();
  // Ne collecter que les semaines terminées ou en cours ayant des points effectifs (> 0)
  for (let w = 1; w <= currentWeek; w++) {
    try {
      const matchups = await sleeperGet(`/league/${leagueId}/matchups/${w}`, { fetchImpl });
      const weekHasRealPoints = (matchups || []).some(m => (m.points || 0) > 0);
      if (!weekHasRealPoints) continue;

      for (const m of matchups || []) {
        for (const [pid, pts] of Object.entries(m.players_points || {})) {
          if (typeof pts === "number") {
            if (!playerWeeklyScores.has(pid)) playerWeeklyScores.set(pid, []);
            playerWeeklyScores.get(pid).push(pts);
          }
        }
      }
    } catch {}
  }

  const formattedRosters = rosters.map(roster => {
    const user = userById.get(roster.owner_id);
    const ownerName = user?.display_name || `Manager ${roster.roster_id}`;
    const teamName = user?.metadata?.team_name || ownerName;
    return {
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      ownerName,
      name: teamName,
      players: (roster.players || []).map(playerId => {
        const catalogPlayer = playerMap.get(playerId);
        const player = catalogPlayer
          ? { ...catalogPlayer }
          : { sleeperId: playerId, name: `Player #${playerId}`, position: "FLEX" };

        const injuryStatus = injuryStatuses.get(playerId);
        if (injuryStatus) player.injuryStatus = injuryStatus;

        const proj = weeklyProjections[playerId];
        if (proj && typeof proj.pts_ppr === "number") {
          player.projectedPpg = Number(proj.pts_ppr.toFixed(1));
        }

        Object.assign(player, playerValues.byId.get(playerId) || {});

        const scores = playerWeeklyScores.get(playerId) || [];
        if (scores.length > 0) {
          player.weeklyScores = scores;
          player.gamesPlayed = scores.length;
          player.actualPpg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
        }

        return player;
      })
    };
  });

  return { formattedRosters, currentWeek, playerMap, playerValues };
}

export async function analyzeTrades({
  team = "t0z",
  playerPreferences = {},
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL,
  getStatuses = getInjuryStatuses
} = {}) {
  const normalizedTeam = String(team).trim().toLowerCase();
  const { formattedRosters, currentWeek, playerMap } = await loadLeagueRosters({ leagueId, fetchImpl, catalogUrl, getStatuses });

  let targets;
  if (normalizedTeam === "all") {
    targets = formattedRosters;
  } else {
    const target = formattedRosters.find(roster =>
      roster.ownerName.toLowerCase() === normalizedTeam ||
      roster.name.toLowerCase() === normalizedTeam ||
      String(roster.roster_id) === normalizedTeam
    );
    if (!target) {
      throw new Error(`Équipe Sleeper inconnue : ${team}`);
    }
    targets = [target];
  }

  const results = targets.map(target => {
    const diagnosis = diagnoseRoster(target.players);
    return {
      rosterId: target.roster_id,
      owner: target.ownerName,
      teamName: target.name,
      diagnosis: {
        counts: diagnosis.counts,
        surpluses: diagnosis.surpluses,
        deficits: diagnosis.deficits
      },
      proposals: findTradeProposals({
        targetRosterId: target.roster_id,
        rosters: formattedRosters,
        playerCatalog: playerMap,
        playerPreferences,
        currentWeek
      })
    };
  });

  return { generatedAt: new Date().toISOString(), week: currentWeek, results };
}

/**
 * One concrete offer (received, sent or imagined): `give` = ids leaving the first roster, `receive`
 * = ids leaving the second. Rosters are found from the ids — never guessed. Returns the season
 * average deltas of the Trade Finder plus the week-by-week return scenarios, so a pending Sleeper
 * offer (not exposed by the public API) can be checked in one call.
 */
export async function evaluateTradeOffer({ give = [], receive = [], leagueId = DEFAULT_SLEEPER_LEAGUE_ID, fetchImpl = fetch, catalogUrl = DEFAULT_CATALOG_URL, getStatuses = getInjuryStatuses } = {}) {
  const giveIds = give.map(String), receiveIds = receive.map(String);
  if (!giveIds.length || !receiveIds.length) throw new Error("Offre incomplète : give et receive requis");
  const { formattedRosters, currentWeek, playerValues } = await loadLeagueRosters({ leagueId, fetchImpl, catalogUrl, getStatuses });
  const ownerOf = ids => {
    const owners = new Set(ids.map(id => formattedRosters.find(roster => roster.players.some(player => String(player.sleeperId) === id))?.roster_id ?? null));
    if (owners.has(null) || owners.size !== 1) throw new Error("Offre invalide : chaque côté doit venir d'un seul roster de la ligue");
    return formattedRosters.find(roster => roster.roster_id === [...owners][0]);
  };
  const mine = ownerOf(giveIds), theirs = ownerOf(receiveIds);
  if (mine.roster_id === theirs.roster_id) throw new Error("Offre invalide : les deux côtés viennent du même roster");
  const pick = (roster, ids) => roster.players.filter(player => ids.includes(String(player.sleeperId)));
  const args = { myPlayers: mine.players, theirPlayers: theirs.players, give: pick(mine, giveIds), receive: pick(theirs, receiveIds), week: currentWeek };
  const season = scoreTradeRecommendation(args);
  const brief = player => ({ id: String(player.sleeperId), name: player.name, position: player.position, injuryStatus: player.injuryStatus || null, rosPpg: player.rosPpg ?? null, marketValue: player.marketValue ?? null });
  return {
    week: currentWeek,
    mine: { rosterId: mine.roster_id, team: mine.name, gives: args.give.map(brief) },
    theirs: { rosterId: theirs.roster_id, team: theirs.name, gives: args.receive.map(brief) },
    seasonAverage: { myDeltaPerWeek: season.my_lineup_delta, theirDeltaPerWeek: season.their_lineup_delta, confidence: season.confidence, notes: season.notes },
    market: season.market_value,
    scenarios: tradeReturnScenarios({ ...args, projectionsByWeek: playerValues.projectionsByWeek || {} })
  };
}

/** Plain-text verdict for the CLI and n8n. */
export function formatTradeOffer(result) {
  const names = side => side.gives.map(player => `${player.name}${player.injuryStatus ? ` (${player.injuryStatus})` : ""}`).join(" + ");
  const { scenarios } = result;
  const lines = [
    `Offre S${result.week} : ${result.mine.team} donne ${names(result.mine)} · ${result.theirs.team} donne ${names(result.theirs)}`,
    `Moyenne reste de saison : ${result.mine.team} ${signed(result.seasonAverage.myDeltaPerWeek)} pts/sem · ${result.theirs.team} ${signed(result.seasonAverage.theirDeltaPerWeek)} pts/sem (lineup optimale)`,
    `Semaine par semaine S${scenarios.weeks?.from}–S${scenarios.weeks?.to} :`,
    ...scenarios.scenarios.map(row => `• ${row.label}${Object.keys(row.returnWeeks).length ? ` (${Object.entries(row.returnWeeks).map(([name, week]) => `${name} S${week}`).join(", ")})` : ""} : ${result.mine.team} ${signed(row.myTotal)} pts · ${result.theirs.team} ${signed(row.theirTotal)} pts`),
    `Marché (valeur au-dessus du remplacement, pas ta lineup) : ${result.market.give} ↔ ${result.market.receive}`,
    ...scenarios.evidence.emptySlotWeeks.map(row => `⚠ ${row.team === "mine" ? result.mine.team : result.theirs.team} S${row.week} : ${row.slots.join(", ")} à 0 d'un seul côté de l'échange (bye/absent sans remplaçant) — l'écart inclut un streamer qu'on ajouterait de toute façon.`),
    `Preuve ${scenarios.evidence.quality}${scenarios.evidence.projectionGaps.length ? ` · semaines sans projection Sleeper comblées par le rythme sain : ${scenarios.evidence.projectionGaps.join(", ")}` : ""} · ${scenarios.evidence.notes.join(" ")}`
  ];
  return lines.join("\n");
}

const signed = value => `${value > 0 ? "+" : ""}${value}`;

function formatPlayers(players) {
  return players.map(player => {
    const metrics = [];
    if (typeof player.projectedPpg === "number") metrics.push(`Proj: ${player.projectedPpg}`);
    if (typeof player.actualPpg === "number") metrics.push(`Réel: ${player.actualPpg}`);
    const metricsStr = metrics.length > 0 ? ` · ${metrics.join(" | ")}` : "";
    return `${player.name} (${player.position}${metricsStr})`;
  }).join(" + ");
}

export function formatTradeBulletin(analysis, { proposalLimit = 5 } = {}) {
  const bulletins = analysis.results.map(result => {
    const lines = [
      `🏈 BULLETIN TRADES ADINEU — ${result.teamName.toUpperCase()} (@${result.owner})`,
      "",
      "📊 Diagnostic",
      `• Surplus : ${result.diagnosis.surpluses.join(", ") || "Équilibré"}`,
      `• Déficits : ${result.diagnosis.deficits.join(", ") || "Aucun"}`,
      "",
      `💡 ${result.proposals.length} opportunité(s) détectée(s)`
    ];

    if (result.proposals.length === 0) {
      lines.push("Aucun trade équitable évident pour l'instant.");
    }

    result.proposals.slice(0, proposalLimit).forEach((proposal, index) => {
      const icon = proposal.category === "HANDCUFF_INSURANCE" ? "🔒" :
        proposal.category === "WIN_WIN" ? "🤝" : proposal.category === "LINEUP_UPGRADE" ? "📈" : "⚡";
      const weeklyDiff = proposal.targetWeeklyGain;
      const weeklyStr = (typeof weeklyDiff === "number" && weeklyDiff !== 0)
        ? ` (Diff hebdo: ${weeklyDiff > 0 ? "+" : ""}${weeklyDiff} pts/sem)`
        : "";

      lines.push(
        "",
        `${index + 1}. ${icon} ${proposal.partnerName} — ${proposal.evaluation.label}${weeklyStr}`,
        `Tu donnes : ${formatPlayers(proposal.give)}`,
        `Tu reçois : ${formatPlayers(proposal.receive)}`,
        `Pourquoi : ${proposal.pitchTarget}`
      );
    });

    return lines.join("\n");
  });

  return bulletins.join("\n\n────────────────────\n\n").slice(0, 3900);
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const team = (args.find(arg => arg.startsWith("--team=")) || "--team=t0z").split("=")[1];
  const ids = flag => (args.find(arg => arg.startsWith(`--${flag}=`)) || "").split("=")[1]?.split(",").filter(Boolean) || [];
  if (ids("give").length || ids("receive").length) {
    const offer = await evaluateTradeOffer({ give: ids("give"), receive: ids("receive") });
    console.log(isJson ? JSON.stringify({ ...offer, message: formatTradeOffer(offer) }, null, 2) : formatTradeOffer(offer));
    return;
  }
  const analysis = await analyzeTrades({ team });

  if (isJson) {
    console.log(JSON.stringify({ ...analysis, message: formatTradeBulletin(analysis) }, null, 2));
  } else {
    console.log(formatTradeBulletin(analysis));
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch(error => {
    console.error("Erreur d'exécution :", error.message);
    process.exitCode = 1;
  });
}
