import test from "node:test";
import assert from "node:assert/strict";
import { classifyTradeProposal, removeDominatedProposals } from "../public/assets/trade-recommender.js";
import { scoreTradeRecommendation } from "../public/assets/trade-score.js";

// Synthetic selection fixtures, not a reconstruction of the live Boukki snapshot.
const p = (name, rank = 40) => ({ name, sleeperId: name, position: "WR", projectedPpg: 15, quality: { expertRank: rank } });
const premium = p("Premium", 3);
const extra = p("Extra");
const target = p("Target");
const offer = (give = [premium], delta = 3, theirDelta = 1) => ({ partnerRosterId: 2, give, receive: [target], recommendationScore: { my_lineup_delta: delta, their_lineup_delta: theirDelta, confidence: "HIGH", tradeability: "Naturelle" } });

test("dominance removes an extra surrendered asset before caps; other partners/receipts survive", () => {
  const single = offer();
  const dominated = offer([premium, extra]);
  const otherPartner = { ...dominated, partnerRosterId: 3 };
  const otherReceipt = { ...dominated, receive: [p("Other")] };
  assert.deepEqual(removeDominatedProposals([dominated, otherPartner, single, otherReceipt]), [single, otherPartner, otherReceipt]);
  const lowSingle = structuredClone(single); lowSingle.recommendationScore.confidence = "LOW";
  const lowPackage = structuredClone(dominated); lowPackage.recommendationScore.confidence = "LOW";
  assert.deepEqual(removeDominatedProposals([lowPackage, lowSingle]), [lowSingle], "shared missing evidence does not justify giving away an extra asset");
  assert.equal(removeDominatedProposals([offer([premium], 2), dominated]).length, 2, "a smaller offer with worse lineup benefit is not dominance");
  assert.equal(removeDominatedProposals([offer([premium], 3, 0), dominated]).length, 2, "unacceptable alternative cannot eliminate a bilateral offer");
});

test("selection gates precede ranking and preserve borderline experiments", () => {
  assert.equal(classifyTradeProposal(offer()).group, "RECOMMENDED");
  assert.equal(classifyTradeProposal(offer([extra], 1.4)).group, "EXPLORATION");
  assert.equal(classifyTradeProposal(offer([extra], 1.5)).group, "RECOMMENDED");
  assert.equal(classifyTradeProposal(offer([premium], 1.9)).group, "EXPLORATION");
  assert.equal(classifyTradeProposal(offer([premium], 2)).group, "RECOMMENDED");
  assert.equal(classifyTradeProposal(offer([extra], 3, 0)).group, "EXPLORATION");
  const livePremium = { ...premium, marketValue: 59 };
  assert.equal(classifyTradeProposal(offer([livePremium], 1.9)).group, "EXPLORATION", "top expert rank protects a premium even below value 70");
  const uncertain = offer(); uncertain.recommendationScore.confidence = "LOW";
  assert.equal(classifyTradeProposal(uncertain).group, "EXPLORATION");
  uncertain.recommendationScore.confidence = "MEDIUM";
  assert.equal(classifyTradeProposal(uncertain).group, "NEGOTIATE");
  assert.equal(classifyTradeProposal(offer([premium], 1.9), { playerPreferences: { Premium: "SHOP" } }).group, "RECOMMENDED");
  assert.equal(classifyTradeProposal(offer([extra], 1.9), { playerPreferences: { Extra: "KEEP" } }).group, "EXPLORATION");
  assert.throws(() => classifyTradeProposal(offer(), { selection: { minimumGain: NaN } }), /Invalid/);
});

test("Questionable without projection and missing replacement evidence lower confidence", () => {
  const give = p("Give");
  const receive = { ...p("Receive"), projectedPpg: undefined, injuryStatus: "Questionable" };
  const args = { myPlayers: [give], theirPlayers: [receive], give: [give], receive: [receive] };
  assert.equal(scoreTradeRecommendation(args).confidence, "LOW");
  const replacement = { ...p("Replacement"), projectedPpg: undefined };
  const result = scoreTradeRecommendation({ ...args, theirPlayers: [target], receive: [target], myPlayers: [give, replacement] });
  assert.equal(result.confidence, "LOW");
  assert.ok(result.warnings.some(message => message.includes("Replacement")));
  const unknown = { ...target, injuryStatus: "UNVERIFIED" };
  assert.equal(scoreTradeRecommendation({ ...args, theirPlayers: [unknown], receive: [unknown] }).confidence, "LOW");
});

test("cuts require review and protected cut candidates keep an offer out of primary recommendations", () => {
  const proposal = offer();
  proposal.recommendationScore.rosterConsequences = { mine: { cutsNeeded: 1, cutCandidates: [{ sleeperId: "cut", name: "Cut" }] } };
  assert.equal(classifyTradeProposal(proposal).group, "NEGOTIATE");
  assert.equal(classifyTradeProposal(proposal, { playerPreferences: { cut: "KEEP" } }).group, "EXPLORATION");
  proposal.recommendationScore.rosterConsequences.mine.cutCandidates = [];
  assert.equal(classifyTradeProposal(proposal).group, "EXPLORATION");
});
