/**
 * Adineu Fantasy — Moteur de Recommandation de Trades Bilatéraux
 *
 * Analyse les 12 rosters de la ligue pour identifier :
 * 1. Les asymétries de besoins (surplus WR vs déficit RB, et inversement)
 * 2. Les effets de levier sur les menottes (ex: propriétaire de Braelon Allen vs propriétaire de Breece Hall)
 * 3. Les propositions d'échange équitables avec argumentaires bilatéraux
 */

import { calculatePlayerTradeValue, evaluateTrade } from "./trade-value.js?v=2c9caa87cf";
import { assessScenarioConsistency, describeScenarioConsistency, restOfSeasonLineupTotal, scoreTradeRecommendation, tradeReturnScenarios } from "./trade-score.js?v=1111e88ca0";
import { tradeWeekFrame } from "./trade-timing.js?v=51b07dc8cf";
import { partnerLabel } from "./manager-identity.js?v=1b190dd337";
import { playerKey, playerStatus, preferenceAdjustment } from "./trade-preferences.js?v=c5fec5ce56";

export const KNOWN_HANDCUFFS = [
  { starter: "Breece Hall", handcuff: "Braelon Allen", nflTeam: "NYJ" },
  { starter: "Jeremiyah Love", handcuff: "Tyler Allgeier", nflTeam: "ARI" },
  { starter: "James Cook", handcuff: "Ray Davis", nflTeam: "BUF" }
];

function playerTier(player) {
  const value = player?.value ?? calculatePlayerTradeValue(player);
  if (value >= 70) return "joueur premium";
  if (value >= 35) return "titulaire solide";
  if (value >= 15) return "titulaire potentiel";
  return "joueur de rotation";
}

export function usageTradeAdjustment({ give = [], receive = [] }) {
  return receive.filter(player => player.signal === "BUY_LOW").length * 3
    + give.filter(player => player.signal === "SELL_HIGH").length * 3
    - receive.filter(player => player.signal === "SELL_HIGH").length * 2
    - give.filter(player => player.signal === "BUY_LOW").length * 2;
}

function decorateProposal(proposal, myPlayers, theirPlayers, week = null, myRoster = null, theirRoster = null, cutContext = null) {
  const recommendationScore = scoreTradeRecommendation({ myPlayers, theirPlayers, give: proposal.give, receive: proposal.receive, week, myRoster, theirRoster, cutContext });
  const usageAdjustment = usageTradeAdjustment(proposal);
  return {
    ...proposal,
    category: proposal.category === "WIN_WIN" && !recommendationScore.winWin ? "POSITIONAL_SWAP" : proposal.category,
    recommendationScore: { ...recommendationScore, usageAdjustment },
    targetWeeklyGain: recommendationScore.my_lineup_delta,
    score: recommendationScore.rankScore + usageAdjustment
  };
}

const FAIR_VERDICTS = new Set(["FAIR", "SLIGHT_ADVANTAGE_A", "SLIGHT_ADVANTAGE_B"]);
const TRADEABLE = new Set(["QB", "RB", "WR", "TE"]);
// Initial, uncalibrated selection thresholds; market values remain unchanged.
export const MAX_PRIMARY_TRADE_OFFERS = 5;

export const TRADE_SELECTION_DEFAULTS = Object.freeze({ minimumGain: 1.5, premiumGain: 2, premiumValue: 70, premiumRank: 24 });

