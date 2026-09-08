/**
 * Adineu Fantasy — Weekly Recap
 *
 * Résume une semaine Sleeper terminée : meilleur score, victoire la plus serrée,
 * plus gros upset (face à l'estimation pré-match), et points laissés sur le banc
 * (écart entre le lineup optimal réel et le lineup réellement titularisé).
 */

import { estimatePregameWinProbability } from "./matchups-live.js?v=3";
import { ROSTER_SETTINGS_2026 } from "./league-settings.js";

const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

function resolvePosition(playerCatalog, playerId) {
  const player = playerCatalog?.get ? playerCatalog.get(playerId) : playerCatalog?.[playerId];
  return (player?.position || "FLEX").toUpperCase();
}

/**
 * Meilleur score possible pour un roster donné une semaine, à composition de règles fixe
 * (titulaires par poste + un FLEX RB/WR/TE). Optimal car remplir chaque poste requis avec
 * ses meilleurs scoreurs puis le FLEX avec le meilleur reste RB/WR/TE est toujours optimal
 * quand un seul FLEX partagé existe (aucun gain à sacrifier un titulaire requis pour le FLEX).
 */
export function computeOptimalLineupPoints({ playerIds = [], playersPoints = {}, playerCatalog, rosterSettings = ROSTER_SETTINGS_2026 }) {
  const byPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };

  for (const playerId of playerIds) {
    const points = Number(playersPoints[playerId]);
    if (!Number.isFinite(points)) continue;
    const position = resolvePosition(playerCatalog, playerId);
    if (!byPosition[position]) continue;
    byPosition[position].push(points);
  }
  for (const position of Object.keys(byPosition)) byPosition[position].sort((a, b) => b - a);

  let total = 0;
  for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
    const count = rosterSettings.starters[position] || 0;
    total += byPosition[position].splice(0, count).reduce((sum, value) => sum + value, 0);
  }

  const flexPool = FLEX_ELIGIBLE.flatMap(position => byPosition[position]).sort((a, b) => b - a);
  total += flexPool.slice(0, rosterSettings.starters.FLEX || 0).reduce((sum, value) => sum + value, 0);

  return Number(total.toFixed(2));
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
