import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseRoster, findTradeProposals } from "../public/assets/trade-recommender.js";

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
