/**
 * Adineu Fantasy — Paramètres Officiels & Système de Scoring Saison 2026
 *
 * Source de vérité extraite directement de l'API Sleeper (Ligue ID: 1392715510830878721).
 * Utilisé pour le calcul des scores, l'analyseur de trades et les outils in-season.
 */

export const LEAGUE_METADATA_2026 = {
  name: "Adineu 2026",
  platform: "sleeper",
  leagueId: "1392715510830878721",
  season: 2026,
  seasonType: "regular",
  sport: "nfl"
};

export const GENERAL_SETTINGS_2026 = {
  teams: 12,
  startWeek: 1,
  regularSeasonWeeks: 14,
  playoffWeekStart: 15,
  playoffTeams: 8, // 8 équipes qualifiées en playoffs sur 12
  waiver: {
    type: "FAAB",
    budget: 1000,
    bidMinimum: 0,
    clearDay: "Wednesday",
    clearTime: "09:00 Europe/Paris",
    clearDays: 1
  },
  trades: {
    deadlineWeek: 12,
    reviewDays: 1,
    vetoVotesNeeded: 6,
    pickTradingAllowed: true
  }
};

export const ROSTER_SETTINGS_2026 = {
  starters: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1, // W/R/T (WR, RB ou TE)
    K: 1,
    DEF: 1
  },
  totalStarters: 9,
  benchSlots: 6,
  reserveSlots: 1, // IR (Joueurs Out ou IR autorisés)
  totalRosterSize: 15 // 9 titulaires + 6 bench
};

export const SCORING_SETTINGS_2026 = {
  passing: {
    yardsPerPoint: 25,
    pointsPerYard: 0.04,
    touchdown: 4.0,
    interception: -2.0,
    twoPointConversion: 2.0,
    sackSubi: 0.0 // Aucun malus pour le QB sur les sacks
  },
  rushing: {
    yardsPerPoint: 10,
    pointsPerYard: 0.10,
    touchdown: 6.0,
    twoPointConversion: 2.0
  },
  receiving: {
    receptionPPR: 1.0, // Full PPR (1.0 pt pour WR, RB, TE)
    tightEndBonus: 0.0, // Aucun TEP
    yardsPerPoint: 10,
    pointsPerYard: 0.10,
    touchdown: 6.0,
    twoPointConversion: 2.0
  },
  turnovers: {
    fumbleLost: -2.0,
    fumbleRecoveryTouchdown: 6.0
  },
  kicking: {
    extraPointMade: 1.0,
    fieldGoal0To39: 3.0,
    fieldGoal40To49: 4.0,
    fieldGoal50To59: 5.0,
    fieldGoal60Plus: 6.0,
    // Règle spécifique Sleeper Adineu : 0 pénalité sur les tirs manqués
    missedFieldGoal: 0.0,
    missedExtraPoint: 0.0
  },
  defense: {
    sack: 1.0,
    interception: 2.0,
    fumbleRecovery: 2.0,
    forcedFumble: 1.0,
    safety: 2.0,
    blockedKick: 2.0,
    touchdown: 6.0,
    twoPointReturn: 2.0,
    specialTeamsFumbleRecovery: 1.0,
    // Échelle des points encaissés (Points Allowed)
    pointsAllowed: {
      shutout: 10.0,      // 0 pt
      points1To6: 7.0,    // 1-6 pts
      points7To13: 4.0,   // 7-13 pts
      points14To20: 1.0,  // 14-20 pts
      points21To27: 0.0,  // 21-27 pts
      points28To34: -1.0, // 28-34 pts
      points35Plus: -4.0  // 35+ pts
    },
    // Règle spécifique Sleeper Adineu : les yards concédés ne rapportent ni ne retirent de points
    yardsAllowedPoints: 0.0
  }
};

/**
 * Calcule les points fantasy d'une ligne de stats selon les règles officielles Adineu 2026.
 * @param {Object} stats Statistiques du joueur
 * @returns {number} Points fantasy arrondis à deux décimales
 */
export function calculatePlayerFantasyPoints(stats = {}) {
  let pts = 0;

  // Passing
  if (stats.passYds) pts += stats.passYds * SCORING_SETTINGS_2026.passing.pointsPerYard;
  if (stats.passTd) pts += stats.passTd * SCORING_SETTINGS_2026.passing.touchdown;
  if (stats.passInt) pts += stats.passInt * SCORING_SETTINGS_2026.passing.interception;
  if (stats.pass2pt) pts += stats.pass2pt * SCORING_SETTINGS_2026.passing.twoPointConversion;

  // Rushing
  if (stats.rushYds) pts += stats.rushYds * SCORING_SETTINGS_2026.rushing.pointsPerYard;
  if (stats.rushTd) pts += stats.rushTd * SCORING_SETTINGS_2026.rushing.touchdown;
  if (stats.rush2pt) pts += stats.rush2pt * SCORING_SETTINGS_2026.rushing.twoPointConversion;

  // Receiving
  if (stats.receptions) pts += stats.receptions * SCORING_SETTINGS_2026.receiving.receptionPPR;
  if (stats.recYds) pts += stats.recYds * SCORING_SETTINGS_2026.receiving.pointsPerYard;
  if (stats.recTd) pts += stats.recTd * SCORING_SETTINGS_2026.receiving.touchdown;
  if (stats.rec2pt) pts += stats.rec2pt * SCORING_SETTINGS_2026.receiving.twoPointConversion;

  // Fumbles
  if (stats.fumblesLost) pts += stats.fumblesLost * SCORING_SETTINGS_2026.turnovers.fumbleLost;

  // Kicking
  if (stats.patMade) pts += stats.patMade * SCORING_SETTINGS_2026.kicking.extraPointMade;
  if (stats.fg0To39) pts += stats.fg0To39 * SCORING_SETTINGS_2026.kicking.fieldGoal0To39;
  if (stats.fg40To49) pts += stats.fg40To49 * SCORING_SETTINGS_2026.kicking.fieldGoal40To49;
  if (stats.fg50To59) pts += stats.fg50To59 * SCORING_SETTINGS_2026.kicking.fieldGoal50To59;
  if (stats.fg60Plus) pts += stats.fg60Plus * SCORING_SETTINGS_2026.kicking.fieldGoal60Plus;

  return Math.round(pts * 100) / 100;
}
