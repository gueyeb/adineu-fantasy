import test from "node:test";
import assert from "node:assert/strict";
import { identifyFreeAgents, findWaiverOpportunities } from "../public/assets/waiver-opportunity.js";

test("identifyFreeAgents excludes any player rostered by any of the 12 teams", () => {
  const candidates = [
    { sleeperId: "1", name: "Rostered Guy", position: "WR" },
    { sleeperId: "2", name: "Free Agent Guy", position: "WR" }
  ];
  const rosters = [{ roster_id: 1, players: ["1"] }, { roster_id: 2, players: ["9"] }];
  const result = identifyFreeAgents(candidates, rosters);
  assert.deepEqual(result.map(p => p.sleeperId), ["2"]);
});

test("identifyFreeAgents drops candidates with no sleeperId (never a phantom free agent)", () => {
  const result = identifyFreeAgents([{ name: "No ID", position: "WR" }], []);
  assert.deepEqual(result, []);
});

// A full 9-slot lineup (QB, 2xRB, 2xWR, TE, FLEX, K, DEF), FLEX filled by a deliberately weak RB
// (5 pts) so an incoming free agent has an obvious slot to upgrade.
const myPlayers = [
  { sleeperId: "qb1", name: "QB1", position: "QB", projectedPpg: 20 },
  { sleeperId: "rb1", name: "RB1", position: "RB", projectedPpg: 15 },
  { sleeperId: "rb2", name: "RB2", position: "RB", projectedPpg: 10 },
  { sleeperId: "wr1", name: "WR1", position: "WR", projectedPpg: 14 },
  { sleeperId: "wr2", name: "WR2", position: "WR", projectedPpg: 9 },
  { sleeperId: "te1", name: "TE1", position: "TE", projectedPpg: 8 },
  { sleeperId: "flex1", name: "FLEX1", position: "RB", projectedPpg: 5 },
  { sleeperId: "k1", name: "K1", position: "K", projectedPpg: 7 },
  { sleeperId: "def1", name: "DEF1", position: "DEF", projectedPpg: 6 }
];

test("findWaiverOpportunities reports a positive, explicit lineup gain for a free agent who upgrades the lineup", () => {
  // buildProjectedLineup fills straight positions before FLEX, so a 12pt WR displaces WR2 (9pts)
  // into the WR2 slot directly; WR2's old occupant then cascades down and wins FLEX over FLEX1
  // (5pts). Net lineup gain is still exactly the free agent's edge over the weakest player they
  // displaced anywhere in the chain: 12 - 5 = 7.
  const freeAgents = [{ sleeperId: "fa1", name: "Streamer WR", position: "WR", projectedPpg: 12 }];
  const result = findWaiverOpportunities({ myPlayers, freeAgents });
  assert.equal(result.length, 1);
  assert.equal(result[0].player.sleeperId, "fa1");
  assert.equal(result[0].gain, 7);
  assert.equal(result[0].slot, "WR2");
});

test("findWaiverOpportunities excludes a free agent who would not crack the lineup at any slot", () => {
  const freeAgents = [{ sleeperId: "fa2", name: "Bench Fodder", position: "WR", projectedPpg: 2 }];
  const result = findWaiverOpportunities({ myPlayers, freeAgents });
  assert.deepEqual(result, []);
});

test("findWaiverOpportunities drops candidates with no projection rather than guessing", () => {
  const freeAgents = [{ sleeperId: "fa3", name: "No Projection", position: "WR" }];
  const result = findWaiverOpportunities({ myPlayers, freeAgents });
  assert.deepEqual(result, []);
});

test("findWaiverOpportunities respects positionsOfInterest even when an out-of-scope candidate would gain more", () => {
  const freeAgents = [
    { sleeperId: "fa4", name: "Great WR", position: "WR", projectedPpg: 30 },
    { sleeperId: "fa5", name: "Decent RB", position: "RB", projectedPpg: 12 }
  ];
  const result = findWaiverOpportunities({ myPlayers, freeAgents, positionsOfInterest: ["RB"] });
  assert.equal(result.length, 1);
  assert.equal(result[0].player.sleeperId, "fa5");
});

test("findWaiverOpportunities' cap limits how many candidates are ever evaluated", () => {
  const freeAgents = [
    { sleeperId: "fa-a", name: "A", position: "WR", projectedPpg: 20 },
    { sleeperId: "fa-b", name: "B", position: "WR", projectedPpg: 15 },
    { sleeperId: "fa-c", name: "C", position: "WR", projectedPpg: 10 }
  ];
  const uncapped = findWaiverOpportunities({ myPlayers, freeAgents });
  assert.equal(uncapped.length, 3);

  const capped = findWaiverOpportunities({ myPlayers, freeAgents, cap: 1 });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].player.sleeperId, "fa-a"); // only the top-projected candidate survives the cap
});
