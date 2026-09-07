#!/usr/bin/env node
/**
 * Adineu Fantasy — Analyseur de Trades pour n8n & CLI
 *
 * Script automatisable via n8n (Schedule Trigger -> Execute Command ou HTTP Webhook)
 * Récupère l'état live des rosters Sleeper, diagnostique les besoins et génère
 * des propositions de trades gagnant-gagnant et à effet de levier (menottes).
 *
 * Usage :
 *   node scripts/analyze-trades.js                     (bulletin Markdown pour t0z)
 *   node scripts/analyze-trades.js --team=t0z          (ciblé sur t0z)
 *   node scripts/analyze-trades.js --team=all          (bulletin complet 12 équipes)
 *   node scripts/analyze-trades.js --json              (sortie JSON pure pour n8n)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diagnoseRoster, findTradeProposals } from "../public/assets/trade-recommender.js";

const SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";

async function sleeperGet(path) {
  const res = await fetch(`${SLEEPER_API}${path}`);
  if (!res.ok) {
    throw new Error(`Sleeper API ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const teamArg = (args.find(a => a.startsWith("--team=")) || "--team=t0z").split("=")[1].toLowerCase();

  // 1. Charger le catalogue des joueurs
  const catalogPath = resolve("public/data/players-catalog.json");
  const catalogRaw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(catalogRaw);
  const playerMap = new Map();
  for (const p of catalog.players || []) {
    playerMap.set(p.sleeperId, p);
    playerMap.set(p.name, p);
  }

  // 2. Récupérer les rosters et les users depuis Sleeper
  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/rosters`),
    sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/users`)
  ]);

  const userById = new Map(users.map(u => [u.user_id, u]));

  // Normaliser les rosters
  const formattedRosters = rosters.map(r => {
    const user = userById.get(r.owner_id);
    const ownerName = user?.display_name || `Manager ${r.roster_id}`;
    const teamName = user?.metadata?.team_name || ownerName;

    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      ownerName,
      name: teamName,
      players: (r.players || []).map(pid => {
        const found = playerMap.get(pid);
        if (found) return found;
        return { sleeperId: pid, name: `Player #${pid}`, position: "FLEX" };
      })
    };
  });

  // 3. Déterminer les équipes ciblées
  let targetRosters = [];
  if (teamArg === "all") {
    targetRosters = formattedRosters;
  } else {
    const match = formattedRosters.find(
      r => r.ownerName.toLowerCase() === teamArg || r.name.toLowerCase() === teamArg || String(r.roster_id) === teamArg
    );
    if (!match) {
      // Fallback sur le premier roster si non trouvé
      targetRosters = [formattedRosters[0]];
    } else {
      targetRosters = [match];
    }
  }

  const results = [];

  for (const target of targetRosters) {
    const diag = diagnoseRoster(target.players);
    const proposals = findTradeProposals({
      targetRosterId: target.roster_id,
      rosters: formattedRosters,
      playerCatalog: playerMap
    });

    results.push({
      rosterId: target.roster_id,
      owner: target.ownerName,
      teamName: target.name,
      diagnosis: {
        counts: diag.counts,
        surpluses: diag.surpluses,
        deficits: diag.deficits
      },
      proposals
    });
  }

  // 4. Sortie JSON (pour n8n)
  if (isJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    return;
  }

  // 5. Sortie Markdown / Texte (pour Discord, Telegram, WhatsApp via n8n)
  for (const res of results) {
    console.log(`\n======================================================`);
    console.log(`🏈 BULLETIN TRADES ADINEU — ${res.teamName.toUpperCase()} (@${res.owner})`);
    console.log(`======================================================`);
    console.log(`📊 Diagnostic :`);
    console.log(`  - Surplus détectés : ${res.diagnosis.surpluses.length > 0 ? res.diagnosis.surpluses.join(", ") : "Équilibré"}`);
    console.log(`  - Déficits détectés : ${res.diagnosis.deficits.length > 0 ? res.diagnosis.deficits.join(", ") : "Aucun"}`);
    console.log(`\n💡 MEILLEURES OPPORTUNITÉS DE TRADE (${res.proposals.length} trouvées) :`);

    if (res.proposals.length === 0) {
      console.log(`  Aucun trade évident équitable trouvé pour l'instant.`);
    }

    res.proposals.slice(0, 5).forEach((p, idx) => {
      const giveNames = p.give.map(g => `${g.name} (${g.position})`).join(" + ");
      const receiveNames = p.receive.map(r => `${r.name} (${r.position})`).join(" + ");
      const categoryIcon = p.category === "HANDCUFF_INSURANCE" ? "🔒 [Menotte]" : p.category === "WIN_WIN" ? "🤝 [Win-Win]" : "⚡ [Consolidation]";

      console.log(`\n${idx + 1}. ${categoryIcon} avec ${p.partnerName} (${p.evaluation.label})`);
      console.log(`   ➡️ Tu donnes  : ${giveNames}`);
      console.log(`   ⬅️ Tu reçois : ${receiveNames}`);
      console.log(`   🎯 Pour toi   : ${p.pitchTarget}`);
      console.log(`   💬 Pour lui   : ${p.pitchPartner}`);
    });
  }
}

main().catch(err => {
  console.error("Erreur d'exécution :", err);
  process.exit(1);
});