export function classifyTradeProposal(proposal, { playerPreferences = {}, selection = {} } = {}) {
  const policy = { ...TRADE_SELECTION_DEFAULTS, ...selection };
  for (const key of Object.keys(TRADE_SELECTION_DEFAULTS)) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error(`Invalid trade selection: ${key}`);
  }
  const score = proposal.recommendationScore;
  const reasons = [];
  if (score.confidence === "LOW") reasons.push("Données insuffisantes pour recommander");
  if (score.my_lineup_delta < policy.minimumGain) reasons.push(`Gain inférieur au seuil expérimental de ${policy.minimumGain} pts/sem`);
  if (score.their_lineup_delta <= 0) reasons.push("Aucun gain de lineup adverse démontré");
  const protectedPlayers = proposal.give.filter(player => playerStatus(player, playerPreferences) === "KEEP" ||
    ((calculatePlayerTradeValue(player) >= policy.premiumValue ||
      (Number.isFinite(player.quality?.expertRank ?? player.expertRank) && (player.quality?.expertRank ?? player.expertRank) <= policy.premiumRank)) && playerStatus(player, playerPreferences) !== "SHOP"));
  if (protectedPlayers.length && score.my_lineup_delta < policy.premiumGain) reasons.push(`Protection premium/Keep : ${protectedPlayers.map(player => player.name).join(", ")}`);
  const consequences = Object.values(score.rosterConsequences || {});
  for (const side of consequences) {
    if (side.cutsNeeded > side.cutCandidates.length) reasons.push("Coupe hors titulaires non démontrée");
    if (side.cutCandidates.some(player => ["KEEP", "UNTOUCHABLE"].includes(playerStatus(player, playerPreferences)))) reasons.push("La coupe candidate contredit une préférence de conservation");
  }
  const needsCutReview = consequences.some(side => side.cutsNeeded > 0);
  const group = reasons.length ? "EXPLORATION" : !needsCutReview && score.confidence === "HIGH" && (score.structure?.id === "BILATERAL_MARKET_CLOSE" || (!score.structure && score.tradeability === "Naturelle")) ? "RECOMMENDED" : "NEGOTIATE";
  return { group, reasons };
}

/**
 * Week-by-week check of an offer the season average would surface (not EXPLORATION). Without
 * published weekly projections the check stays UNAVAILABLE and nothing changes. A contradicted
 * average gain goes to exploration; a verdict depending on the return hypothesis is never RECOMMENDED.
 * Gains and scores are unchanged.
 */
export function applyScenarioCheck(proposal, { myPlayers = [], theirPlayers = [], currentWeek = null, projectionsByWeek = null, timingContext = null, now = Date.now(), targetWeek = null, dataThroughWeek = null } = {}) {
  // The four weeks are shown on every offer, exploration included; they cost no lineup.
  const weekFrame = tradeWeekFrame({ players: [...proposal.give, ...proposal.receive], currentWeek, targetWeek, dataThroughWeek, context: timingContext, now });
  if (proposal.selection?.group === "EXPLORATION" || !Number.isInteger(currentWeek) || !projectionsByWeek || !Object.keys(projectionsByWeek).length) return { ...proposal, weekFrame };
  const scenarios = tradeReturnScenarios({ myPlayers, theirPlayers, give: proposal.give, receive: proposal.receive, week: currentWeek, projectionsByWeek, timingContext, now, targetWeek, dataThroughWeek });
  const score = proposal.recommendationScore;
  const check = assessScenarioConsistency({ myDelta: score.my_lineup_delta, theirDelta: score.their_lineup_delta, scenarios: scenarios.scenarios });
  const scenarioCheck = { ...check, weeks: scenarios.weeks, weekFrame: scenarios.weekFrame, range: scenarios.range, messages: describeScenarioConsistency(check, { theirs: proposal.partnerName || "le partenaire" }) };
  const selection = check.status === "WEEKLY_CONTRADICTS_AVERAGE"
    ? { group: "EXPLORATION", reasons: [...proposal.selection.reasons, ...scenarioCheck.messages] }
    : check.status === "INJURY_SENSITIVE"
      ? { group: proposal.selection.group === "RECOMMENDED" ? "NEGOTIATE" : proposal.selection.group, reasons: [...proposal.selection.reasons, ...scenarioCheck.messages] }
      : proposal.selection;
  return { ...proposal, selection, scenarioCheck, weekFrame };
}

/** Same partner and receipt, strictly fewer assets surrendered, no smaller own lineup gain.
 * Keep the extra asset even when it is on the bench: depth has option value. */
