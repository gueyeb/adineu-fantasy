import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { getLeagueContext, getMatchupContext, formatContextText } from "../scripts/league-context.js";

const sampleContext = {
  generatedAt: "2026-09-07T08:00:00.000Z",
  week: 1,
  league: {
    id: "1392715510830878721",
    name: "Adineu 2026",
    teams: 12,
    format: "redraft",
    scoring: "full_ppr",
    rosterSettings: { starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 }, benchSlots: 6, reserveSlots: 1 },
    faab: 1000,
    waiverClear: "Wednesday 09:00 Europe/Paris",
    tradeDeadlineWeek: 12
  },
  myTeam: {
    rosterId: 5,
    owner: "t0z",
    teamName: "Boukki",
    record: { wins: 1, losses: 2, ties: 0 },
    standingsRank: 9,
    pointsFor: 331.16,
    pointsAgainst: 396.7,
    faab: { budget: 1000, used: 503, remaining: 497 },
    waiverPriority: 7,
    streak: "1W",
    starters: [
      { slot: "QB", player: { name: "Jaxson Dart", nflTeam: "NYG", position: "QB" } },
      { slot: "K", player: null }
    ],
    bench: [{ name: "Brock Purdy", nflTeam: "SF", position: "QB" }],
    ir: []
  }
};

test("formatContextText renders league rules, starters, bench and empty slots", () => {
  const text = formatContextText(sampleContext);
  assert.match(text, /ADINEU 2026/);
  assert.match(text, /12 teams · Full PPR/);
  assert.match(text, /FAAB restant: \$497 \/ \$1000 \(503 \$ dépensés\)/);
  assert.match(text, /Bilan: 1-2 · Rang: 9\/12 · PF: 331\.16 · PA: 396\.7/);
  assert.match(text, /MON ROSTER — BOUKKI \(@t0z\)/);
  assert.match(text, /QB Jaxson Dart NYG/);
  assert.match(text, /K EMPTY/);
  assert.match(text, /QB Brock Purdy SF/);
  assert.match(text, /IR\nEMPTY/);
});

test("context API exposes JSON and a copy-pasteable text format", async t => {
  const server = createAppServer({ getContext: async () => sampleContext });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z&mode=compact`);
  assert.equal(jsonResponse.status, 200);
  const body = await jsonResponse.json();
  assert.equal(body.myTeam.owner, "t0z");
  assert.match(body.message, /MON ROSTER/);

  const textResponse = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z&mode=compact&format=text`);
  assert.equal(textResponse.status, 200);
  assert.match(textResponse.headers.get("content-type"), /text\/plain/);
  assert.match(await textResponse.text(), /MON ROSTER/);
});

test("context API rejects an unknown team instead of guessing a roster", async t => {
  const server = createAppServer({
    getContext: async () => { throw new Error("Équipe Sleeper inconnue : personne"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/context?team=personne&mode=compact`);
  assert.equal(response.status, 404);
});

test("context API defaults to decision mode and keeps compact mode available", async t => {
  const server = createAppServer({
    getContext: async () => sampleContext,
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getInjuryStatuses: async () => new Map(),
    getMatchupContext: async () => null,
    getFreeAgents: async () => ({ lastCompletedWeek: 3, degraded: false, coverage: { projectionWeeks: "11/11", statsWeeks: "3/3", playersIndex: true }, byPosition: {} })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const decision = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z`);
  const decisionBody = await decision.json();
  assert.equal(decisionBody.mode, "decision");
  assert.match(decisionBody.message, /ADINEU AI CONTEXT v2 — DECISION/);
  assert.match(decisionBody.message, /FAAB remaining: \$497 \/ \$1000/);

  const compact = await fetch(`http://127.0.0.1:${port}/api/context?team=t0z&mode=compact`);
  const compactBody = await compact.json();
  assert.equal(compactBody.mode, undefined);
  assert.match(compactBody.message, /FAAB restant: \$497 \/ \$1000/);
});

test("getMatchupContext resolves the opponent and reports projection coverage without inventing a win probability", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/rosters")) return [
        { roster_id: 1, owner_id: "u1", starters: ["p1", "p2"], settings: { wins: 1, losses: 2 } },
        { roster_id: 2, owner_id: "u2", starters: ["p3", "p4"], settings: { wins: 2, losses: 1 } }
      ];
      if (url.endsWith("/users")) return [
        { user_id: "u1", display_name: "t0z", metadata: { team_name: "Boukki" } },
        { user_id: "u2", display_name: "rival", metadata: { team_name: "Binaries" } }
      ];
      if (url.endsWith("/matchups/4")) return [
        { roster_id: 1, matchup_id: 3, points: 0, starters: ["p1", "p2"] }, { roster_id: 2, matchup_id: 3, points: 0, starters: ["p3", "p4"] }
      ];
      if (url.includes("/projections/nfl/regular/2026/4")) return { p1: { pts_ppr: 20 }, p2: { pts_ppr: 10 }, p3: { pts_ppr: 18 } };
      return {};
    }
  });
  const matchup = await getMatchupContext({ team: "t0z", week: 4, fetchImpl });
  assert.equal(matchup.opponent.teamName, "Binaries");
  assert.equal(matchup.myProjection.total, 30);
  assert.equal(matchup.myProjection.coverage, "2/9");
  assert.equal(matchup.myProjection.emptySlots, 7);
  assert.equal(matchup.opponentProjection.coverage, "1/9");
  assert.equal(matchup.opponentProjection.missingProjections, 1);
  assert.equal(matchup.winProbability, undefined);
});

