#!/usr/bin/env node
/**
 * Adineu Fantasy — Analyseur de Trades pour n8n & CLI
 *
 * Usage :
 *   node scripts/analyze-trades.js
 *   node scripts/analyze-trades.js --team=t0z
 *   node scripts/analyze-trades.js --team=all
 *   node scripts/analyze-trades.js --json
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { diagnoseRoster, findTradeProposals } from "../public/assets/trade-recommender.js";

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

export async function analyzeTrades({
  team = "t0z",
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL
} = {}) {
  const normalizedTeam = String(team).trim().toLowerCase();
  const playerMap = await loadPlayerCatalog(catalogUrl);
  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl })
  ]);
  const userById = new Map(users.map(user => [user.user_id, user]));

  const formattedRosters = rosters.map(roster => {
    const user = userById.get(roster.owner_id);
    const ownerName = user?.display_name || `Manager ${roster.roster_id}`;
    const teamName = user?.metadata?.team_name || ownerName;
    return {
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      ownerName,
      name: teamName,
      players: (roster.players || []).map(playerId => playerMap.get(playerId) || {
        sleeperId: playerId,
        name: `Player #${playerId}`,
        position: "FLEX"
      })
    };
  });

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
        playerCatalog: playerMap
      })
    };
  });

  return { generatedAt: new Date().toISOString(), results };
}

function formatPlayers(players) {
  return players.map(player => `${player.name} (${player.position})`).join(" + ");
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
        proposal.category === "WIN_WIN" ? "🤝" : "⚡";
      lines.push(
        "",
        `${index + 1}. ${icon} ${proposal.partnerName} — ${proposal.evaluation.label}`,
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