export function removeDominatedProposals(proposals) {
  const groups = new Map();
  for (const proposal of proposals) {
    const key = JSON.stringify([String(proposal.partnerRosterId), proposal.receive.map(playerKey).sort()]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(proposal);
  }
  return [...groups.values()].flatMap(group => group.filter(proposal => !group.some(other =>
    other !== proposal && other.give.length < proposal.give.length &&
    other.give.every(player => proposal.give.some(asset => playerKey(asset) === playerKey(player))) &&
    ({ LOW: 0, MEDIUM: 1, HIGH: 2 }[other.recommendationScore.confidence] >= { LOW: 0, MEDIUM: 1, HIGH: 2 }[proposal.recommendationScore.confidence]) &&
    other.recommendationScore.their_lineup_delta > 0 &&
    other.recommendationScore.my_lineup_delta >= proposal.recommendationScore.my_lineup_delta)));
}
export const MAX_PROPOSALS_PER_PARTNER = 2;

/** Exhaustive 1-for-1, 2-for-1 and 1-for-2 search between two rosters, kept only when BOTH optimal
 * lineups improve (rest of season) and the market values are close enough to be accepted. This is
 * what finds trades for balanced rosters the surplus/deficit heuristics never look at. */
function findLineupUpgrades({ myPlayers, theirPlayers, partnerRosterId, partnerName, week, playerPreferences }) {
  const key = player => String(player.sleeperId || player.name);
  const total = players => restOfSeasonLineupTotal(players, week).total;
  const swap = (players, out, incoming) => {
    const outgoing = new Set(out.map(key));
    return [...players.filter(player => !outgoing.has(key(player))), ...incoming];
  };
  const myBase = total(myPlayers);
  const theirBase = total(theirPlayers);
  // Untouchables are excluded before the per-partner cap, or they could crowd out valid offers.
  const mine = myPlayers.filter(player => TRADEABLE.has(player.position) && preferenceAdjustment([player], playerPreferences) !== null);
  const theirs = theirPlayers.filter(player => TRADEABLE.has(player.position));
  const pairs = list => list.flatMap((a, i) => list.slice(i + 1).map(b => [a, b]));
  const packages = [
    ...mine.flatMap(a => theirs.map(b => [[a], [b]])),
    ...pairs(mine).flatMap(give => theirs.map(b => [give, [b]])),
    ...mine.flatMap(a => pairs(theirs).map(receive => [[a], receive]))
  ];
  const found = [];
  for (const [give, receive] of packages) {
    const myGain = total(swap(myPlayers, give, receive)) - myBase;
    if (myGain <= 0.5) continue;
    const theirGain = total(swap(theirPlayers, receive, give)) - theirBase;
    if (theirGain < 0) continue;
    const evaluation = evaluateTrade({ sideA: give, sideB: receive });
    if (!FAIR_VERDICTS.has(evaluation.verdict)) continue;
    const names = players => players.map(player => player.name).join(" + ");
    found.push({
      id: `lineup-${give.map(key).join("-")}-${receive.map(key).join("-")}`,
      partnerRosterId,
      partnerName,
      category: "LINEUP_UPGRADE",
      title: `Upgrade de lineup : ${names(give)} contre ${names(receive)}`,
      give,
      receive,
      evaluation,
      pitchTarget: `Ta lineup optimale gagne ≈${myGain.toFixed(1)} pts/sem sur le reste de la saison régulière.`,
      pitchPartner: `${partnerName} y gagne aussi (≈${theirGain.toFixed(1)} pts/sem) : échange défendable des deux côtés.`,
      score: Math.min(myGain, theirGain) * 10 + myGain
    });
  }
  return found; // Apply selection and dominance before any per-partner/output cap.
}

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
export function findTradeProposals({ targetRosterId, rosters = [], playerCatalog = {}, playerPreferences = {}, currentWeek = null, view = "RECOMMENDED", selection = {}, limit = 15, cutContext = null, projectionsByWeek = null, now = Date.now(), targetWeek = null, dataThroughWeek = null }) {
  if (!["RECOMMENDED", "NEGOTIATE", "EXPLORATION", "ALL"].includes(view)) throw new Error("Invalid trade view");
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error("Invalid trade limit");
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
    return { ...info, sleeperId: info.sleeperId || (typeof p === "string" ? p : undefined) };
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
      return { ...info, sleeperId: info.sleeperId || (typeof p === "string" ? p : undefined) };
    });

    const partnerDiag = diagnoseRoster(partnerPlayers);
    const partnerName = partnerRosterRaw.name || partnerRosterRaw.ownerName
      ? partnerLabel({ account: partnerRosterRaw.ownerName ?? null, teamName: partnerRosterRaw.name ?? null })
      : `Team ${partnerRosterRaw.roster_id}`;
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

    // C. RECHERCHE EXHAUSTIVE : gains de lineup des deux côtés
    proposals.push(...findLineupUpgrades({ myPlayers: targetPlayers, theirPlayers: partnerPlayers, partnerRosterId: partnerRosterRaw.roster_id, partnerName, week: currentWeek, playerPreferences }));

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
              const receiveValue = receiveP.value ?? calculatePlayerTradeValue(receiveP);
              const bestGiveValue = Math.max(p1.value ?? calculatePlayerTradeValue(p1), p2.value ?? calculatePlayerTradeValue(p2));
              const bestGiveWeekly = Math.max(
                eval2.sideA.players.find(player => player.name === p1.name)?.blendedPpg || 0,
                eval2.sideA.players.find(player => player.name === p2.name)?.blendedPpg || 0
              );
              const receiveWeekly = eval2.sideB.players.find(player => player.name === receiveP.name)?.blendedPpg || 0;
              if (receiveValue >= 15 && receiveValue >= bestGiveValue + 8 && receiveWeekly >= bestGiveWeekly && (eval2.verdict === "FAIR" || eval2.verdict === "SLIGHT_ADVANTAGE_A" || eval2.verdict === "SLIGHT_ADVANTAGE_B")) {
                proposals.push({
                  id: `winwin-2-${p1.name}-${p2.name}-${receiveP.name}`,
                  partnerRosterId: partnerRosterRaw.roster_id,
                  partnerName,
                  category: "CONSOLIDATION",
                  title: `Consolidation 2-pour-1 : ${p1.name} + ${p2.name} contre ${receiveP.name}`,
                  give: [p1, p2],
                  receive: [receiveP],
                  evaluation: eval2,
                  pitchTarget: `Consolide deux actifs en un ${playerTier(receiveP)} en ${receiveP.position} (${receiveP.name}) pour améliorer ta lineup.`,
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
    const adjustment = preferenceAdjustment(p.give, playerPreferences);
    if (adjustment === null) continue;
    const key = `${p.partnerRosterId}:${p.give.map(g => g.name).sort().join(",")}:${p.receive.map(r => r.name).sort().join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      const partner = rosters.find(roster => String(roster.roster_id) === String(p.partnerRosterId));
      const partnerPlayers = (partner?.players || []).map(player => typeof player === "string" ? { ...getPlayerInfo(player), sleeperId: player } : player);
      const decorated = decorateProposal(p, targetPlayers, partnerPlayers, currentWeek, targetRosterRaw, partner, cutContext);
      const { my_lineup_delta: mine, their_lineup_delta: theirs } = decorated.recommendationScore;
      // Un trade qui n'améliore pas ta lineup, ou qui fait perdre le partenaire, n'est pas une opportunité.
      if (p.category !== "HANDCUFF_INSURANCE" && (mine <= 0 || theirs < 0)) continue;
      uniqueProposals.push({ ...decorated, score: decorated.score + adjustment });
    }
  }

  // Diversité : d'abord les 2 meilleures propositions de chaque partenaire (par score), puis le reste.
  // Une liste variée vaut mieux que 4 variantes du même deal ; rien n'est supprimé s'il y a de la place.
  const sorted = removeDominatedProposals(uniqueProposals)
    .map(proposal => ({ ...proposal, selection: classifyTradeProposal(proposal, { playerPreferences, selection }) }))
    .map(proposal => applyScenarioCheck(proposal, { myPlayers: targetPlayers, currentWeek, projectionsByWeek, timingContext: cutContext, now, targetWeek, dataThroughWeek,
      theirPlayers: (rosters.find(roster => String(roster.roster_id) === String(proposal.partnerRosterId))?.players || []).map(player => typeof player === "string" ? { ...getPlayerInfo(player), sleeperId: player } : player) }))
    .filter(proposal => view === "ALL" || proposal.selection.group === view)
    .sort((a, b) => b.score - a.score);
  const perPartner = new Map();
  const head = [];
  const tail = [];
  for (const proposal of sorted) {
    const count = perPartner.get(proposal.partnerRosterId) || 0;
    perPartner.set(proposal.partnerRosterId, count + 1);
    (count < MAX_PROPOSALS_PER_PARTNER ? head : tail).push(proposal);
  }
  return limit === null ? [...head, ...tail] : [...head, ...tail].slice(0, limit);
}

/** Bounded neighboring offers for the same target; never fabricate a beneficial deal. */
export function findCounterOffers({ proposal, myPlayers = [], theirPlayers = [], playerPreferences = {}, currentWeek = null, myRoster = null, theirRoster = null, cutContext = null, projectionsByWeek = null, now = Date.now(), targetWeek = null, dataThroughWeek = null }) {
  const own = new Set(myPlayers.map(playerKey));
  const theirs = new Set(theirPlayers.map(playerKey));
  if (!proposal?.receive?.length || !proposal.give?.length ||
      !proposal.receive.every(player => theirs.has(playerKey(player))) ||
      !proposal.give.every(player => own.has(playerKey(player)))) return [];
  const eligible = [...new Map(myPlayers.filter(player => ["QB", "RB", "WR", "TE"].includes(player.position) && preferenceAdjustment([player], playerPreferences) !== null).map(player => [playerKey(player), player])).values()];
  const packages = eligible.map(player => [player]);
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) packages.push([eligible[i], eligible[j]]);
  }
  const original = proposal.give.map(playerKey).sort().join("|");
  const offers = packages.filter(give => give.map(playerKey).sort().join("|") !== original).map(give => {
    const evaluation = evaluateTrade({ sideA: give, sideB: proposal.receive });
    const decorated = decorateProposal({ ...proposal, give, evaluation }, myPlayers, theirPlayers, currentWeek, myRoster, theirRoster, cutContext);
    return { ...decorated, score: decorated.score + preferenceAdjustment(give, playerPreferences) };
  }).filter(offer => ["FAIR", "SLIGHT_ADVANTAGE_A", "SLIGHT_ADVANTAGE_B"].includes(offer.evaluation.verdict) &&
    offer.recommendationScore.my_lineup_delta > 0 && offer.recommendationScore.their_lineup_delta >= 0 &&
    offer.recommendationScore.confidence !== "LOW")
    .map(offer => applyScenarioCheck({ ...offer, selection: classifyTradeProposal(offer, { playerPreferences }) }, { myPlayers, theirPlayers, currentWeek, projectionsByWeek, timingContext: cutContext, now, targetWeek, dataThroughWeek }))
    .filter(offer => offer.selection.group !== "EXPLORATION");
  // Include the original so a strictly worse counter-offer cannot survive its exclusion.
  const originalOffer = decorateProposal(proposal, myPlayers, theirPlayers, currentWeek, myRoster, theirRoster, cutContext);
  return removeDominatedProposals([...offers, originalOffer]).filter(offer => offer !== originalOffer)
    .sort((a, b) => b.score - a.score).slice(0, 3);
}
