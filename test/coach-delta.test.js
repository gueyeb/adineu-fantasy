import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { coachDecisionState, diffCoachStates, formatCoachDelta, kickoffLookup } from "../scripts/coach-delta.js";

const NOW = Date.parse("2026-11-01T15:00:00Z");
const asOf = new Date(NOW - 60_000).toISOString();
const step = (over = {}) => ({ playerId: "10", name: "T.J. Hockenson", position: "TE", nflTeam: "MIN", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 9,
  presentationFacts: { legalTransaction: true, horizonCovered: true, actionBlockers: [], confirmation: null }, actionBlockers: [], roleConfirmation: "CONFIRMED", decisionClass: "STARTER_UPGRADE", dependsOnPlayerIds: [], ...over });
const plan = (over = {}) => ({ week: 9, team: "Boukki", availabilityAsOf: asOf, publishable: true, coherence: { decisionStatus: { status: "EXECUTABLE" } },
  acquisitionPlan: { steps: [step()] }, waiverActions: { ADD_NOW: [], CLAIM_IF_CHEAP: [] }, watchlist: [],
  lineup: { alerts: [], optimal: { changes: [] } }, tradeTarget: null, ...over });
const state = p => coachDecisionState(p, { now: NOW });

test("first bulletin and a new week send the full report", () => {
  const first = diffCoachStates(null, state(plan()), { now: NOW });
  assert.deepEqual([first.reset, first.notify], ["NO_PREVIOUS_STATE", true]);
  const nextWeek = diffCoachStates(state(plan({ week: 8 })), state(plan()), { now: NOW });
  assert.deepEqual([nextWeek.reset, nextWeek.notify], ["NEW_WEEK", true]);
  assert.equal(formatCoachDelta(first, { team: "Boukki", week: 9, fullBulletin: "FULL" }), "FULL");
});

test("an unchanged plan, or gains moving by decimals, is not a notification", () => {
  const before = state(plan());
  const after = state(plan({ acquisitionPlan: { steps: [step({ netGainTotal: 3.4 })] } }));
  const delta = diffCoachStates(before, after, { now: NOW });
  assert.equal(delta.notify, false);
  assert.match(formatCoachDelta(delta, { team: "Boukki", week: 9, fullBulletin: "FULL" }), /^🧠 COACH BOUKKI — S9 : aucun changement utile depuis/);
});

test("recommendation, blocker, role, lineup and publishability changes are listed", () => {
  const before = state(plan({ acquisitionPlan: { steps: [step({ actionBlockers: ["PROMOTION_UNCONFIRMED"], presentationFacts: { legalTransaction: true, horizonCovered: true, actionBlockers: ["PROMOTION_UNCONFIRMED"] }, roleConfirmation: "UNCONFIRMED" }),
    step({ playerId: "20", name: "Cincinnati", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 10 })] } }));
  const after = state(plan({ coherence: { decisionStatus: { status: "DEGRADED" } },
    acquisitionPlan: { steps: [step({ suggestedBid: 12 }), step({ playerId: "30", name: "Khalil Shakir", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 4 })] },
    lineup: { alerts: [], optimal: { changes: [{ slot: "RB2", in: { sleeperId: "5", name: "Jonah Coleman", nflTeam: "DEN" }, out: { sleeperId: "6", name: "Alvin Kamara", nflTeam: "NO" } }] } } }));
  const delta = diffCoachStates(before, after, { now: NOW });
  const types = delta.events.map(event => event.type).sort();
  assert.deepEqual(types, ["BLOCKER_LIFTED", "LINEUP_CHANGED", "NEW_RECOMMENDATION", "PUBLISHABILITY_CHANGED", "RECOMMENDATION_CHANGED", "RECOMMENDATION_WITHDRAWN", "ROLE_CHANGED"]);
  assert.equal(delta.notify, true);
  const text = formatCoachDelta(delta, { team: "Boukki", week: 9, fullBulletin: "FULL", pageUrl: "https://x.test/coach/" });
  assert.match(text, /T\.J\. Hockenson : blocage levé \(PROMOTION_UNCONFIRMED\)/);
  assert.match(text, /claim 9 \$ .* → claim 12 \$/);
  assert.match(text, /Retiré du plan : Cincinnati/);
  assert.match(text, /Nouveau : Khalil Shakir · claim 4 \$/);
  assert.match(text, /aucune soumission automatique/);
});

