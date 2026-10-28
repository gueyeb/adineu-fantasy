import test from "node:test";
import assert from "node:assert/strict";
import { buildLeagueRosterSnapshot, buildLeagueTradeIntelligence } from "../public/assets/league-trade-intelligence.js";
import { targetWeekTradeImpact } from "../public/assets/trade-target.js";
import { scoreTradeRecommendation, tradeReturnScenarios } from "../public/assets/trade-score.js";
import { buildDecisionContext } from "../scripts/ai-context.js";

// League intelligence, the Coach/AI context, the Finder and /api/trade-offer read one offer the same way.
const NOW = Date.parse("2026-10-30T12:00:00Z");
// Review 1 day: ends 31/10 12:00 UTC, after NYJ's Thursday S8 game: every NYJ player moves at S9.
const game = (week, kickoffAt) => ({ season: 2026, week, home_team: "NYJ", away_team: "MIA", kickoffAt });
const games = [game(8, "2026-10-30T00:15:00Z"), game(9, "2026-11-08T18:00:00Z"), game(10, "2026-11-15T18:00:00Z"), game(11, "2026-11-22T18:00:00Z"),
  game(12, "2026-11-29T18:00:00Z"), game(14, "2026-12-13T18:00:00Z")];
const timingContext = { asOf: new Date(NOW - 60_000).toISOString(), season: 2026, reviewDays: 1, deadlineWeek: 12, disabled: false, dataThroughWeek: 7, games };

const player = (name, position, projectedPpg, rank = 40) => ({ sleeperId: name, name, position, projectedPpg, nflTeam: "NYJ", quality: { expertRank: rank } });
function league() {
  const core = x => [player(`${x}QB`, "QB", 18, 60), player(`${x}TE`, "TE", 9, 90), player(`${x}K`, "K", 8, 150), player(`${x}DEF`, "DEF", 8, 150)];
  const mine = [...core("M"), player("MRB1", "RB", 16, 20), player("MRB2", "RB", 15, 24), player("MRB3", "RB", 14, 30), player("MRB4", "RB", 13, 36), player("MWR1", "WR", 16, 22), player("MWR2", "WR", 6, 110)];
  const theirs = [...core("T"), player("TWR1", "WR", 16, 21), player("TWR2", "WR", 15, 25), player("TWR3", "WR", 14, 31), player("TWR4", "WR", 13, 35), player("TRB1", "RB", 16, 23), player("TRB2", "RB", 6, 115)];
  const lists = [mine, theirs, ...Array.from({ length: 10 }, (_, i) => core(`X${i}`))];
  const map = new Map(lists.flat().map(p => [p.sleeperId, p]));
  const at = (players, position, index = 0) => players.filter(p => p.position === position)[index]?.sleeperId || "0";
  const rosters = lists.map((players, i) => ({ roster_id: i + 1, owner_id: `o${i}`, players: players.map(p => p.sleeperId), reserve: [],
    starters: [at(players, "QB"), at(players, "RB"), at(players, "RB", 1), at(players, "WR"), at(players, "WR", 1), at(players, "TE"), at(players, "RB", 2) !== "0" ? at(players, "RB", 2) : at(players, "WR", 2), at(players, "K"), at(players, "DEF")] }));
  const users = rosters.map((r, i) => ({ user_id: r.owner_id, display_name: `Manager${i}`, metadata: { team_name: `Team${i}` } }));
  return buildLeagueRosterSnapshot({ rosters, users, playerFor: id => map.get(id), asOf: "2026-10-30T11:59:00Z" });
}

test("league intelligence averages over the first affectable week window, like the scored offer", () => {
  const snapshot = league();
  const timed = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, week: 8, timingContext, now: NOW });
  const example = timed.topPartners[0].examples[0];
  assert.deepEqual([example.averageWindow.from, example.averageWindow.to], [9, 14]);
  const [mine, theirs] = [timed.teams[0].players, timed.teams[1].players];
  const pick = (list, ids) => list.filter(p => ids.includes(p.sleeperId));
  const score = scoreTradeRecommendation({ myPlayers: mine, theirPlayers: theirs, give: pick(mine, example.give.map(p => p.playerId)), receive: pick(theirs, example.receive.map(p => p.playerId)), week: 8, cutContext: timingContext, now: NOW });
  assert.deepEqual([example.myDeltaPerWeek, example.theirDeltaPerWeek], [score.my_lineup_delta, score.their_lineup_delta]);
  // Without fresh timing the live week is kept, as in the Finder.
  const untimed = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, week: 8 });
  assert.equal(untimed.topPartners[0].examples[0].averageWindow.from, 8);
});

test("the Coach/AI decision context passes the trade window to league intelligence", () => {
  const snapshot = league();
  const context = { generatedAt: snapshot.asOf, week: 8, leagueRosters: snapshot,
    league: { name: "Test", teams: 12, rosterSettings: { starters: { QB: 1 }, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { rosterId: 1, owner: "Manager0", teamName: "Team0", record: { wins: 1, losses: 1 }, starters: [], bench: [], ir: [] } };
  const weeklyProjections = Object.fromEntries(snapshot.teams.flatMap(team => team.players).map(p => [p.sleeperId, { pts_ppr: p.projectedPpg }]));
  const decision = buildDecisionContext({ context, playerValues: { weeklyProjections, timingContext }, now: NOW });
  assert.equal(decision.leagueTradeIntelligence.topPartners[0].examples[0].averageWindow.from, 9);
});

test("target-week impact equals the weekly simulation's row for that week, far-week usage blend included", () => {
  const kc = (id, position, xfp = null) => ({ sleeperId: id, name: id, position, nflTeam: "KC", ...(xfp === null ? {} : { xfp }) });
  const roster = prefix => [kc(`${prefix}-qb`, "QB"), kc(`${prefix}-rb1`, "RB"), kc(`${prefix}-rb2`, "RB"), kc(`${prefix}-te`, "TE"), kc(`${prefix}-k`, "K"), kc(`${prefix}-def`, "DEF"), kc(`${prefix}-wr2`, "WR")];
  const give = kc("give", "WR", 6), receive = kc("receive", "WR", 18);
  const mine = [...roster("m"), give], theirs = [...roster("t"), receive];
  const projectionsByWeek = {};
  for (let w = 8; w <= 14; w++) projectionsByWeek[w] = Object.fromEntries([...mine, ...theirs].map(p => [p.sleeperId, { pts_ppr: p === give ? 16 : p === receive ? 10 : 5 }]));
  const target = targetWeekTradeImpact({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive], targetWeek: 11, currentWeek: 8, projectionsByWeek });
  const row = tradeReturnScenarios({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive], week: 8, projectionsByWeek }).scenarios[0].byWeek.find(r => r.week === 11);
  assert.deepEqual([target.myDelta, target.theirDelta], [row.myDelta, row.theirDelta]);
  // 0.8 × projection + 0.2 × xFP: 16 → 14 and 10 → 11.6, not the raw 16 vs 10.
  assert.equal(target.myDelta, -2.4);
  // The next two weeks stay on Sleeper's projection alone.
  assert.equal(targetWeekTradeImpact({ myPlayers: mine, theirPlayers: theirs, give: [give], receive: [receive], targetWeek: 9, currentWeek: 8, projectionsByWeek }).myDelta, -6);
});
