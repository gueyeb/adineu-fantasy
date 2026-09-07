/**
 * Adineu Fantasy — Moteur de Recommandation de Trades Bilatéraux
 *
 * Analyse les 12 rosters de la ligue pour identifier :
 * 1. Les asymétries de besoins (surplus WR vs déficit RB, et inversement)
 * 2. Les effets de levier sur les menottes (ex: propriétaire de Braelon Allen vs propriétaire de Breece Hall)
 * 3. Les propositions d'échange équitables avec argumentaires bilatéraux
 */

import { calculatePlayerTradeValue, evaluateTrade } from "./trade-value.js";

export const KNOWN_HANDCUFFS = [
  { starter: "Breece Hall", handcuff: "Braelon Allen", nflTeam: "NYJ" },
  { starter: "Jeremiyah Love", handcuff: "Tyler Allgeier", nflTeam: "ARI" },
  { starter: "James Cook", handcuff: "Ray Davis", nflTeam: "BUF" }
];

function isCurrentHandcuffPair(link, starterPlayer, handcuffPlayer) {
  const expectedTeam = link.nflTeam.toUpperCase();
  return starterPlayer?.nflTeam?.toUpperCase() === expectedTeam &&
    handcuffPlayer?.nflTeam?.toUpperCase() === expectedTeam;
}

/**
 * Évalue la santé d'un roster : compte, qualité par poste, surplus et déficits.
 * @param {Array<Object>} players Liste des joueurs du roster
 * @returns {Object} Diagnostic du roster
 */
export function diagnoseRoster(players = []) {
  const valuedPlayers = players.map(p => ({
    ...p,
    value: calculatePlayerTradeValue(p)
  }));

  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of valuedPlayers) {
    const pos = (p.position || "").toUpperCase();
    if (byPos[pos]) {
      byPos[pos].push(p);
    }
  }

  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.value - a.value);
  }

  const surpluses = [];
  const deficits = [];

  // 1. Diagnostic QB (1QB League)
  if (byPos.QB.filter(q => q.value >= 16).length >= 2) {
    surpluses.push("QB");
  } else if (byPos.QB.length === 0 || (byPos.QB[0] && byPos.QB[0].value < 16)) {
    deficits.push("QB");
  }

  // 2. Diagnostic RB (Besoin de 2 starters + flex)
  // En fantasy, on n'a jamais trop de RBs. Si moins de 2 RBs au-dessus de 25, besoin de renfort.
  if (byPos.RB.filter(r => r.value >= 25).length >= 3 || byPos.RB.filter(r => r.value >= 15).length >= 5) {
    surpluses.push("RB");
  } else if (byPos.RB.length <= 4 || byPos.RB.filter(r => r.value >= 25).length < 2) {
    deficits.push("RB");
  }

  // 3. Diagnostic WR (Besoin de 2 starters + flex en PPR)
  if (byPos.WR.filter(w => w.value >= 30).length >= 3 || byPos.WR.filter(w => w.value >= 14).length >= 4) {
    surpluses.push("WR");
  } else if (byPos.WR.length < 3 || byPos.WR.filter(w => w.value >= 20).length < 2) {
    deficits.push("WR");
  }

  // 4. Diagnostic TE
  if (byPos.TE.filter(t => t.value >= 25).length >= 2) {
    surpluses.push("TE");
  } else if (byPos.TE.length === 0 || (byPos.TE[0] && byPos.TE[0].value < 12)) {
    deficits.push("TE");
  }

  return {
    players: valuedPlayers,
    byPos,
    counts: {
      QB: byPos.QB.length,
      RB: byPos.RB.length,
      WR: byPos.WR.length,
      TE: byPos.TE.length
    },
    surpluses,
    deficits
  };
}

/**
 * Trouve les meilleures propositions de trade pour une équipe donnée.
 *
 * @param {Object} options
 * @param {string|number} options.targetRosterId ID de l'équipe ciblée (utilisateur)
 * @param {Array<Object>} options.rosters Liste des 12 rosters
 * @param {Map<string, Object>|Object} options.playerCatalog Map ou dict des joueurs par ID ou nom
 * @returns {Array<Object>} Propositions de trades triées par pertinence
 */
