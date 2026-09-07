/**
 * Adineu Fantasy — Modèle de Valeur de Trade Déterministe & Dynamique
 *
 * Évalue la valeur d'échange (0-100) des joueurs NFL en fonction de:
 * 1. La qualité intrinsèque (ECR / Expert Consensus Rank ou Sleeper ADP)
 * 2. Les projections hebdomadaires (Sleeper projections, points projetés par match)
 * 3. La production réelle hebdomadaire (scores réels marqués en ligue sous les règles 2026)
 * 4. Le lissage bayésien (Bayesian Shrinkage) pondérant projections et production selon l'échantillon
 * 5. La rareté positionnelle (RB > WR > TE élite > QB en 1QB, PPR)
 * 6. La taxe d'effectif (anti-package discount pour les échanges asymétriques 2-pour-1)
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
 * Estime la projection moyenne de points par match (Full PPR) selon la position et le rang d'expert.
 * Utilisé comme ancre si aucune projection Sleeper n'est explicitement fournie.
 */
export function estimateBaselineProjectedPpg(player) {
  if (!player) return 0;
  if (typeof player.projectedPpg === "number") return player.projectedPpg;
  if (typeof player.projection?.pts_ppr === "number") return player.projection.pts_ppr;

  const position = (player.position || "").toUpperCase();
  const rank =
    player.quality?.expertRank ??
    player.expertRank ??
    player.market?.sleeperAdp ??
    player.sleeperAdp ??
    250;

  if (position === "K" || position === "DEF") {
    return Math.max(4.0, Number((8.5 - (rank / 100)).toFixed(1)));
  }

  if (position === "QB") {
    if (rank <= 30) return Number((23.0 - (rank * 0.15)).toFixed(1));
    return Number(Math.max(12.0, (18.5 - ((rank - 30) * 0.08))).toFixed(1));
  }

  if (position === "TE") {
    if (rank <= 35) return Number((15.5 - (rank * 0.14)).toFixed(1));
    if (rank <= 75) return Number((10.5 - ((rank - 35) * 0.08)).toFixed(1));
    return Number(Math.max(3.0, (7.0 - ((rank - 75) * 0.04))).toFixed(1));
  }

  // RB et WR en Full PPR
  if (rank <= 12) return Number((21.5 - (rank * 0.45)).toFixed(1));
  if (rank <= 36) return Number((16.0 - ((rank - 12) * 0.22)).toFixed(1));
  if (rank <= 70) return Number((10.8 - ((rank - 36) * 0.12)).toFixed(1));
  if (rank <= 120) return Number((6.8 - ((rank - 70) * 0.06)).toFixed(1));
  return Number(Math.max(1.0, (3.8 - ((rank - 120) * 0.03))).toFixed(1));
}

/**
 * Calcule le profil complet de trade d'un joueur, intégrant projections, production réelle et momentum.
 *
 * @param {Object} player
 * @param {Object} [options]
 * @param {number} [options.shrinkageK=4] Constante d'échantillon pour le lissage bayésien
 * @returns {Object} Profil complet { tradeValue, projectedPpg, actualPpg, blendedPpg, gamesPlayed, weeklyScores, trend, signal, weightActual }
 */
export function calculatePlayerTradeProfile(player, options = {}) {
  if (!player) {
    return {
      tradeValue: 0,
      projectedPpg: 0,
      actualPpg: null,
      blendedPpg: 0,
      gamesPlayed: 0,
      weeklyScores: [],
      trend: "N/A",
      signal: "NONE",
      weightActual: 0
    };
  }

  const position = (player.position || "").toUpperCase();
  const rank =
    player.quality?.expertRank ??
    player.expertRank ??
    player.market?.sleeperAdp ??
    player.sleeperAdp ??
    250;

  // 1. Kickers et Défenses : streaming
  if (position === "K" || position === "DEF") {
    const kVal = Math.max(1, Math.min(6, Math.round(6 - (rank / 50))));
    const projectedPpg = estimateBaselineProjectedPpg(player);
    const actualPpg = typeof player.actualPpg === "number" ? player.actualPpg : null;
    return {
      tradeValue: kVal,
      projectedPpg,
      actualPpg,
      blendedPpg: actualPpg ?? projectedPpg,
      gamesPlayed: player.gamesPlayed ?? (actualPpg !== null ? 1 : 0),
      weeklyScores: Array.isArray(player.weeklyScores) ? player.weeklyScores : [],
      trend: "STABLE",
      signal: "BASELINE",
      weightActual: 0
    };
  }

  // 2. Base statique ECR/ADP
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
  const baseValue = Math.round(rawBase * posMultiplier);

  // 3. Projections & Production réelle hebdomadaire
  const projectedPpg = estimateBaselineProjectedPpg(player);

  let weeklyScores = [];
  let gamesPlayed = 0;
  let actualPpg = null;

  if (Array.isArray(player.weeklyScores) && player.weeklyScores.length > 0) {
    weeklyScores = player.weeklyScores;
    gamesPlayed = player.gamesPlayed ?? weeklyScores.length;
    actualPpg = Number((weeklyScores.reduce((sum, s) => sum + s, 0) / weeklyScores.length).toFixed(1));
  } else if (typeof player.actualPpg === "number") {
    actualPpg = Number(player.actualPpg.toFixed(1));
    gamesPlayed = player.gamesPlayed ?? 1;
    weeklyScores = [actualPpg];
  }

  // 4. Lissage Bayésien (Shrinkage Model)
  const shrinkageK = options.shrinkageK ?? 4;
  let blendedPpg = projectedPpg;
  let weightActual = 0;

  if (actualPpg !== null && gamesPlayed > 0) {
    weightActual = gamesPlayed / (gamesPlayed + shrinkageK);
    blendedPpg = Number(((1 - weightActual) * projectedPpg + weightActual * actualPpg).toFixed(1));
  }

  // 5. Détection de momentum / tendance (Trend)
  let trend = "N/A";
  if (weeklyScores.length >= 2) {
    const recent = weeklyScores.slice(-2);
    const recentAvg = recent.reduce((sum, s) => sum + s, 0) / recent.length;
    const ratio = recentAvg / Math.max(actualPpg || 1, 1);
    if (ratio >= 1.10) trend = "UP";
    else if (ratio <= 0.90) trend = "DOWN";
    else trend = "STABLE";
  } else if (gamesPlayed === 1) {
    trend = "STABLE";
  }

  // 6. Détection de signal Buy-Low / Sell-High
  let signal = "BASELINE";
  if (actualPpg !== null && gamesPlayed >= 1) {
    const ppgGap = actualPpg - projectedPpg;
    if (ppgGap <= -3.5) signal = "BUY_LOW";
    else if (ppgGap >= 4.0) signal = "SELL_HIGH";
    else signal = "FAIR_VALUE";
  }

  // 7. Ajustement dynamique de la valeur de trade
  let tradeValue = baseValue;
  if (actualPpg !== null && gamesPlayed > 0) {
    const delta = blendedPpg - projectedPpg;
    const dynamicAdjustment = Math.round(delta * 2.5 * posMultiplier);
    tradeValue = Math.max(1, Math.min(100, baseValue + dynamicAdjustment));
  } else {
    tradeValue = Math.max(1, Math.min(100, baseValue));
  }

  return {
    tradeValue,
    projectedPpg,
    actualPpg,
    blendedPpg,
    gamesPlayed,
    weeklyScores,
    trend,
    signal,
    weightActual: Number((weightActual * 100).toFixed(0))
  };
}

