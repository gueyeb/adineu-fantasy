import test from "node:test";
import assert from "node:assert/strict";
import { buildAlgoFeedback, formatFeedbackMessage, projectionAccuracyByHorizon, signalOutcomes, summarizeFaabCalibration } from "../scripts/model-tracking.js";

test("FAAB calibration: in-range rate, implied price per point and anomalies", () => {
  const market = new Map([
    ["a", { name: "Alpha", faab_low: 60, faab_high: 100, surplus_points: 25 }],
    ["b", { name: "Bravo", faab_low: 0, faab_high: 0, surplus_points: 0 }]
  ]);
  const result = summarizeFaabCalibration([
    { sleeper_player_id: "a", bid: 80 },
    { sleeper_player_id: "b", bid: 90 },   // the model saw no value: anomaly
    { sleeper_player_id: "c", bid: 5 }     // no snapshot for this player
  ], market, { pricePerPoint: 3 });
  assert.equal(result.claims, 3);
  assert.equal(result.covered, 2);
  assert.equal(result.inRangeRate, 0.5);
  assert.equal(result.medianImpliedPricePerPoint, 3.2); // 80 / 25
  assert.deepEqual(result.anomalies.map(anomaly => anomaly.name), ["Bravo"]);
});

test("projection accuracy is grouped by how many weeks before the game it was made", () => {
  const rows = [
    { snapshot_week: 5, target_week: 5, sleeper_player_id: "p", pts_ppr: 10 },
    { snapshot_week: 3, target_week: 5, sleeper_player_id: "p", pts_ppr: 16 },
    { snapshot_week: 3, target_week: 6, sleeper_player_id: "p", pts_ppr: 99 }, // other week: ignored
    { snapshot_week: 5, target_week: 5, sleeper_player_id: "absent", pts_ppr: 10 } // didn't play: ignored
  ];
  assert.deepEqual(projectionAccuracyByHorizon(rows, new Map([["p", 12]]), 5), [{ horizon: 0, n: 1, mae: 2 }, { horizon: 2, n: 1, mae: 4 }]);
});

test("signals are followed from the week they were issued", () => {
  const usage = [{ snapshot_week: 4, sleeper_player_id: "buy", ppg: 8, signal: "BUY_LOW" }, { snapshot_week: 4, sleeper_player_id: "sell", ppg: 20, signal: "SELL_HIGH" }];
  const points = new Map([["buy|4", 12], ["buy|5", 14], ["sell|4", 9]]);
  const result = signalOutcomes(usage, points, 5);
  assert.deepEqual(result.BUY_LOW, { n: 1, changeVsFlagged: 5, improvedRate: 1 });
  assert.deepEqual(result.SELL_HIGH, { n: 1, changeVsFlagged: -11, improvedRate: 0 });
});

test("ALGO FEEDBACK flags a mispriced FAAB scale and stale far projections, and the message renders", () => {
  const faab = { claims: 10, covered: 10, inRangeRate: 0.4, medianImpliedPricePerPoint: 6, pricePerPoint: 3, pricedClaims: 9, anomalies: [] };
  const projections = [{ horizon: 1, n: 200, mae: 5 }, { horizon: 4, n: 150, mae: 6.5 }];
  const items = buildAlgoFeedback({ faab, projections });
  assert.ok(items.some(item => item.startsWith("PRICE_PER_POINT")));
  assert.ok(items.some(item => item.startsWith("FAR_WEEK_USAGE_WEIGHT")));
  const message = formatFeedbackMessage({ week: 5, faab, projections, signals: { BUY_LOW: { n: 0 }, SELL_HIGH: { n: 0 } }, algoFeedback: items });
  assert.match(message, /SUIVI DU MODÈLE — ADINEU \(semaine 5 terminée\)/);
  assert.match(message, /ALGO FEEDBACK/);
});
