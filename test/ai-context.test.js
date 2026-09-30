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
      byPosition: { WR: [{ sleeperId: "fa1", name: "Free Agent", position: "WR", nflTeam: "KC", waiver: { score: 74, category: "PRIORITÉ", rosPpg: 10.2, rosSource: "SLEEPER_USAGE_BLEND", usageScore: 81, usageSignal: null, xfp: 12, faabMarket: [80, 120], reasons: ["Usage surge"], duration: "BREAKOUT", fit: { fitScore: 82, gainPerWeek: 2.4, slot: "FLEX", faabMaxForMe: 105 } } }] }
    },
    lineup: { alerts: [], optimal: { gain: 2.1 } }
  });

  assert.equal(decision.myTeam.faab.remaining, 497);
  assert.equal(decision.myTeam.bench[0].usageSignal, "BUY_LOW");
  assert.equal(decision.topAvailable[0].maxForTeam, 105);
  const text = formatDecisionContext(decision);
  assert.match(text, /ADINEU AI CONTEXT v2 — DECISION/);
  assert.match(text, /FAAB remaining: \$497 \/ \$1000/);
  assert.match(text, /Bench IND \| status=Questionable \| proj=12\.8 \| ROS=11\.9 \| usage=78 \| trend=11 \| xFP=14\.2 \| actual=9\.8 \| signal=BUY_LOW/);
  assert.match(text, /Free Agent WR KC \| Market=74 \| Fit=82 \| Gain=2\.4 pts\/w \| FAAB=80–120 \$ \| Max=105 \$/);
  assert.match(text, /degraded=false/);
});
