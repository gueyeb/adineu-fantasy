/**
 * Adineu Fantasy — Playoff Race
 *
 * Pas de simulation ni de pourcentage inventé : on prend le bilan victoires/points
 * déjà calculé par power-rankings.js (mêmes garde-fous : semaine live et playoffs
 * exclus, couverture complète requise) et on le trie comme un vrai classement
 * (victoires puis points marqués), avec l'écart en matchs par rapport à la 8e place.
 */

import { calculatePowerRankings } from "./power-rankings.js?v=1";

export const DEFAULT_PLAYOFF_SPOTS = 8;

function standingsOrder(a, b) {
  return b.wins - a.wins || b.pointsFor - a.pointsFor || a.manager.localeCompare(b.manager, "fr");
}

/**
 * @param {Array<Object>} rows Lignes de matchups (même format que calculatePowerRankings)
 * @param {Object} [options]
 * @param {number} [options.playoffSpots=8]
 * @returns {Object} { ready, reason, completedWeekCount, playoffSpots, standings }
 */
export function calculatePlayoffRace(rows, options = {}) {
  const { playoffSpots = DEFAULT_PLAYOFF_SPOTS, ...powerOptions } = options;
  const power = calculatePowerRankings(rows, powerOptions);

  if (!power.ready) {
    return {
      ready: false,
      reason: power.reason,
      completedWeekCount: power.completedWeekCount,
      teamsReady: power.teamsReady,
      teamCount: power.teamCount,
      playoffSpots,
      standings: []
    };
  }

  const ordered = [...power.rankings].sort(standingsOrder);
  const cutoffTeam = ordered[playoffSpots - 1] || null;

  const standings = ordered.map((team, index) => ({
    manager: team.manager,
    team: team.team,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    pointsFor: team.pointsFor,
    pointsAgainst: team.pointsAgainst,
    games: team.games,
    seed: index + 1,
    inPlayoffs: index < playoffSpots,
    gamesBack: cutoffTeam
      ? Number((((cutoffTeam.wins - team.wins) + (team.losses - cutoffTeam.losses)) / 2).toFixed(1))
      : 0
  }));

  return {
    ready: true,
    reason: power.reason,
    completedWeekCount: power.completedWeekCount,
    teamsReady: power.teamsReady,
    teamCount: power.teamCount,
    playoffSpots,
    standings
  };
}
