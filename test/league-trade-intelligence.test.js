import test from "node:test";
import assert from "node:assert/strict";
import { buildLeagueRosterSnapshot, buildLeagueTradeIntelligence, formatLeagueTradeIntelligence } from "../public/assets/league-trade-intelligence.js";
import { buildDecisionContext, formatDecisionContext } from "../scripts/ai-context.js";

// Synthetic complete 12-team league: target has RB depth, partner has WR depth.
const player = (name, position, projectedPpg, rank = 40) => ({ sleeperId: name, name, position, projectedPpg, nflTeam: "NYJ", quality: { expertRank: rank } });
function fixture() {
  const core = x => [player(`${x}QB`, "QB", 18, 60), player(`${x}TE`, "TE", 9, 90), player(`${x}K`, "K", 8, 150), player(`${x}DEF`, "DEF", 8, 150)];
  const mine = [...core("M"), player("MRB1", "RB", 16, 20), player("MRB2", "RB", 15, 24), player("MRB3", "RB", 14, 30), player("MRB4", "RB", 13, 36), player("MWR1", "WR", 16, 22), player("MWR2", "WR", 6, 110)];
  const theirs = [...core("T"), player("TWR1", "WR", 16, 21), player("TWR2", "WR", 15, 25), player("TWR3", "WR", 14, 31), player("TWR4", "WR", 13, 35), player("TRB1", "RB", 16, 23), player("TRB2", "RB", 6, 115)];
  const lists = [mine, theirs, ...Array.from({ length: 10 }, (_, i) => [...core(`X${i}`)])];
  const map = new Map(lists.flat().map(p => [p.sleeperId, p]));
  const declaredIds = players => {
    const at = (position, index = 0) => players.filter(p => p.position === position)[index]?.sleeperId || "0";
    return [at("QB"), at("RB"), at("RB", 1), at("WR"), at("WR", 1), at("TE"), at("RB", 2) !== "0" ? at("RB", 2) : at("WR", 2), at("K"), at("DEF")];
  };
  const rosters = lists.map((players, i) => ({ roster_id: i + 1, owner_id: `private-${i}`, players: players.map(p => p.sleeperId), starters: declaredIds(players), reserve: [] }));
  const users = rosters.map((r, i) => ({ user_id: r.owner_id, display_name: `Manager${i}`, metadata: { team_name: `Team${i}` } }));
  const snapshot = buildLeagueRosterSnapshot({ rosters, users, playerFor: id => map.get(id), asOf: "2026-10-26T09:00:00Z" });
  return { snapshot, rosters, users, map };
}

test("all 12 rosters preserve official slots, bench, IR, byes and privacy", () => {
  const { rosters, users, map } = fixture();
  rosters[0].reserve = ["MRB4"];
  const snapshot = buildLeagueRosterSnapshot({ rosters, users, playerFor: id => map.get(id) });
  const report = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, week: 8 });
  assert.equal(report.teams.length, 12);
  assert.equal(report.partners.length, 11);
  assert.equal(report.teams[0].ir[0].name, "MRB4");
  assert.ok(report.teams[0].bench.every(p => p.name !== "MRB4"));
  assert.equal(report.teams[0].declaredStarters[0].player.name, "MQB");
  assert.equal(report.teams[0].players[0].byeWeek, 13);
  assert.ok(!JSON.stringify(report).includes("private-"));
  assert.ok(formatLeagueTradeIntelligence(report).some(line => line.includes("OPTIMAL (model)")));
});

test("rank partners by mutual marginal gains with FLEX and honor untouchables", () => {
  const { snapshot } = fixture();
  const report = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1 });
  assert.equal(report.topPartners[0].rosterId, 2);
  assert.ok(report.topPartners[0].examples.some(example => example.give.position === "RB" && example.receive.position === "WR" && example.myDeltaPerWeek >= 7 && example.theirDeltaPerWeek >= 7));
  assert.ok(report.topPartners.every(partner => partner.examples.every(example => example.myDeltaPerWeek >= 1.5 && example.theirDeltaPerWeek > 0)));
  const locked = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, playerPreferences: Object.fromEntries(snapshot.teams[0].players.map(p => [p.sleeperId, "UNTOUCHABLE"])) });
  assert.equal(locked.topPartners.length, 0);
  const rb = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, preferredPosition: "RB" });
  assert.ok(rb.partners.every(partner => partner.examples.every(example => example.receive.position === "RB")));
});

test("stale starter, missing ownership/metadata and duplicate ownership block qualified partners", () => {
  const { snapshot } = fixture();
  snapshot.teams[1].players.push(snapshot.teams[0].players[0]);
  let report = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1 });
  assert.equal(report.topPartners.length, 0);
  assert.ok(report.teams[0].coverage.issues.some(issue => issue.startsWith("OWNERSHIP_CONFLICT")));
  const { rosters, users, map } = fixture();
  rosters[1].starters[0] = "dropped";
  delete rosters[2].players;
  map.delete("MRB4");
  report = buildLeagueTradeIntelligence({ snapshot: buildLeagueRosterSnapshot({ rosters, users, playerFor: id => map.get(id) }), targetRosterId: 1 });
  assert.equal(report.topPartners.length, 0);
  assert.equal(report.teams[1].declaredStarters[0].player, null);
  assert.ok(report.teams[2].coverage.issues.includes("OWNERSHIP_UNAVAILABLE"));
  assert.deepEqual(buildLeagueTradeIntelligence().partners, []);
  assert.equal(buildLeagueTradeIntelligence({ snapshot, targetRosterId: 99 }).status, "TARGET_UNAVAILABLE");
});

test("decision export enriches every roster with model facts and includes full league text", () => {
  const { snapshot } = fixture();
  const context = { generatedAt: snapshot.asOf, week: 8, leagueRosters: snapshot,
    league: { name: "Test", teams: 12, rosterSettings: { starters: { QB: 1 }, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { rosterId: 1, owner: "Manager0", teamName: "Team0", record: { wins: 1, losses: 1 }, starters: [], bench: [], ir: [] } };
  const projections = Object.fromEntries(snapshot.teams.flatMap(team => team.players).map(p => [p.sleeperId, { pts_ppr: p.projectedPpg }]));
  const decision = buildDecisionContext({ context, playerValues: { weeklyProjections: projections, byId: new Map([["TWR4", { rosPpg: 13, rosSource: "TEST" }]]) }, statuses: new Map([["TWR4", "Questionable"]]) });
  const opponent = decision.leagueTradeIntelligence.teams[1].players.find(p => p.sleeperId === "TWR4");
  assert.equal(opponent.rosPpg, 13);
  assert.equal(opponent.injuryStatus, "Questionable");
  const text = formatDecisionContext(decision);
  assert.match(text, /TEAM Team11/);
  assert.match(text, /PARTNERS — mutual lineup fit/);
  assert.match(text, /TWR4 WR NYJ/);
});
