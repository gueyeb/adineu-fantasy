import test from "node:test";
import assert from "node:assert/strict";
import { auctionFeatures, fitAuctionModel, lineupGain, priceToWin, winProbability, bidForProbability, scoreAuction, RIVAL_NEED_POINTS } from "../public/assets/faab-auction.js";
import { buildAuctionSamples, rostersBeforeLeg, budgetsBeforeLeg, validateAuctionModel } from "../scripts/calibrate-faab.js";
import { createAuctionPricer } from "../scripts/waiver-evaluator.js";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
const positions = { q1: "QB", r1: "RB", r2: "RB", r3: "RB", w1: "WR", w2: "WR", t1: "TE", k1: "K", d1: "DEF", fa: "RB" };

test("lineupGain counts only what the player adds to the optimal lineup, FLEX included", () => {
  const points = { q1: 20, r1: 15, r2: 10, r3: 4, w1: 12, w2: 9, t1: 6, k1: 8, d1: 7, fa: 11 };
  const options = { pointsOf: id => points[id], positionOf: id => positions[id], slots: SLOTS };
  // fa (11) takes RB2 (10), r2 moves to FLEX in place of r3 (4): +7.
  assert.equal(lineupGain(["q1", "r1", "r2", "r3", "w1", "w2", "t1", "k1", "d1"], "fa", options), 7);
  assert.equal(lineupGain(["q1", "r1", "r2", "r3", "w1", "w2", "t1", "k1", "d1", "fa"], "fa", options), 7, "a roster already holding him is valued without him");
  assert.equal(lineupGain(["q1", "r1", "r2", "r3", "w1", "w2", "t1", "k1", "d1"], "fa", { ...options, pointsOf: id => id === "fa" ? 3 : points[id] }), 0);
});

test("auctionFeatures reads the last week's rise against earlier played weeks and the rivals' need", () => {
  const series = [{ played: true, snapShare: 0.3, opportunities: 4 }, { played: false }, { played: true, snapShare: 0.8, opportunities: 14 }];
  const x = auctionFeatures({ position: "RB", yearsExp: 1, series, rivalNeeds: [0, 2, RIVAL_NEED_POINTS, 6] });
  assert.deepEqual(x.map(value => Number(value.toFixed(3))), [1, 2, 0.5, 0, 1, 0, 0, 1, 0.5]);
  assert.deepEqual(auctionFeatures({ position: "DEF", series: [], rivalNeeds: [] }), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(auctionFeatures({ position: null }), null);
});

const model = { rivalBidWeights: [0, 0, 0, 0, 0, 0, 0, 0, 2], amountWeights: [Math.log1p(50), 0, 0, 0, 0, 0, 0, 0, 1], sd: 1 };

test("win probability rises with the bid, reaches 1 above the richest rival budget, and rival need raises the price", () => {
  const calm = [1, 0, 0, 0, 1, 0, 0, 0, 0];
  const contested = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.ok(winProbability(model, calm, 10) < winProbability(model, calm, 100));
  assert.equal(winProbability(model, calm, 301, { maxRivalBudget: 300 }), 1);
  assert.ok(bidForProbability(model, contested, 0.6) > bidForProbability(model, calm, 0.6));
  assert.equal(winProbability(model, null, 10), null);
});

test("priceToWin never proposes above the personal ceiling and names the rivals in need", () => {
  const rivals = [
    { rosterId: 2, team: "A", need: 6, budget: 400 },
    { rosterId: 3, team: "B", need: 0.2, budget: 900 },
    { rosterId: 4, team: "C", need: 3, budget: 80 }
  ];
  const free = priceToWin(model, { position: "RB", series: [], rivals });
  const capped = priceToWin(model, { position: "RB", series: [], rivals, ceiling: 5 });
  assert.ok(free.bidForTarget > 5);
  assert.equal(capped.proposedBid, 5);
  assert.equal(capped.cappedByCeiling, true);
  assert.ok(capped.winProbabilityAtProposed < free.winProbabilityAtProposed);
  assert.deepEqual(free.likelyRivals.map(rival => rival.team), ["A", "C"]);
  assert.equal(free.rivalsInNeed, 2);
  assert.equal(free.maxRivalBudget, 900);
  assert.equal(priceToWin(null, { position: "RB", rivals }), null);
});

test("fitAuctionModel refuses a thin sample and learns that contested players cost more", () => {
  assert.equal(fitAuctionModel([{ x: [1, 0, 0, 0, 0, 0, 0, 0, 0], bestRivalBid: 5 }]), null);
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const hot = i % 2 === 0;
    samples.push({ x: [1, 0, 0, 0, 1, 0, 0, 0, hot ? 1 : 0], bestRivalBid: hot ? 100 + i : (i % 4 === 1 ? null : 5 + (i % 3)) });
  }
  const fitted = fitAuctionModel(samples);
  assert.ok(fitted.amountWeights[8] > 1, "rival need raises the expected best rival bid");
  assert.ok(fitted.sd > 0);
  const score = scoreAuction(fitted, samples.map(sample => ({ ...sample, bid: 50, won: sample.bestRivalBid === null || sample.bestRivalBid < 50 })));
  assert.ok(score.brier < score.constantRateBrier);
});

