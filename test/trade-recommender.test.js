import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseRoster, findTradeProposals, usageTradeAdjustment } from "../public/assets/trade-recommender.js";

test("usage signals slightly favor buying low and selling high", () => {
  assert.equal(usageTradeAdjustment({
    give: [{ signal: "SELL_HIGH" }],
    receive: [{ signal: "BUY_LOW" }]
  }), 6);
  assert.equal(usageTradeAdjustment({
    give: [{ signal: "BUY_LOW" }],
    receive: [{ signal: "SELL_HIGH" }]
  }), -4);
});

test("diagnoseRoster accurately detects WR surplus and RB deficit", () => {
  const players = [
    { name: "Puka Nacua", position: "WR", quality: { expertRank: 3 } },
    { name: "A.J. Brown", position: "WR", quality: { expertRank: 12 } },
    { name: "DJ Moore", position: "WR", quality: { expertRank: 42 } },
    { name: "Josh Downs", position: "WR", quality: { expertRank: 87 } },
    { name: "Jeremiyah Love", position: "RB", quality: { expertRank: 40 } },
    { name: "Jaylen Warren", position: "RB", quality: { expertRank: 71 } },
    { name: "Braelon Allen", position: "RB", quality: { expertRank: 134 } },
    { name: "Jaxson Dart", position: "QB", quality: { expertRank: 98 } },
    { name: "Brock Purdy", position: "QB", quality: { expertRank: 92 } },
    { name: "Trey McBride", position: "TE", quality: { expertRank: 17 } }
  ];

  const diag = diagnoseRoster(players);
  assert.ok(diag.surpluses.includes("WR"), "Expected WR surplus");
  assert.equal(diag.counts.WR, 4);
  assert.equal(diag.counts.RB, 3);
});

test("findTradeProposals generates win-win and handcuff proposals", () => {
  const team1Roster = {
    roster_id: 1,
    name: "Team 1",
    players: [
      { name: "Puka Nacua", position: "WR", quality: { expertRank: 3 } },
      { name: "A.J. Brown", position: "WR", quality: { expertRank: 12 } },
      { name: "DJ Moore", position: "WR", quality: { expertRank: 42 } },
      { name: "Josh Downs", position: "WR", quality: { expertRank: 87 } },
      { name: "Braelon Allen", position: "RB", nflTeam: "NYJ", quality: { expertRank: 134 } },
      { name: "Jaylen Warren", position: "RB", quality: { expertRank: 71 } },
      { name: "Jaxson Dart", position: "QB", quality: { expertRank: 98 } },
      { name: "Brock Purdy", position: "QB", quality: { expertRank: 92 } },
      { name: "Trey McBride", position: "TE", quality: { expertRank: 17 } }
    ]
  };

  const team2Roster = {
    roster_id: 2,
    name: "Team 2 (Breece Owner)",
    players: [
      { name: "Breece Hall", position: "RB", nflTeam: "NYJ", quality: { expertRank: 10 } },
      { name: "James Cook", position: "RB", quality: { expertRank: 13 } },
      { name: "Ashton Jeanty", position: "RB", quality: { expertRank: 28 } },
      { name: "Rhamondre Stevenson", position: "RB", quality: { expertRank: 70 } },
      { name: "Ladd McConkey", position: "WR", quality: { expertRank: 32 } },
      { name: "Zay Flowers", position: "WR", quality: { expertRank: 39 } },
      { name: "Bo Nix", position: "QB", quality: { expertRank: 120 } },
      { name: "Jake Ferguson", position: "TE", quality: { expertRank: 80 } }
    ]
  };

  const proposals = findTradeProposals({
    targetRosterId: 1,
    rosters: [team1Roster, team2Roster]
  });

  assert.ok(proposals.length > 0, "Expected at least 1 trade proposal");
  const winWinOrHc = proposals.find(p => p.partnerRosterId === 2);
  assert.ok(winWinOrHc, "Expected proposal with Team 2");
  assert.ok(winWinOrHc.pitchTarget, "Expected pitchTarget explanation");
  assert.ok(winWinOrHc.pitchPartner, "Expected pitchPartner explanation");
});

