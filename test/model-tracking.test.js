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

test("FAAB bids are matched with the snapshot taken the Tuesday before them (leg = snapshot week - 1)", async () => {
  const { faabLegForSnapshotWeek } = await import("../scripts/model-tracking.js");
  // Snapshot of operational week 4 (Tuesday 29/09) precedes the Wednesday 30/09 waivers, filed by Sleeper under leg 3.
  assert.equal(faabLegForSnapshotWeek(4), 3);
  assert.equal(faabLegForSnapshotWeek(1), 0);
});

test("an existing weekly snapshot is never overwritten by a later re-run", async () => {
  const { takeSnapshot } = await import("../scripts/model-tracking.js");
  const calls = [];
  const supabase = {
    from: table => {
      calls.push(table);
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: "snap-4", taken_at: "2026-09-29T08:00:00Z" } }) };
      return chain;
    }
  };
  const result = await takeSnapshot({ supabase, season: 2026, week: 4, fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.deepEqual(result, { season: 2026, week: 4, skipped: "exists", snapshotId: "snap-4", takenAt: "2026-09-29T08:00:00Z" });
  assert.deepEqual(calls, ["model_snapshots"]);
});

test('missing FAAB ranges are uncovered and feedback cannot claim calibration', () => {
  const faab = summarizeFaabCalibration([{ sleeper_player_id: 'x', bid: 20 }], new Map([['x', { faab_low: null, faab_high: null, surplus_points: 10 }]]));
  assert.equal(faab.covered, 0);
  assert.equal(faab.inRangeRate, null);
  assert.equal(faab.pricedClaims, 0);
  const text = formatFeedbackMessage({ week: 4, faab, projections: [{ horizon: 0, mae: 4.55, n: 359 }], signals: {}, algoFeedback: [] });
  assert.match(text, /0\/1 — calibration indisponible/);
  assert.match(text, /MAE/);
  assert.match(text, /ne certifie pas une capture avant kickoff/);
});

test("weekly market snapshot archives the role profile and trend in events, without a schema change", async () => {
  const { marketSnapshotRow } = await import("../scripts/model-tracking.js");
  const base = { sleeperId: "p", name: "Fixture", position: "WR", nflTeam: "AAA", surplusPoints: 4, effectivePpg: 8, rosPpg: 7,
    waiver: { category: "STASH", score: 30, faabMarket: [3, 5], flags: [], reasons: [], duration: null, newsOverride: false } };
  assert.equal(marketSnapshotRow(base).events, null);
  const profiled = marketSnapshotRow({ ...base, roleProfile: { profile: "ROLE_EXPANSION", basis: ["XFP_RISING_2_WEEKS"] },
    emergingRole: { comparable: true, progression: "RISING", progressionSource: "ORGANIC", xfpDelta: 3.2, opportunitiesDelta: 2, weeksCompared: [2, 3, 4] } });
  assert.deepEqual(profiled.events, { roleProfile: "ROLE_EXPANSION", roleBasis: ["XFP_RISING_2_WEEKS"], progression: "RISING", progressionSource: "ORGANIC", xfpDelta: 3.2, opportunitiesDelta: 2, weeksCompared: [2, 3, 4] });
  const flagged = marketSnapshotRow({ ...base, waiver: { ...base.waiver, flags: ["PROMOTION"], reasons: ["fixture"], duration: "RENTAL_1W", newsOverride: true }, roleProfile: { profile: "PURE_RENTAL", basis: ["NO_ROLE_BEFORE_ABSENCE"] } });
  assert.deepEqual(Object.keys(flagged.events), ["flags", "reasons", "duration", "roleProfile", "roleBasis"]);
  assert.equal(flagged.news_override, true);
  // Joueur non valorisé : les colonnes numériques restent nulles, la ligne reste archivable.
  const unvalued = marketSnapshotRow({ ...base, surplusPoints: null, effectivePpg: null, rosPpg: null, waiver: { ...base.waiver, score: null, faabMarket: null } });
  assert.deepEqual([unvalued.market_score, unvalued.faab_low, unvalued.faab_high, unvalued.ros_ppg], [null, null, null, null]);
});
