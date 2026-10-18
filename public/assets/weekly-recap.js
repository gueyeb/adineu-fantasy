/**
 * Adineu Fantasy — Weekly Recap
 *
 * Résume une semaine Sleeper terminée : meilleur score, victoire la plus serrée,
 * plus gros upset (face à l'estimation pré-match), et points laissés sur le banc
 * (écart entre le lineup optimal réel et le lineup réellement titularisé).
 */

import { estimatePregameWinProbability } from "./win-probability.js?v=78dcaa4abd";
import { ROSTER_SETTINGS_2026 } from "./league-settings.js?v=f6d1bf5212";

function resolvePosition(playerCatalog, playerId) {
  const player = playerCatalog?.get ? playerCatalog.get(playerId) : playerCatalog?.[playerId];
  return (player?.position || "FLEX").toUpperCase();
}

/**
 * Maximum réel sous contraintes de slots et éligibilité, partagé avec les awards.
 * Le caller contrôle la couverture des données avant publication.
 */
export function computeOptimalLineupPoints({ playerIds = [], playersPoints = {}, playerCatalog, rosterSettings = ROSTER_SETTINGS_2026, rosterPositions }) {
  const slots = rosterPositions || Object.entries(rosterSettings.starters).flatMap(([slot, count]) => Array(count).fill(slot));
  const activeSlots = slots.filter(slot => !['BN', 'IR', 'RESERVE'].includes(slot));
  const eligibility = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'] };
  // Assignment DP: a player may occupy only one eligible slot, including overlapping FLEX slots.
  let totals = new Map([[0, 0]]);
  for (const playerId of new Set(playerIds)) {
    const value = playersPoints[playerId];
    if (!Number.isFinite(value)) continue;
    const player = playerCatalog?.get ? playerCatalog.get(playerId) : playerCatalog?.[playerId];
    const positions = player?.fantasy_positions || [resolvePosition(playerCatalog, playerId)];
    const next = new Map(totals);
    for (const [mask, total] of totals) {
      activeSlots.forEach((slot, index) => {
        if (mask & (1 << index) || !positions.some(position => (eligibility[slot] || [slot]).includes(position))) return;
        const assigned = mask | (1 << index);
        next.set(assigned, Math.max(next.get(assigned) ?? -Infinity, total + value));
      });
    }
    totals = next;
  }
  // Fill required slots when possible, including negative scorers.
  const filled = mask => mask.toString(2).replaceAll("0", "").length;
  const mostFilled = Math.max(...[...totals.keys()].map(filled));
  return Number(Math.max(...[...totals].filter(([mask]) => filled(mask) === mostFilled).map(([, value]) => value)).toFixed(2));
}

function teamIdentity(row, rosterById, userById) {
  const roster = rosterById.get(Number(row.roster_id));
  const user = userById.get(roster?.owner_id);
  const manager = user?.display_name || `Roster ${row.roster_id}`;
  const teamName = user?.metadata?.team_name || manager;
  return { manager, teamName };
}

/**
 * @param {Object} options
 * @param {Array<Object>} options.rows Lignes brutes Sleeper /league/{id}/matchups/{week}
 * @param {Array<Object>} options.rosters
 * @param {Array<Object>} options.users
 * @param {Map|Object} options.playerCatalog
 * @param {Object} [options.projections] pts_ppr projetés par playerId, pour l'estimation pré-match
 * @param {Object} [options.rosterSettings]
 * @param {number} [options.week]
 */
export function buildWeeklyRecap({
  rows = [],
  rosters = [],
  users = [],
  playerCatalog,
  projections = {},
  rosterSettings = ROSTER_SETTINGS_2026,
  week = null
}) {
  const rosterById = new Map(rosters.map(roster => [Number(roster.roster_id), roster]));
  const userById = new Map(users.map(user => [user.user_id, user]));

  const teams = rows
    .filter(row => row.matchup_id !== null && row.matchup_id !== undefined)
    .map(row => {
      const { manager, teamName } = teamIdentity(row, rosterById, userById);
      const actualScore = Number(row.points) || 0;
      const optimalScore = computeOptimalLineupPoints({
        playerIds: row.players || [],
        playersPoints: row.players_points || {},
        playerCatalog,
        rosterSettings
      });
      const projectedScore = Number((row.starters || [])
        .filter(playerId => playerId && playerId !== "0")
        .reduce((sum, playerId) => sum + (Number(projections?.[playerId]?.pts_ppr) || 0), 0)
        .toFixed(2));

      return {
        rosterId: Number(row.roster_id),
        matchupId: Number(row.matchup_id),
        manager,
        teamName,
        actualScore,
        optimalScore,
        projectedScore,
        benchPointsLeft: Number(Math.max(0, optimalScore - actualScore).toFixed(2))
      };
    });

  const grouped = new Map();
  for (const team of teams) {
    const list = grouped.get(team.matchupId) || [];
    list.push(team);
    grouped.set(team.matchupId, list);
  }

  const matchups = [...grouped.values()]
    .filter(pair => pair.length === 2)
    .map(pair => ({
      teams: pair,
      margin: Number(Math.abs(pair[0].actualScore - pair[1].actualScore).toFixed(2)),
      chances: estimatePregameWinProbability(pair[0].projectedScore, pair[1].projectedScore)
    }));

  const playedTeams = teams.filter(team => team.actualScore > 0);
  const highestScore = playedTeams.length
    ? playedTeams.reduce((best, team) => team.actualScore > best.actualScore ? team : best)
    : null;

  const decidedMatchups = matchups.filter(m => m.teams[0].actualScore > 0 || m.teams[1].actualScore > 0);
  const closestMatchup = decidedMatchups.length
    ? decidedMatchups.reduce((best, m) => m.margin < best.margin ? m : best)
    : null;

  let biggestUpset = null;
  for (const matchup of matchups) {
    if (!matchup.chances) continue;
    const [teamA, teamB] = matchup.teams;
    if (teamA.actualScore === teamB.actualScore) continue;
    const winner = teamA.actualScore > teamB.actualScore ? teamA : teamB;
    const loser = winner === teamA ? teamB : teamA;
    const winnerChance = winner === teamA ? matchup.chances.teamA : matchup.chances.teamB;
    if (winnerChance >= 50) continue; // le favori a gagné, rien d'inattendu
    const magnitude = Number((50 - winnerChance).toFixed(1));
    if (!biggestUpset || magnitude > biggestUpset.magnitude) {
      biggestUpset = { winner, loser, winnerChance, magnitude };
    }
  }

  const benchPointsLeaders = [...teams]
    .sort((a, b) => b.benchPointsLeft - a.benchPointsLeft)
    .slice(0, 3);

  return { week, teams, matchups, highestScore, closestMatchup, biggestUpset, benchPointsLeaders };
}