test("a decision becoming actionable now and a move close to kickoff are flagged", () => {
  const add = over => step({ playerId: "40", name: "Jacoby Brissett", recommendedAction: "ADD_NOW", suggestedBid: null,
    availability: { availability: "FREE_AGENT", canAddNow: true, verified: true, availabilitySource: "OPERATOR_EVIDENCE" }, ...over });
  const before = state(plan({ acquisitionPlan: { steps: [add({ availability: { availability: "FREE_AGENT", canAddNow: true, verified: false, availabilitySource: "LEAGUE_RULES_INFERRED" } })] } }));
  const lineup = { alerts: [], optimal: { changes: [{ slot: "QB", in: { sleeperId: "40", name: "Jacoby Brissett", nflTeam: "ARI" }, out: { sleeperId: "41", name: "Starter", nflTeam: "ARI" } }] } };
  const after = state(plan({ acquisitionPlan: { steps: [add()] }, lineup }));
  const kickoffOf = kickoffLookup({ season: 2026, games: [{ season: 2026, week: 9, home_team: "ARI", away_team: "SEA", kickoffAt: "2026-11-01T17:00:00Z" }] }, 9);
  const delta = diffCoachStates({ ...before, lineup: after.lineup }, after, { now: NOW, kickoffOf });
  const types = delta.events.map(event => event.type);
  assert.ok(types.includes("NEAR_KICKOFF"), "kickoff in two hours");
  assert.ok(types.includes("NEW_ACTIONABLE"), "inferred availability → operator evidence moves prepare → now");
  assert.equal(before.decisions["40"].bucket, "prepare");
  assert.equal(diffCoachStates({ ...before, lineup: after.lineup }, after, { now: NOW, kickoffOf: () => NaN }).events.some(event => event.type === "NEAR_KICKOFF"), false, "unknown kickoff is not guessed");
  assert.ok(Number.isNaN(kickoffLookup(null, 9)("ARI")));
});

test("?delta=1 on the bearer Coach call sends only changes, stores the state and says when nothing changed", async t => {
  let stored = null;
  let failRead = false;
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    getContext: async () => ({ week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
      myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } } }),
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    getMatchupContext: async () => null,
    analyze: async () => ({ results: [{ proposals: [] }] }),
    decisionLogStore: {
      coachState: async () => { if (failRead) throw new Error("down"); return stored; },
      saveCoachState: async (rosterId, value) => { stored = value; return true; }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const call = query => fetch(`http://127.0.0.1:${server.address().port}/api/coach${query}`, { headers: { authorization: "Bearer test-api" } }).then(response => response.json());

  const plain = await call("");
  assert.equal(plain.notify, undefined, "without the flag the bulletin is unchanged");
  assert.equal(stored, null, "and nothing is stored");
  const first = await call("?delta=1");
  assert.deepEqual([first.notify, first.delta.reset, first.delta.stateStored], [true, "NO_PREVIOUS_STATE", true]);
  assert.equal(first.message, plain.message);
  assert.equal(stored.week, 2);
  const second = await call("?delta=1");
  assert.equal(second.notify, false);
  assert.match(second.message, /aucun changement utile/);
  assert.ok(second.message.length <= 4096);
  failRead = true;
  const unavailable = await call("?delta=1");
  assert.deepEqual([unavailable.notify, unavailable.delta.reset], [true, "STATE_UNAVAILABLE"]);
});

test("bearer Coach calls add the trade option to the week's plan, and a store failure never blocks the bulletin", async t => {
  const recorded = [];
  let fail = false;
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    getContext: async () => ({ week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
      myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } } }),
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    getMatchupContext: async () => null,
    analyze: async () => ({ results: [{ proposals: [] }] }),
    decisionLogStore: {
      coachState: async () => null, saveCoachState: async () => true,
      recordTradeOption: async (rosterId, week, option) => { if (fail) throw new Error("down"); recorded.push({ rosterId, week, status: option.status }); return { recorded: option.status }; }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const call = () => fetch(`http://127.0.0.1:${server.address().port}/api/coach`, { headers: { authorization: "Bearer test-api" } });
  assert.equal((await call()).status, 200);
  assert.deepEqual(recorded, [{ rosterId: 1, week: 2, status: "NONE" }], "no Coach trade that week is recorded as NONE");
  fail = true;
  assert.equal((await call()).status, 200);
});
