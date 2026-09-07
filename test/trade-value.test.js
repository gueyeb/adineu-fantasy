import test from "node:test";
import assert from "node:assert/strict";
import { calculatePlayerTradeValue, evaluateTrade } from "../public/assets/trade-value.js";

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
