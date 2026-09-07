/**
 * Adineu Fantasy — Modèle de Valeur de Trade Déterministe
 *
 * Évalue la valeur d'échange (0-100) des joueurs NFL en fonction de:
 * 1. La qualité intrinsèque (ECR / Expert Consensus Rank)
 * 2. La rareté positionnelle (RB > WR > TE élite > QB en 1QB, PPR)
 * 3. La taxe d'effectif (anti-package discount pour les échanges asymétriques 2-pour-1)
 */

export const POSITIONAL_WEIGHTS = {
  RB: 1.05,  // Prime de rareté et attrition au sol en PPR
  WR: 1.00,  // Monnaie étalon en plein PPR
  TE_ELITE: 1.15, // TEs du top 35 (avantage positionnel majeur)
  TE_MID: 0.95,   // TEs top 36-75
  TE_STREAM: 0.75,// TEs de rotation
  QB_ELITE: 0.85, // Top 3 QBs (Josh Allen, Lamar Jackson, Jalen Hurts)
  QB_STANDARD: 0.70, // Surplus en ligue 12 équipes / 1QB
  SPECIAL: 0.15   // Kicker / Défense
};

/**
 * Calcule la valeur d'échange absolue (0-100) d'un joueur.
 * @param {Object} player Objet joueur avec position, quality.expertRank ou sleeperAdp
 * @returns {number} Valeur comprise entre 1 et 100
 */
export function calculatePlayerTradeValue(player) {
  if (!player) return 0;

  const position = (player.position || "").toUpperCase();
  const rank =
    player.quality?.expertRank ??
    player.expertRank ??
    player.market?.sleeperAdp ??
    player.sleeperAdp ??
    250;

  // Kickers et Défenses : actifs de streaming, valeur symbolique
  if (position === "K" || position === "DEF") {
    return Math.max(1, Math.min(6, Math.round(6 - (rank / 50))));
  }

  // Courbe exponentielle déterministe basée sur le rang d'expert (ECR)
  // Rang 1 -> 100
  // Rang 12 -> ~78
  // Rang 24 -> ~60
  // Rang 50 -> ~34
  // Rang 100 -> ~11
  // Rang 150 -> ~4
  // Rang 200+ -> 1
  const rawBase = 100 * Math.exp(-0.022 * (Math.max(1, rank) - 1));

  let posMultiplier = POSITIONAL_WEIGHTS.WR;
  if (position === "RB") {
    posMultiplier = POSITIONAL_WEIGHTS.RB;
  } else if (position === "TE") {
    if (rank <= 35) posMultiplier = POSITIONAL_WEIGHTS.TE_ELITE;
    else if (rank <= 75) posMultiplier = POSITIONAL_WEIGHTS.TE_MID;
    else posMultiplier = POSITIONAL_WEIGHTS.TE_STREAM;
  } else if (position === "QB") {
    if (rank <= 30) posMultiplier = POSITIONAL_WEIGHTS.QB_ELITE;
    else posMultiplier = POSITIONAL_WEIGHTS.QB_STANDARD;
  }

  const adjustedValue = Math.round(rawBase * posMultiplier);
  return Math.max(1, Math.min(100, adjustedValue));
}

/**
 * Évalue un échange entre deux côtés (Side A vs Side B).
 * Intègre la taxe de place de banc (Roster Spot Tax) et la prime du meilleur joueur.
 *
 * @param {Object} options
 * @param {Array<Object>} options.sideA Joueurs cédés par A (reçus par B)
 * @param {Array<Object>} options.sideB Joueurs cédés par B (reçus par A)
 * @returns {Object} Évaluation complète avec totaux, différentiel et verdict
 */
export function evaluateTrade({ sideA = [], sideB = [] }) {
  const playersA = sideA.map(p => ({
    name: p.name,
    position: p.position,
    nflTeam: p.nflTeam || p.team,
    value: calculatePlayerTradeValue(p)
  }));

  const playersB = sideB.map(p => ({
    name: p.name,
    position: p.position,
    nflTeam: p.nflTeam || p.team,
    value: calculatePlayerTradeValue(p)
  }));

  const rawSumA = playersA.reduce((sum, p) => sum + p.value, 0);
  const rawSumB = playersB.reduce((sum, p) => sum + p.value, 0);

  const bestA = Math.max(0, ...playersA.map(p => p.value));
  const bestB = Math.max(0, ...playersB.map(p => p.value));

  let netA = rawSumA;
  let netB = rawSumB;
  let rosterTaxA = 0;
  let rosterTaxB = 0;

  const countA = playersA.length;
  const countB = playersB.length;

  // Taxe de place de banc : celui qui reçoit plus de joueurs doit couper des remplaçants
  if (countA > countB) {
    const diff = countA - countB;
    rosterTaxB = diff * 4;
    netA = Math.max(1, rawSumA - rosterTaxB);
  } else if (countB > countA) {
    const diff = countB - countA;
    rosterTaxA = diff * 4;
    netB = Math.max(1, rawSumB - rosterTaxA);
  }

  // Prime "Star Player" : deux joueurs moyens ne valent pas une superstar
  if (bestA >= bestB + 10 && countA < countB) {
    netB = Math.max(1, Math.round(netB * 0.90));
  } else if (bestB >= bestA + 10 && countB < countA) {
    netA = Math.max(1, Math.round(netA * 0.90));
  }

  const maxVal = Math.max(netA, netB, 1);
  const diffVal = netA - netB;
  const pctDiff = Math.abs(diffVal) / maxVal;

  let verdict = "FAIR";
  let label = "Échange équitable";

  if (pctDiff <= 0.08) {
    verdict = "FAIR";
    label = "Échange équitable";
  } else if (pctDiff <= 0.18) {
    if (diffVal > 0) {
      verdict = "SLIGHT_ADVANTAGE_A";
      label = "Léger avantage Team A";
    } else {
      verdict = "SLIGHT_ADVANTAGE_B";
      label = "Léger avantage Team B";
    }
  } else {
    if (diffVal > 0) {
      verdict = "UNBALANCED_A";
      label = "Déséquilibré en faveur de Team A";
    } else {
      verdict = "UNBALANCED_B";
      label = "Déséquilibré en faveur de Team B";
    }
  }

  return {
    sideA: { players: playersA, rawTotal: rawSumA, netTotal: netA, count: countA },
    sideB: { players: playersB, rawTotal: rawSumB, netTotal: netB, count: countB },
    diff: diffVal,
    pctDiff: Math.round(pctDiff * 100),
    verdict,
    label,
    starPlayer: bestA >= bestB
      ? (playersA.find(p => p.value === bestA) || null)
      : (playersB.find(p => p.value === bestB) || null)
  };
}
