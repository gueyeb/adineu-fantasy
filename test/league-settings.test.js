import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAGUE_METADATA_2026,
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026,
  calculatePlayerFantasyPoints
} from "../public/assets/league-settings.js";

test("LEAGUE_METADATA_2026 and GENERAL_SETTINGS_2026 match official Sleeper parameters", () => {
  assert.equal(LEAGUE_METADATA_2026.leagueId, "1392715510830878721");
  assert.equal(GENERAL_SETTINGS_2026.teams, 12);
  assert.equal(GENERAL_SETTINGS_2026.playoffTeams, 8);
  assert.equal(GENERAL_SETTINGS_2026.playoffWeekStart, 15);
  assert.equal(GENERAL_SETTINGS_2026.waiver.type, "FAAB");
  assert.equal(GENERAL_SETTINGS_2026.waiver.budget, 1000);
  assert.equal(GENERAL_SETTINGS_2026.trades.deadlineWeek, 12);
  assert.equal(GENERAL_SETTINGS_2026.trades.vetoVotesNeeded, 6);
});

test("ROSTER_SETTINGS_2026 reflects 9 starters, 6 bench and 1 IR", () => {
  assert.equal(ROSTER_SETTINGS_2026.totalStarters, 9);
  assert.equal(ROSTER_SETTINGS_2026.starters.QB, 1);
  assert.equal(ROSTER_SETTINGS_2026.starters.RB, 2);
  assert.equal(ROSTER_SETTINGS_2026.starters.WR, 2);
  assert.equal(ROSTER_SETTINGS_2026.starters.TE, 1);
  assert.equal(ROSTER_SETTINGS_2026.starters.FLEX, 1);
  assert.equal(ROSTER_SETTINGS_2026.starters.K, 1);
  assert.equal(ROSTER_SETTINGS_2026.starters.DEF, 1);
  assert.equal(ROSTER_SETTINGS_2026.benchSlots, 6);
  assert.equal(ROSTER_SETTINGS_2026.reserveSlots, 1);
  assert.equal(ROSTER_SETTINGS_2026.totalRosterSize, 15);
});

test("SCORING_SETTINGS_2026 accurately defines Full PPR, 4pt pass TD, 0 penalty missed kicks and defense rules", () => {
  // Full PPR
  assert.equal(SCORING_SETTINGS_2026.receiving.receptionPPR, 1.0);
  assert.equal(SCORING_SETTINGS_2026.receiving.tightEndBonus, 0.0);

  // Passing & Turnovers
  assert.equal(SCORING_SETTINGS_2026.passing.touchdown, 4.0);
  assert.equal(SCORING_SETTINGS_2026.passing.interception, -2.0);
  assert.equal(SCORING_SETTINGS_2026.turnovers.fumbleLost, -2.0);

  // Kicking: No penalty for missed kicks
  assert.equal(SCORING_SETTINGS_2026.kicking.missedFieldGoal, 0.0);
  assert.equal(SCORING_SETTINGS_2026.kicking.missedExtraPoint, 0.0);
  assert.equal(SCORING_SETTINGS_2026.kicking.fieldGoal0To39, 3.0);
  assert.equal(SCORING_SETTINGS_2026.kicking.fieldGoal40To49, 4.0);
  assert.equal(SCORING_SETTINGS_2026.kicking.fieldGoal50To59, 5.0);
  assert.equal(SCORING_SETTINGS_2026.kicking.fieldGoal60Plus, 6.0);

  // Defense: Points allowed scale and 0 yards penalty
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.shutout, 10.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points1To6, 7.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points7To13, 4.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points14To20, 1.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points21To27, 0.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points28To34, -1.0);
  assert.equal(SCORING_SETTINGS_2026.defense.pointsAllowed.points35Plus, -4.0);
  assert.equal(SCORING_SETTINGS_2026.defense.yardsAllowedPoints, 0.0);
});

test("calculatePlayerFantasyPoints computes exact score matching Adineu rules", () => {
  // Receiver: 7 rec, 95 rec yards, 1 TD = 7 + 9.5 + 6 = 22.5 pts
  const wrScore = calculatePlayerFantasyPoints({
    receptions: 7,
    recYds: 95,
    recTd: 1
  });
  assert.equal(wrScore, 22.5);

  // Quarterback: 250 pass yds (10 pts), 2 pass TD (8 pts), 1 INT (-2 pts), 30 rush yds (3 pts) = 19.0 pts
  const qbScore = calculatePlayerFantasyPoints({
    passYds: 250,
    passTd: 2,
    passInt: 1,
    rushYds: 30
  });
  assert.equal(qbScore, 19.0);

  // Running back: 80 rush yds (8 pts), 1 rush TD (6 pts), 4 rec (4 pts), 25 rec yds (2.5 pts), 1 fumble lost (-2 pts) = 18.5 pts
  const rbScore = calculatePlayerFantasyPoints({
    rushYds: 80,
    rushTd: 1,
    receptions: 4,
    recYds: 25,
    fumblesLost: 1
  });
  assert.equal(rbScore, 18.5);
});