// Two rosters, one RB claimed in leg 2 by both (roster 1 wins at 30 over roster 2 at 20), one
// invalid bid (full roster) that must not count as a rival.
const rosters = [{ roster_id: 1, players: ["r1", "fa"], settings: {} }, { roster_id: 2, players: ["r2"], settings: {} }];
const transactions = [
  { leg: 1, type: "waiver", status: "complete", status_updated: 10, adds: { r1: 1 }, settings: { waiver_bid: 7 } },
  { leg: 2, type: "waiver", status: "complete", status_updated: 20, adds: { fa: 1 }, settings: { waiver_bid: 30 } },
  { leg: 2, type: "waiver", status: "failed", status_updated: 20, adds: { fa: 2 }, settings: { waiver_bid: 20 } },
  { leg: 2, type: "waiver", status: "failed", status_updated: 20, adds: { fa: 2 }, settings: { waiver_bid: 90 }, metadata: { notes: "Unfortunately, your roster will have too many players after this transaction." } }
];

test("rosters and budgets are rebuilt as they stood before each leg", () => {
  assert.deepEqual([...rostersBeforeLeg(rosters, transactions, 2).get(1)], ["r1"]);
  assert.deepEqual([...rostersBeforeLeg(rosters, transactions, 1).get(1)], []);
  assert.equal(budgetsBeforeLeg(rosters, transactions, 2).get(1), 993);
  assert.equal(budgetsBeforeLeg(rosters, transactions, 1).get(1), 1000);
});

test("each valid bid becomes a sample against the best rival bid; rejected bids never compete", () => {
  const samples = buildAuctionSamples({ transactions, rosters, legs: [2], slots: SLOTS,
    statsByWeek: { 1: {}, 2: { fa: { off_snp: 30, tm_off_snp: 60, rush_att: 10 } } }, projectionsByWeek: { 3: { fa: 9, r1: 5 } },
    positionOf: id => ({ r1: "RB", r2: "RB", fa: "RB" })[id], yearsExpOf: () => 0 });
  assert.deepEqual(samples.map(sample => [sample.rosterId, sample.bid, sample.won, sample.bestRivalBid]), [[1, 30, true, 20], [2, 20, false, 30]]);
  assert.equal(samples[0].maxRivalBudget, 1000);
  assert.equal(samples[1].maxRivalBudget, 993);
  assert.deepEqual(validateAuctionModel(samples), { leaveOneLegOut: null, chronological: null });
});

test("createAuctionPricer prices against every other roster and stays silent without a calibration", () => {
  const calibration = { generatedAt: "2026-10-14T00:00:00Z", sample: { bids: 161 }, targetWinProbability: 0.6, model };
  const pricer = createAuctionPricer({ calibration, rosters: [...rosters, { roster_id: 3, players: [], settings: { waiver_budget_used: 950 } }], myRosterId: 1,
    projections: { fa: { pts_ppr: 9 }, r2: { pts_ppr: 4 } }, positionOf: id => ({ r1: "RB", r2: "RB", fa: "RB" })[id], slots: SLOTS });
  const result = pricer({ sleeperId: "fa", position: "RB", signals: { series: [] } }, 40);
  assert.equal(result.rivals, 2);
  assert.equal(result.rivalsInNeed, 2);
  assert.equal(result.maxRivalBudget, 1000);
  assert.ok(result.proposedBid <= 40);
  assert.equal(result.calibrated, false);
  assert.equal(createAuctionPricer({ calibration: null, rosters, slots: SLOTS })({ sleeperId: "fa", position: "RB" }), null);
});

test("weekly calibration: stored with its last leg, latest one served, file kept as fallback", async () => {
  const { saveCalibration, loadLatestCalibration, formatCalibrationLine } = await import("../scripts/calibrate-faab.js");
  const { loadAuctionCalibration, setAuctionCalibrationSource, primeAuctionCalibration } = await import("../scripts/league-context.js");
  const rows = [];
  const supabase = { from: table => ({
    insert: async row => { rows.push({ table, ...row }); return { error: null }; },
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows.slice().reverse().map(row => ({ calibration: row.calibration })), error: null }) }) }) })
  }) };
  const fit = { season: "2026", legs: [1, 2, 3, 4, 5], generatedAt: "2026-10-20T08:00:00Z", sample: { bids: 170 },
    validation: { leaveOneLegOut: { brier: 0.25, constantRateBrier: 0.255, interquartileCoverage: 0.6 }, chronological: { interquartileCoverage: 0.52 } } };
  await saveCalibration(supabase, fit);
  assert.deepEqual([rows[0].table, rows[0].season, rows[0].last_leg], ["faab_auction_calibrations", 2026, 5]);
  assert.equal(await loadLatestCalibration(supabase, 2026), fit);
  assert.match(formatCalibrationLine(fit), /170 enchères \(legs 1–5\), fourchette p25–p75 60 % hors échantillon \/ 52 % chronologique/);

  const file = await loadAuctionCalibration();
  setAuctionCalibrationSource(async () => { throw new Error("down"); });
  assert.deepEqual(await loadAuctionCalibration(), file, "Supabase down: committed file");
  setAuctionCalibrationSource(async () => fit);
  assert.equal(await loadAuctionCalibration(), fit, "latest stored fit wins over the file");
  const fresh = { ...fit, generatedAt: "2026-10-27T08:00:00Z" };
  primeAuctionCalibration(fresh);
  assert.equal(await loadAuctionCalibration(), fresh, "the job's new fit is used at once");
  setAuctionCalibrationSource(null);
});
