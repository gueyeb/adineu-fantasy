import test from "node:test";
import assert from "node:assert/strict";
import { classifyWaiverPresentation, partitionWaiverDecisions, renderWaiverDecisionBoard, waiverAvailabilityLabel } from "../public/assets/waiver-decision-view.js";
const asOf = "2026-10-28T07:00:00Z", now = Date.parse(asOf);
const candidate = (action = "ADD_NOW") => ({ name: "Test", position: "RB", waiver: { decision: { recommendedAction: action, actionBlockers: [] }, suggestedBid: 0, personalMaxBid: 10, fit: { legalTransaction: true, horizonCovered: true, netGainTotal: 3 } }, availability: { availability: "FREE_AGENT", canAddNow: true, verified: true, availabilitySource: "OPERATOR_EVIDENCE" } });
const classify = p => classifyWaiverPresentation(p, { asOf, now });
test("verified free adds differ from claims and inferred availability", () => {
  const add = candidate(); assert.equal(classify(add).bucket, "now");
  const inferred = structuredClone(add); inferred.availability.availabilitySource = "LEAGUE_RULES_INFERRED";
  assert.equal(classify(inferred).bucket, "prepare");
  const claim = candidate("CLAIM_IF_CHEAP"); claim.availability.availability = "WAIVER_LOCKED";
  assert.equal(classify(claim).bucket, "prepare", "a real zero-dollar bid remains preparation");
  claim.waiver.suggestedBid = null; assert.equal(classify(claim).bucket, "watch");
  assert.equal(partitionWaiverDecisions([add, inferred, claim], { asOf, now }).watch.length, 1);
});
test("blockers, coverage gaps, missing evidence and stale snapshots never promote to action now", () => {
  const blocked = candidate(); blocked.waiver.decision.actionBlockers = ["GAME_LOCKED"];
  assert.equal(classify(blocked).bucket, "watch");
  const missing = candidate(); delete missing.waiver.decision.actionBlockers;
  assert.equal(classify(missing).bucket, "watch");
  assert.equal(classifyWaiverPresentation(candidate(), { asOf, now: now + 300001 }).bucket, "watch");
  assert.equal(classifyWaiverPresentation(candidate()).bucket, "watch");
});
test("presentation escapes content, preserves engine decisions and separates unavailable from empty", () => {
  const player = candidate(); player.name = '<img src=x onerror=alert(1)>'; const before = structuredClone(player);
  const html = renderWaiverDecisionBoard({ week: 8, availabilityAsOf: asOf, byPosition: { RB: [player] } }, { now });
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'));
  assert.deepEqual(player, before);
  assert.match(renderWaiverDecisionBoard({}, { available: false }), /Décisions indisponibles/);
  assert.match(renderWaiverDecisionBoard({ availabilityAsOf: asOf }, { now }), /Aucun ajout libre vérifié/);
});

test("catalog availability uses readable labels and preserves inferred status", () => {
  const player = candidate("CLAIM_IF_CHEAP"); player.availability = { availability: "WAIVER_LOCKED", availabilitySource: "LEAGUE_RULES_INFERRED" };
  assert.match(waiverAvailabilityLabel(player), /déduit, à confirmer/);
  assert.match(waiverAvailabilityLabel(player), /claim à préparer/);
  assert.ok(!waiverAvailabilityLabel(player).includes("WAIVER_LOCKED"));
});
