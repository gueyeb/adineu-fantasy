import test from "node:test";
import assert from "node:assert/strict";
import { calculatePlayerTradeValue, calculatePlayerTradeProfile, evaluateTrade } from "../public/assets/trade-value.js";

test("calculatePlayerTradeValue correctly values elite vs mid vs deep players", () => {
  const eliteWR = { name: "Puka Nacua", position: "WR", quality: { expertRank: 3 } };
  const eliteRB = { name: "Bijan Robinson", position: "RB", quality: { expertRank: 4 } };
  const eliteTE = { name: "Trey McBride", position: "TE", quality: { expertRank: 17 } };
  const midWR = { name: "DJ Moore", position: "WR", quality: { expertRank: 45 } };
  const streamerTE = { name: "Dalton Schultz", position: "TE", quality: { expertRank: 120 } };
  const defense = { name: "Lions DEF", position: "DEF", quality: { expertRank: 160 } };

  const valWR = calculatePlayerTradeValue(eliteWR);
  const valRB = calculatePlayerTradeValue(eliteRB);
  const valTE = calculatePlayerTradeValue(eliteTE);
  const valMid = calculatePlayerTradeValue(midWR);
  const valStreamTE = calculatePlayerTradeValue(streamerTE);
  const valDef = calculatePlayerTradeValue(defense);

  // Elite players should have high trade values
  assert.ok(valWR >= 90, `Expected valWR >= 90, got ${valWR}`);
  assert.ok(valRB >= 95, `Expected valRB >= 95, got ${valRB}`);
  assert.ok(valTE >= 75, `Expected valTE >= 75, got ${valTE}`);

  // Mid tier players should have lower values
  assert.ok(valMid >= 30 && valMid <= 45, `Expected valMid between 30 and 45, got ${valMid}`);

  // Streamer TE and defenses should have negligible values
  assert.ok(valStreamTE <= 10, `Expected valStreamTE <= 10, got ${valStreamTE}`);
  assert.ok(valDef <= 5, `Expected valDef <= 5, got ${valDef}`);
});

test("evaluateTrade marks 1-for-1 equal value as FAIR", () => {
  const playerA = { name: "A.J. Brown", position: "WR", quality: { expertRank: 15 } };
  const playerB = { name: "Kyren Williams", position: "RB", quality: { expertRank: 16 } };

  const evaluation = evaluateTrade({
    sideA: [playerA],
    sideB: [playerB]
  });

  assert.equal(evaluation.verdict, "FAIR");
  assert.equal(evaluation.label, "Échange équitable");
  assert.ok(evaluation.pctDiff <= 8, `Expected pctDiff <= 8, got ${evaluation.pctDiff}`);
});

test("evaluateTrade applies roster tax on 2-for-1 package", () => {
  const starRB = { name: "Breece Hall", position: "RB", quality: { expertRank: 10 } }; // High value
  const midWR = { name: "Josh Downs", position: "WR", quality: { expertRank: 87 } };
  const backupRB = { name: "Tyler Allgeier", position: "RB", quality: { expertRank: 112 } };

  const evaluation = evaluateTrade({
    sideA: [starRB],
    sideB: [midWR, backupRB]
  });

  // Team A giving 1 star for 2 bench/mid players should favor Team A heavily
  assert.equal(evaluation.verdict, "UNBALANCED_A");
  assert.equal(evaluation.starPlayer.name, "Breece Hall");
  assert.ok(evaluation.sideA.netTotal > evaluation.sideB.netTotal);
});

test("calculatePlayerTradeProfile accurately blends projections and weekly actual production", () => {
  // Breakout player: low pre-draft rank (80), but strong weekly production (22, 19, 21 pts)
  const breakoutWR = {
    name: "Breakout Star",
    position: "WR",
    quality: { expertRank: 80 },
    projectedPpg: 10.0,
    weeklyScores: [22.0, 19.0, 21.0] // actual PPG = 20.67
  };

  const baseWR = {
    name: "Breakout Star (Preseason)",
    position: "WR",
    quality: { expertRank: 80 },
    projectedPpg: 10.0
  };

  const profileBreakout = calculatePlayerTradeProfile(breakoutWR);
  const profileBase = calculatePlayerTradeProfile(baseWR);

  assert.equal(profileBreakout.gamesPlayed, 3);
  assert.equal(profileBreakout.actualPpg, 20.7);
  // Blended PPG should be between projected (10.0) and actual (20.7)
  assert.ok(profileBreakout.blendedPpg > profileBreakout.projectedPpg);
  assert.ok(profileBreakout.blendedPpg < profileBreakout.actualPpg);
  // Trade value should dynamically increase based on verified on-field performance
  assert.ok(
    profileBreakout.tradeValue > profileBase.tradeValue,
    `Expected trade value to rise from ${profileBase.tradeValue}, got ${profileBreakout.tradeValue}`
  );
  assert.equal(profileBreakout.signal, "SELL_HIGH"); // Actual >> Projected
  assert.equal(profileBreakout.trend, "STABLE");
});

test("calculatePlayerTradeProfile identifies BUY_LOW candidates with bad luck", () => {
  // Elite player with unlucky first 3 weeks (projected 18.0, scored 8, 9, 7 pts)
  const buyLowRB = {
    name: "Unlucky Stud",
    position: "RB",
    quality: { expertRank: 12 },
    projectedPpg: 18.0,
    weeklyScores: [8.0, 9.0, 7.0]
  };

  const profile = calculatePlayerTradeProfile(buyLowRB);
  assert.equal(profile.actualPpg, 8.0);
  assert.equal(profile.signal, "BUY_LOW");
  // Regression anchor keeps blended value higher than pure 8.0 actual
  assert.ok(profile.blendedPpg > 11.5, `Expected blended PPG > 11.5, got ${profile.blendedPpg}`);
});

test("evaluateTrade calculates weeklyPointsDiff alongside trade equity", () => {
  const playerA = {
    name: "Player A",
    position: "WR",
    quality: { expertRank: 30 },
    projectedPpg: 14.5,
    weeklyScores: [15.0, 16.0]
  };
  const playerB = {
    name: "Player B",
    position: "RB",
    quality: { expertRank: 32 },
    projectedPpg: 12.0,
    weeklyScores: [11.0, 12.0]
  };

  const evaluation = evaluateTrade({
    sideA: [playerA],
    sideB: [playerB]
  });

  assert.ok(typeof evaluation.weeklyPointsDiff === "number");
  assert.ok(evaluation.weeklyPointsDiff > 0, "Team A should have positive weekly points differential");
  assert.ok(evaluation.sideA.blendedPpgTotal > evaluation.sideB.blendedPpgTotal);
});