test("getLeagueContext splits starters, bench and IR from a raw Sleeper roster", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => {
      if (url.endsWith("/rosters")) {
        return [{
          roster_id: 5,
          owner_id: "owner-1",
          players: ["p-qb", "p-rb", "p-bench", "p-ir"],
          starters: ["p-qb", "0"],
          reserve: ["p-ir"],
          settings: { wins: 2, losses: 1, ties: 0, fpts: 321, fpts_decimal: 45, fpts_against: 299, fpts_against_decimal: 7, waiver_budget_used: 503, waiver_position: 4 },
          metadata: { streak: "2W" }
        }];
      }
      if (url.endsWith("/users")) {
        return [{ user_id: "owner-1", display_name: "t0z", metadata: { team_name: "Boukki" } }];
      }
      return { display_week: 3, week: 3, season: "2026" };
    }
  });

  const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);
  const context = await getLeagueContext({ team: "t0z", fetchImpl, catalogUrl });

  assert.equal(context.myTeam.starters.length, 2);
  assert.equal(context.myTeam.starters[0].player.sleeperId, "p-qb");
  assert.equal(context.myTeam.starters[1].player, null);
  assert.deepEqual(context.myTeam.bench.map(p => p.sleeperId), ["p-rb", "p-bench"]);
  assert.deepEqual(context.myTeam.ir.map(p => p.sleeperId), ["p-ir"]);
  assert.deepEqual(context.myTeam.faab, { budget: 1000, used: 503, remaining: 497 });
  assert.deepEqual(context.myTeam.record, { wins: 2, losses: 1, ties: 0 });
  assert.equal(context.myTeam.pointsFor, 321.45);
  assert.equal(context.myTeam.pointsAgainst, 299.07);
  assert.equal(context.myTeam.waiverPriority, 4);
  assert.equal(context.myTeam.streak, "2W");
});

test("getLeagueContext fails explicitly when the requested Sleeper team is absent", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.endsWith("/rosters")
      ? [{ roster_id: 1, owner_id: "owner-1", players: [], starters: [], reserve: [] }]
      : [{ user_id: "owner-1", display_name: "t0z", metadata: { team_name: "Boukki" } }]
  });
  const catalogUrl = new URL("../public/data/players-catalog.json", import.meta.url);

  await assert.rejects(
    getLeagueContext({ team: "personne", fetchImpl, catalogUrl }),
    /Équipe Sleeper inconnue : personne/
  );
});


test("context and Coach preserve existing playoff output and degrade independently on source failure", async t => {
  let fail=false;
  const odds={ready:true,model:'ADINEU_EXISTING_MONTE_CARLO',probability:0.42,coveragePct:88,seed:1,modelDate:'2026-10-04T10:00:00Z',assumptions:['CURRENT_LINEUPS_FROZEN']};
  const server=createAppServer({getContext:async()=>sampleContext,getPlayoffContext:async()=>{if(fail)throw Error('fixture source failure');return odds;},getPlayerValues:async()=>({byId:new Map(),weeklyProjections:{}}),getInjuryStatuses:async()=>new Map(),getFreeAgents:async()=>({byPosition:{}}),getMatchupContext:async()=>null,analyze:async()=>({results:[]}),coachToken:'fixture-token'});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const context=await (await fetch(`${base}/api/context?team=t0z&mode=decision`)).json();
  const coach=await (await fetch(`${base}/api/coach?team=t0z`,{headers:{authorization:'Bearer fixture-token'}})).json();
  assert.equal(context.strategyState.playoffProbability,0.42);
  assert.deepEqual(coach.teamState.playoffContext,odds);
  fail=true;
  const degraded=await (await fetch(`${base}/api/context?team=t0z&mode=decision`)).json();
  assert.equal(degraded.strategyState.playoffProbability,null);
  assert.equal(degraded.strategyState.playoffContext.reason,'SOURCE_UNAVAILABLE');
});

test("a starter dropped from the roster is an empty matchup slot, not a projection (stale Sleeper lineup)", async () => {
  const fetchImpl = async url => ({ ok: true, json: async () => {
    if (url.endsWith("/rosters")) return [
      { roster_id: 1, owner_id: "u1", players: ["p1", "p2"], starters: ["p1", "0"], settings: {} },
      { roster_id: 2, owner_id: "u2", players: ["p3", "p4"], starters: ["p3", "p4"], settings: {} }
    ];
    if (url.endsWith("/users")) return [{ user_id: "u1", display_name: "t0z", metadata: { team_name: "Boukki" } }, { user_id: "u2", display_name: "rival", metadata: { team_name: "Binaries" } }];
    if (url.endsWith("/matchups/5")) return [
      { roster_id: 1, matchup_id: 3, points: 0, starters: ["p1", "dropped"] }, { roster_id: 2, matchup_id: 3, points: 0, starters: ["p3", "p4"] }
    ];
    if (url.includes("/projections/nfl/regular/2026/5")) return { p1: { pts_ppr: 20 }, dropped: { pts_ppr: 6.8 }, p3: { pts_ppr: 18 }, p4: { pts_ppr: 9 } };
    return {};
  } });
  const matchup = await getMatchupContext({ team: "t0z", week: 5, fetchImpl });
  assert.equal(matchup.myProjection.total, 20);
  assert.deepEqual(matchup.myProjection.staleStarters, ["dropped"]);
  assert.equal(matchup.myProjection.emptySlots, 8);
  assert.equal(matchup.opponentProjection.total, 27);
  assert.deepEqual(matchup.opponentProjection.staleStarters, []);
});