export function findTradeProposals({ targetRosterId, rosters = [], playerCatalog = {} }) {
  const getPlayerInfo = (idOrName) => {
    if (playerCatalog instanceof Map) {
      return playerCatalog.get(idOrName) || { name: idOrName };
    }
    return playerCatalog[idOrName] || { name: idOrName };
  };

  const targetRosterRaw = rosters.find(r => String(r.roster_id) === String(targetRosterId));
  if (!targetRosterRaw) return [];

  const targetPlayers = (targetRosterRaw.players || []).map(p => {
    const info = typeof p === "string" ? getPlayerInfo(p) : p;
    return { ...info, sleeperId: info.sleeperId || p };
  });

  const targetDiag = diagnoseRoster(targetPlayers);
  const targetPlayerNames = new Set(targetPlayers.map(p => p.name));

  const proposals = [];

  // Les positions recherchées par target (déficits prioritaires + positions d'impact RB/QB)
  const targetWants = Array.from(new Set([...targetDiag.deficits, "RB", "QB"])).filter(
    pos => !targetDiag.surpluses.includes(pos)
  );

  for (const partnerRosterRaw of rosters) {
    if (String(partnerRosterRaw.roster_id) === String(targetRosterId)) continue;

    const partnerPlayers = (partnerRosterRaw.players || []).map(p => {
      const info = typeof p === "string" ? getPlayerInfo(p) : p;
      return { ...info, sleeperId: info.sleeperId || p };
    });

    const partnerDiag = diagnoseRoster(partnerPlayers);
    const partnerName = partnerRosterRaw.name || partnerRosterRaw.ownerName || `Team ${partnerRosterRaw.roster_id}`;
    const partnerPlayerNames = new Set(partnerPlayers.map(p => p.name));

    // A. DÉTECTION DES LEVIERS MENOTTES (Handcuffs)
    for (const link of KNOWN_HANDCUFFS) {
      if (targetPlayerNames.has(link.handcuff) && partnerPlayerNames.has(link.starter)) {
        const handcuffPlayer = targetPlayers.find(p => p.name === link.handcuff);
        const starterPlayer = partnerPlayers.find(p => p.name === link.starter);
        if (!isCurrentHandcuffPair(link, starterPlayer, handcuffPlayer)) continue;

        for (const wantPos of targetWants) {
          const candidateReceives = (partnerDiag.byPos[wantPos] || []).filter(
            p => p.name !== link.starter
          );

          for (const receiveP of candidateReceives) {
            // 1-for-1
            const eval1 = evaluateTrade({ sideA: [handcuffPlayer], sideB: [receiveP] });
            if (eval1.verdict === "FAIR" || eval1.verdict === "SLIGHT_ADVANTAGE_A" || eval1.verdict === "SLIGHT_ADVANTAGE_B") {
              proposals.push({
                id: `hc-1-${link.handcuff}-${receiveP.name}`,
                partnerRosterId: partnerRosterRaw.roster_id,
                partnerName,
                category: "HANDCUFF_INSURANCE",
                title: `Sécurité Menotte : ${link.handcuff} pour ${link.starter}`,
                give: [handcuffPlayer],
                receive: [receiveP],
                evaluation: eval1,
                pitchTarget: `Tu valorises la menotte ${link.handcuff} pour obtenir ${receiveP.name} (${receiveP.position}), renforçant ton effectif.`,
                pitchPartner: `${partnerName} sécurise à 100% son joueur franchise ${link.starter} contre toute blessure.`,
                score: 88 - Math.abs(eval1.diff)
              });
            }

            // 2-for-1 package avec un surplus de Target
            for (const surplusPos of targetDiag.surpluses) {
              const extraGives = (targetDiag.byPos[surplusPos] || []).filter(
                p => p.name !== handcuffPlayer.name
              );
              for (const extraGive of extraGives) {
                const eval2 = evaluateTrade({ sideA: [handcuffPlayer, extraGive], sideB: [receiveP] });
                if (eval2.verdict === "FAIR" || eval2.verdict === "SLIGHT_ADVANTAGE_A" || eval2.verdict === "SLIGHT_ADVANTAGE_B") {
                  proposals.push({
                    id: `hc-2-${link.handcuff}-${extraGive.name}-${receiveP.name}`,
                    partnerRosterId: partnerRosterRaw.roster_id,
                    partnerName,
                    category: "HANDCUFF_INSURANCE",
                    title: `Package Menotte : ${link.handcuff} + ${extraGive.name} contre ${receiveP.name}`,
                    give: [handcuffPlayer, extraGive],
                    receive: [receiveP],
                    evaluation: eval2,
                    pitchTarget: `Package ta menotte ${link.handcuff} et ton surplus ${extraGive.name} pour upgrader ton poste ${receiveP.position} avec ${receiveP.name}.`,
                    pitchPartner: `${partnerName} protège ${link.starter} tout en recevant un renfort titulaire direct (${extraGive.name}).`,
                    score: 92 - Math.abs(eval2.diff)
                  });
                }
              }
            }
          }
        }
      }
    }

    // B. COMPLÉMENTARITÉ PURE (WIN-WIN) & CONSOLIDATION
    for (const givePos of targetDiag.surpluses) {
      for (const receivePos of targetWants) {
        const giveCandidates = targetDiag.byPos[givePos] || [];
        const receiveCandidates = partnerDiag.byPos[receivePos] || [];

        for (const giveP of giveCandidates) {
          for (const receiveP of receiveCandidates) {
            // 1-for-1
            const eval1 = evaluateTrade({ sideA: [giveP], sideB: [receiveP] });
            if (eval1.verdict === "FAIR" || eval1.verdict === "SLIGHT_ADVANTAGE_A" || eval1.verdict === "SLIGHT_ADVANTAGE_B") {
              proposals.push({
                id: `winwin-1-${giveP.name}-${receiveP.name}`,
                partnerRosterId: partnerRosterRaw.roster_id,
                partnerName,
                category: "WIN_WIN",
                title: `Échange Poste pour Poste : ${giveP.name} (${givePos}) contre ${receiveP.name} (${receivePos})`,
                give: [giveP],
                receive: [receiveP],
                evaluation: eval1,
                pitchTarget: `Monétise ton surplus en ${givePos} (${giveP.name}) pour acquérir un titulaire en ${receivePos} (${receiveP.name}).`,
                pitchPartner: `${partnerName} comble son besoin en ${givePos} sans fragiliser son effectif en ${receivePos}.`,
                score: 82 - Math.abs(eval1.diff)
              });
            }
          }
        }

        // 2-for-1 (Target donne 2 joueurs contre 1 meilleur joueur)
        for (let i = 0; i < giveCandidates.length; i++) {
          for (let j = i + 1; j < giveCandidates.length; j++) {
            const p1 = giveCandidates[i];
            const p2 = giveCandidates[j];
            for (const receiveP of receiveCandidates) {
              const eval2 = evaluateTrade({ sideA: [p1, p2], sideB: [receiveP] });
              if (eval2.verdict === "FAIR" || eval2.verdict === "SLIGHT_ADVANTAGE_A" || eval2.verdict === "SLIGHT_ADVANTAGE_B") {
                proposals.push({
                  id: `winwin-2-${p1.name}-${p2.name}-${receiveP.name}`,
                  partnerRosterId: partnerRosterRaw.roster_id,
                  partnerName,
                  category: "CONSOLIDATION",
                  title: `Consolidation 2-pour-1 : ${p1.name} + ${p2.name} contre ${receiveP.name}`,
                  give: [p1, p2],
                  receive: [receiveP],
                  evaluation: eval2,
                  pitchTarget: `Consolide deux receveurs en un ${receiveP.position} d'élite (${receiveP.name}) pour maximiser tes points de départ.`,
                  pitchPartner: `${partnerName} transforme un titulaire en 2 excellents receveurs partants chaque semaine.`,
                  score: 84 - Math.abs(eval2.diff)
                });
              }
            }
          }
        }
      }
    }
  }

  // Trier par pertinence et dédupliquer
  const seen = new Set();
  const uniqueProposals = [];
  proposals.sort((a, b) => b.score - a.score);

  for (const p of proposals) {
    const key = `${p.partnerRosterId}:${p.give.map(g => g.name).sort().join(",")}:${p.receive.map(r => r.name).sort().join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProposals.push(p);
    }
  }

  return uniqueProposals.slice(0, 15);
}