/**
 * Calcule la valeur d'échange absolue (0-100) d'un joueur.
 * @param {Object} player Objet joueur
 * @param {Object} [options]
 * @returns {number} Valeur comprise entre 1 et 100
 */
export function calculatePlayerTradeValue(player, options = {}) {
  return calculatePlayerTradeProfile(player, options).tradeValue;
}

/**
 * Évalue un échange entre deux côtés (Side A vs Side B).
 * Intègre la taxe de place de banc (Roster Spot Tax), la prime du meilleur joueur,
 * ainsi que les différentiels de points hebdomadaires (projections et production réelle).
 *
 * @param {Object} options
 * @param {Array<Object>} options.sideA Joueurs cédés par A (reçus par B)
 * @param {Array<Object>} options.sideB Joueurs cédés par B (reçus par A)
 * @returns {Object} Évaluation complète avec totaux, différentiel et verdict
 */
export function evaluateTrade({ sideA = [], sideB = [] }) {
  const playersA = sideA.map(p => {
    const profile = calculatePlayerTradeProfile(p);
    return {
      name: p.name,
      position: (p.position || "").toUpperCase(),
      nflTeam: p.nflTeam || p.team,
      value: profile.tradeValue,
      projectedPpg: profile.projectedPpg,
      actualPpg: profile.actualPpg,
      blendedPpg: profile.blendedPpg,
      gamesPlayed: profile.gamesPlayed,
      trend: profile.trend,
      signal: profile.signal
    };
  });

  const playersB = sideB.map(p => {
    const profile = calculatePlayerTradeProfile(p);
    return {
      name: p.name,
      position: (p.position || "").toUpperCase(),
      nflTeam: p.nflTeam || p.team,
      value: profile.tradeValue,
      projectedPpg: profile.projectedPpg,
      actualPpg: profile.actualPpg,
      blendedPpg: profile.blendedPpg,
      gamesPlayed: profile.gamesPlayed,
      trend: profile.trend,
      signal: profile.signal
    };
  });

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

  // Calcul des métriques hebdomadaires
  const projA = Number(playersA.reduce((sum, p) => sum + p.projectedPpg, 0).toFixed(1));
  const projB = Number(playersB.reduce((sum, p) => sum + p.projectedPpg, 0).toFixed(1));
  const actualA = Number(playersA.reduce((sum, p) => sum + (p.actualPpg ?? p.projectedPpg), 0).toFixed(1));
  const actualB = Number(playersB.reduce((sum, p) => sum + (p.actualPpg ?? p.projectedPpg), 0).toFixed(1));
  const blendedA = Number(playersA.reduce((sum, p) => sum + p.blendedPpg, 0).toFixed(1));
  const blendedB = Number(playersB.reduce((sum, p) => sum + p.blendedPpg, 0).toFixed(1));
  const weeklyDiff = Number((blendedA - blendedB).toFixed(1));

  return {
    sideA: {
      players: playersA,
      rawTotal: rawSumA,
      netTotal: netA,
      count: countA,
      projectedPpgTotal: projA,
      actualPpgTotal: actualA,
      blendedPpgTotal: blendedA
    },
    sideB: {
      players: playersB,
      rawTotal: rawSumB,
      netTotal: netB,
      count: countB,
      projectedPpgTotal: projB,
      actualPpgTotal: actualB,
      blendedPpgTotal: blendedB
    },
    diff: diffVal,
    pctDiff: Math.round(pctDiff * 100),
    weeklyPointsDiff: weeklyDiff,
    verdict,
    label,
    starPlayer: bestA >= bestB
      ? (playersA.find(p => p.value === bestA) || null)
      : (playersB.find(p => p.value === bestB) || null)
  };
}
