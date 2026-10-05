import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRosterPreferences } from "../public/assets/roster-preferences.js";
import { buildAcquisitionPlan } from "../public/assets/waiver-plan.js";
import { evaluateRosterFit, classifyWaiverDecision } from "../public/assets/waiver-model.js";

const asOf = "2026-10-05T10:00:00Z";
const preference = { playerId: "raymond", rosterId: 1, kind: "KEEP_UNTIL", createdAt: "2026-10-04T09:00:00Z", expiresAt: "2026-10-06T09:00:00Z", penaltyPoints: 5, reason: "Observer la continuité après S4" };
test("temporary keep preferences expire, are revocable and belong to one roster", () => {
  assert.equal(normalizeRosterPreferences([preference], { asOf, rosterId: 1 }).length, 1);
  assert.equal(normalizeRosterPreferences([preference], { asOf, rosterId: 2 }).length, 0);
  assert.equal(normalizeRosterPreferences([{ ...preference, revokedAt: asOf }], { asOf, rosterId: 1 }).length, 0);
  assert.equal(normalizeRosterPreferences([preference], { asOf: preference.expiresAt, rosterId: 1 }).length, 0);
  assert.equal(normalizeRosterPreferences([{ ...preference, penaltyPoints: -1 }], { asOf, rosterId: 1 }).length, 0);
});
const starters = [["QB",20],["RB",15],["RB",14],["WR",8],["WR",7],["TE",10],["WR",6],["K",8],["DEF",7]].map(([position,pace],i)=>({sleeperId:`s${i}`,name:`Starter ${i}`,position,pace}));
const myPlayers = [...starters,{sleeperId:"raymond",name:"Raymond",position:"WR",pace:1},{sleeperId:"bench",name:"Other bench",position:"RB",pace:2}];
const row = (id, pace) => ({sleeperId:id,name:id,position:"WR",effectivePpg:pace,faabMarket:[20,40],surplusPoints:100,events:{roleWeeks:1}});
const fitArgs = { myPlayers, week:4, paceOf:p=>p.pace??p.effectivePpg, starterIds:new Set(starters.map(p=>p.sleeperId)), faabRemaining:50 };
test("soft keep changes cut selection without changing fantasy gain or forbidding an overriding benefit", () => {
  const candidate = row("add",14);
  const fit = evaluateRosterFit({ ...fitArgs, marketRow:candidate, rosterPreferences:[preference] });
  assert.equal(fit.dropCandidate.sleeperId,"bench");
  const preferred = fit.dropCandidates.find(p=>p.sleeperId==="raymond");
  assert.equal(preferred.preferencePenaltyTotal,5);
  assert.equal(preferred.netGainTotal, fit.netGainTotal);
  const forced = evaluateRosterFit({ ...fitArgs, myPlayers:[...starters,myPlayers[9]], marketRow:candidate, rosterPreferences:[preference] });
  assert.equal(forced.dropCandidate.sleeperId,"raymond");
  assert.equal(forced.preferenceOverridden,true);
});
test("plan recomputes after each acquisition, uses distinct cuts and reserves the available budget", () => {
  const candidates=[row("A",14),row("B",13)];
  const evaluateCandidate=(candidate,state)=>{
    const fit=evaluateRosterFit({...fitArgs,...state,marketRow:candidate});
    const availability={availability:"WAIVER_LOCKED",canAddNow:false,canStartTargetWeek:true,waiverProcessesAt:"2026-10-06T08:00:00Z"};
    const decision=classifyWaiverDecision({position:"WR",netGain:fit.netGainAverage,targetWeekDelta:fit.targetWeekDelta,availability,legalTransaction:fit.legalTransaction,horizonCovered:fit.horizonCovered});
    return {...candidate,availability,waiver:{fit,decision,suggestedBid:fit.faabMaxForMe,personalMaxBid:fit.faabMaxForMe}};
  };
  const plan=buildAcquisitionPlan({candidates,myPlayers,faabRemaining:30,evaluateCandidate});
  assert.equal(plan.steps.length,2);
  assert.equal(new Set(plan.steps.map(step=>step.dropCandidate.sleeperId)).size,2);
  assert.equal(plan.steps[1].targetWeekDelta,6,"second gain is recomputed after A fills FLEX");
  assert.ok(plan.reservedFaab<=30);
  assert.equal(plan.steps[1].dependsOnPlayerIds[0],"A");
  assert.equal(plan.executionMode,"REVALIDATE_AFTER_EACH_RESULT");
});
test("plan suppresses unknown availability and never invents a second roster slot", () => {
  const plan=buildAcquisitionPlan({candidates:[row("A",14)],myPlayers,faabRemaining:30,evaluateCandidate:candidate=>({...candidate,waiver:{decision:{recommendedAction:"WATCH"}}})});
  assert.equal(plan.steps.length,0);
});

test("a free roster spot is consumed once; the next acquisition requires a cut", () => {
  const evaluateCandidate = (candidate, state) => {
    const fit = evaluateRosterFit({ ...fitArgs, ...state, marketRow: candidate });
    return { ...candidate, availability: { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true }, waiver: { fit, suggestedBid: 0, personalMaxBid: fit.faabMaxForMe, decision: { recommendedAction: "ADD_NOW" } } };
  };
  const plan = buildAcquisitionPlan({ candidates: [row("A", 14), row("B", 13)], myPlayers, rosterCapacity: myPlayers.length + 1, faabRemaining: 50, evaluateCandidate });
  assert.equal(plan.steps[0].dropCandidate, null);
  assert.ok(plan.steps[1].dropCandidate);
  assert.notEqual(plan.steps[1].dropCandidate.sleeperId, "A", "a committed acquisition is protected from the next cut");
  assert.equal(plan.reservedFaab, 0);
  assert.equal(plan.remainingFaab, 50);
});

test("plan rejects a free-agent action carrying an auction charge", () => {
  const plan = buildAcquisitionPlan({ candidates: [row("A", 14)], myPlayers, faabRemaining: 50,
    evaluateCandidate: candidate => ({ ...candidate,
      availability: { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true },
      waiver: { fit: { legalTransaction: true, horizonCovered: true, netGainTotal: 8 },
        suggestedBid: 20, personalMaxBid: 20, decision: { recommendedAction: "ADD_NOW" } } }) });
  assert.equal(plan.steps.length, 0);
});
