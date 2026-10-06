import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContext, formatDecisionContext } from "../scripts/ai-context.js";
import { classifyWaiverDecision } from "../public/assets/waiver-model.js";
test("a positive streaming week with unknown long horizon is WATCH rather than IGNORE", () => {
  const decision = classifyWaiverDecision({ position: 'DEF', marketScore: 0, netGain: 0,
    targetWeekDelta: 7.9, horizonCovered: false,
    availability: { availability: 'UNKNOWN', canStartTargetWeek: false } });
  assert.equal(decision.decisionClass, 'STREAMER');
  assert.equal(decision.recommendedAction, 'WATCH');
  assert.ok(decision.actionBlockers.includes('INCOMPLETE_HORIZON'));
  assert.ok(decision.actionBlockers.includes('TARGET_WEEK_ELIGIBILITY_UNVERIFIED'));
  const covered = classifyWaiverDecision({ position: 'DEF', marketScore: 0, netGain: -2,
    targetWeekDelta: 7.9, horizonCovered: true });
  assert.equal(covered.recommendedAction, 'IGNORE', 'a known negative full scenario is not an unknown one');
});

const context = {
  generatedAt: "2026-09-30T12:30:00.000Z",
  week: 4,
  league: {
    name: "Adineu 2026", teams: 12, faab: 1000,
    waiverClear: "Wednesday 09:00 Europe/Paris", tradeDeadlineWeek: 12,
    rosterSettings: { starters: { QB: 1 }, benchSlots: 1, reserveSlots: 1 }
  },
  myTeam: {
    owner: "t0z", teamName: "Boukki", standingsRank: 9,
    record: { wins: 1, losses: 2, ties: 0 }, pointsFor: 331.16, pointsAgainst: 396.7,
    faab: { budget: 1000, used: 503, remaining: 497 }, waiverPriority: 7, streak: "1W",
    starters: [{ slot: "QB", player: { sleeperId: "p1", name: "Starter", position: "QB", nflTeam: "SEA" } }],
    bench: [{ sleeperId: "p2", name: "Bench", position: "WR", nflTeam: "IND" }], ir: []
  }
};

test("decision context combines live balance, player model facts and roster-fit waivers", () => {
  const decision = buildDecisionContext({
    context,
    playerValues: {
      byId: new Map([["p2", { rosPpg: 11.9, rosSource: "SLEEPER_USAGE_BLEND", actualPpg: 9.8, usageScore: 78, usageTrend: 11, xfp: 14.2, signal: "BUY_LOW" }]]),
      weeklyProjections: { p1: { pts_ppr: 18.4 }, p2: { pts_ppr: 12.8 } }
    },
    statuses: new Map([["p2", "Questionable"]]),
    waivers: {
      lastCompletedWeek: 3,
      degraded: false,
      coverage: { projectionWeeks: "11/11", statsWeeks: "3/3", playersIndex: true },
      byPosition: { WR: [{ sleeperId: "fa1", name: "Free Agent", position: "WR", nflTeam: "KC", availability: { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true }, replacementPpg: 8, waiver: { score: 74, category: "PRIORITÉ", rosPpg: 10.2, rosSource: "SLEEPER_USAGE_BLEND", usageScore: 81, usageSignal: null, xfp: 12, faabMarket: [80, 120], reasons: ["Usage surge"], flags: ["USAGE_SURGE"], duration: "BREAKOUT", fit: { legalTransaction: true, horizonCovered: true, fitScore: 82, priorityScore: 88, gainPerWeek: 2.4, dropCandidate: { sleeperId: "p2", name: "Bench", position: "WR" }, dropCandidates: [{ sleeperId: "p2", name: "Bench", position: "WR", immediateValuePerWeek: 0.1, optionValuePerWeek: 0.3, totalCostPerWeek: 0.4, usageScore: 78, byeWeek: 13, regretRisk: "LOW" }], dropCostPerWeek: 0.4, dropOptionValuePerWeek: 0.3, netGainPerWeek: 2, slot: "FLEX", faabMaxForMe: 105 } } }] }
    },
    lineup: { alerts: [], optimal: { currentTotal: 120, optimalTotal: 122.1, gain: 2.1, promote: [], bench: [], slots: [] } },
    matchup: { opponent: { owner: "rival", teamName: "Binaries", record: { wins: 2, losses: 1, ties: 0 } }, myProjection: { total: 122.1, coverage: "9/9" }, opponentProjection: { total: 117.4, coverage: "9/9" } }
  });

  assert.equal(decision.myTeam.faab.remaining, 497);
  assert.equal(decision.myTeam.bench[0].usageSignal, "BUY_LOW");
  assert.equal(decision.topAvailable[0].maxForTeam, 105);
  const text = formatDecisionContext(decision);
  assert.match(text, /ADINEU AI CONTEXT v2 — DECISION/);
  assert.match(text, /TEAM DIAGNOSIS/);
  assert.match(text, /Roster pressure: bench 1\/1; IR 0\/1/);
  assert.match(text, /FAAB remaining: \$497 \/ \$1000/);
  assert.match(text, /Bench IND \| status=Questionable \| proj=12\.8 \[Sleeper\] \| ROS=11\.9 \[SLEEPER_USAGE_BLEND\] \| usage=78 \[Adineu\]/);
  assert.match(text, /ADD NOW\n1\. Free Agent WR KC \| Class=BREAKOUT \| Immediate=50 \| Strategic=89 \| Market=74/);
  assert.match(text, /Drop=Bench \| DropCost=0\.4 pts\/w \| NetGain=2 pts\/w over role horizon/);
  assert.match(text, /Lowest marginal cuts: Bench \(immediate 0\.1, option 0\.3, total 0\.4 pts\/w, usage 78, bye S13, regret LOW\)/);
  assert.match(text, /degraded=false/);
  assert.match(text, /NEXT MATCHUP\nOpponent: Binaries \(@rival\) \| Record: 2-1/);
  assert.match(text, /Win estimate: not included/);
});

test("waiver decision separates league upside from an actionable roster move", () => {
  const watch = classifyWaiverDecision({ position: "WR", marketScore: 76, flags: ["USAGE_SURGE"], usageSignal: null, netGain: -0.4 });
  assert.equal(watch.decisionClass, "BREAKOUT");
  assert.equal(watch.immediateValue, 0);
  assert.equal(watch.strategicUpside, 91);
  assert.equal(watch.recommendedAction, "WATCH");
  assert.match(watch.interpretation, /Conditional scenario/);

  const streamer = classifyWaiverDecision({ position: "QB", marketScore: 50, flags: [], usageSignal: null, netGain: 1.2, availability: { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true } });
  assert.equal(streamer.decisionClass, "STREAMER");
  assert.equal(streamer.recommendedAction, "WATCH");

  const streamerWithUsageSurge = classifyWaiverDecision({ position: "QB", marketScore: 50, flags: ["SNAP_SURGE"], usageSignal: null, netGain: 1.2, availability: { availability: "FREE_AGENT", canAddNow: true, canStartTargetWeek: true } });
  assert.equal(streamerWithUsageSurge.decisionClass, "STREAMER");
  assert.equal(streamerWithUsageSurge.recommendedAction, "WATCH");
});