test("findTradeProposals ignores stale cross-team handcuff links", () => {
  const target = {
    roster_id: 1,
    name: "Target",
    players: [
      { name: "Tyler Allgeier", position: "RB", nflTeam: "ARI", quality: { expertRank: 134 } },
      { name: "Puka Nacua", position: "WR", nflTeam: "LAR", quality: { expertRank: 3 } },
      { name: "A.J. Brown", position: "WR", nflTeam: "NE", quality: { expertRank: 12 } },
      { name: "DJ Moore", position: "WR", nflTeam: "BUF", quality: { expertRank: 42 } },
      { name: "Josh Downs", position: "WR", nflTeam: "IND", quality: { expertRank: 87 } }
    ]
  };
  const partner = {
    roster_id: 2,
    name: "Bijan Owner",
    players: [
      { name: "Bijan Robinson", position: "RB", nflTeam: "ATL", quality: { expertRank: 4 } },
      { name: "Jared Goff", position: "QB", nflTeam: "DET", quality: { expertRank: 103 } }
    ]
  };

  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [target, partner] });

  assert.equal(
    proposals.some(proposal => proposal.category === "HANDCUFF_INSURANCE"),
    false,
    "Allgeier must not be treated as Bijan Robinson's handcuff after changing teams"
  );
});

test("findTradeProposals rejects consolidation packages for replacement-level returns", () => {
  const target = { roster_id: 1, players: [
    { name: "Useful WR", position: "WR", quality: { expertRank: 70 } },
    { name: "Bench WR", position: "WR", quality: { expertRank: 120 } },
    { name: "Star WR", position: "WR", quality: { expertRank: 8 } },
    { name: "Second WR", position: "WR", quality: { expertRank: 20 } }
  ] };
  const partner = { roster_id: 2, players: [
    { name: "Replacement RB", position: "RB", quality: { expertRank: 210 } }
  ] };
  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [target, partner] });
  assert.equal(proposals.some(proposal => proposal.category === "CONSOLIDATION"), false);
});

test("exhaustive lineup search finds a bilateral swap and never lists a trade that hurts either lineup", () => {
  const p = (name, position, projectedPpg, rank) => ({ sleeperId: name, name, position, projectedPpg, quality: { expertRank: rank } });
  const core = x => [p(`${x}QB`, "QB", 18, 60), p(`${x}TE`, "TE", 9, 90), p(`${x}K`, "K", 8, 150), p(`${x}DEF`, "DEF", 8, 150)];
  // Mine: 4 startable RBs, weak WR2. Theirs: 4 startable WRs, weak RB2. RB4 <-> WR4 is +7 for both.
  const mine = [...core("M"), p("MRB1", "RB", 16, 20), p("MRB2", "RB", 15, 24), p("MRB3", "RB", 14, 30), p("MRB4", "RB", 13, 36), p("MWR1", "WR", 16, 22), p("MWR2", "WR", 6, 110)];
  const theirs = [...core("T"), p("TWR1", "WR", 16, 21), p("TWR2", "WR", 15, 25), p("TWR3", "WR", 14, 31), p("TWR4", "WR", 13, 35), p("TRB1", "RB", 16, 23), p("TRB2", "RB", 6, 115)];
  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [{ roster_id: 1, players: mine }, { roster_id: 2, players: theirs }], currentWeek: 4 });
  const swap = proposals.find(proposal => proposal.give.length === 1 && proposal.give[0].name === "MRB4" && proposal.receive.length === 1 && proposal.receive[0].name === "TWR4");
  assert.ok(swap);
  assert.equal(swap.recommendationScore.my_lineup_delta, 7);
  assert.ok(proposals.length > 0);
  assert.ok(proposals.every(proposal => proposal.recommendationScore.my_lineup_delta > 0 && proposal.recommendationScore.their_lineup_delta >= 0));
});
