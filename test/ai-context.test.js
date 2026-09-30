import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContext, formatDecisionContext } from "../scripts/ai-context.js";

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
      byPosition: { WR: [{ sleeperId: "fa1", name: "Free Agent", position: "WR", nflTeam: "KC", replacementPpg: 8, waiver: { score: 74, category: "PRIORITÉ", rosPpg: 10.2, rosSource: "SLEEPER_USAGE_BLEND", usageScore: 81, usageSignal: null, xfp: 12, faabMarket: [80, 120], reasons: ["Usage surge"], duration: "BREAKOUT", fit: { fitScore: 82, priorityScore: 88, gainPerWeek: 2.4, dropCandidate: { sleeperId: "p2", name: "Bench", position: "WR" }, dropCostPerWeek: 0.4, dropOptionValuePerWeek: 0.3, netGainPerWeek: 2, slot: "FLEX", faabMaxForMe: 105 } } }] }
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
  assert.match(text, /Free Agent WR KC \| Priority=88 \| Market=74 \| SurplusCaptured=82% \| GrossGain=2\.4 pts\/w \| Drop=Bench \| DropCost=0\.4 pts\/w \| NetGain=2 pts\/w/);
  assert.match(text, /degraded=false/);
  assert.match(text, /NEXT MATCHUP\nOpponent: Binaries \(@rival\) \| Record: 2-1/);
  assert.match(text, /Win estimate: not included/);
});
