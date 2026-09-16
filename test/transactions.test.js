import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTeamTransactions, describeTransaction } from "../public/assets/transactions.js";

const rows = [
  { transaction_id: "1", type: "waiver", status: "complete", roster_ids: [3], adds: { "100": 3 }, drops: null, settings: { waiver_bid: 42 }, created: 3000 },
  { transaction_id: "2", type: "waiver", status: "failed", roster_ids: [3], adds: { "101": 3 }, drops: null, settings: { waiver_bid: 5 }, created: 2000 },
  { transaction_id: "3", type: "trade", status: "complete", roster_ids: [3, 12], adds: { "200": 3, "300": 12 }, drops: { "200": 12, "300": 3 }, settings: null, created: 1000 },
  { transaction_id: "4", type: "free_agent", status: "complete", roster_ids: [12], adds: null, drops: { "400": 12 }, settings: null, created: 4000 }
];

const playerMap = new Map([
  ["100", { name: "Player A" }],
  ["200", { name: "Player B" }],
  ["300", { name: "Player C" }]
]);

test("filterTeamTransactions keeps only completed transactions involving the roster, newest first", () => {
  const result = filterTeamTransactions(rows, 3);
  assert.deepEqual(result.map(row => row.transaction_id), ["1", "3"]); // #2 failed, #4 is a different roster
});

test("filterTeamTransactions returns an empty array for a roster with no activity", () => {
  assert.deepEqual(filterTeamTransactions(rows, 99), []);
});

test("describeTransaction on a waiver claim reports the add and the FAAB spent", () => {
  const described = describeTransaction(rows[0], { rosterId: 3, playerMap });
  assert.equal(described.added.length, 1);
  assert.equal(described.added[0].player.name, "Player A");
  assert.equal(described.dropped.length, 0);
  assert.equal(described.faabSpent, 42);
  assert.equal(described.otherRosterIds.length, 0);
});

test("describeTransaction on a trade isolates THIS roster's side (gained B, lost C), not the other side", () => {
  const described = describeTransaction(rows[2], { rosterId: 3, playerMap });
  assert.equal(described.added.length, 1);
  assert.equal(described.added[0].player.name, "Player B");
  assert.equal(described.dropped.length, 1);
  assert.equal(described.dropped[0].player.name, "Player C");
  assert.equal(described.faabSpent, null); // FAAB spend is only tracked for waiver claims
  assert.deepEqual(described.otherRosterIds, [12]);
});

test("describeTransaction on a free-agent drop reports the drop with no add and no FAAB", () => {
  const described = describeTransaction(rows[3], { rosterId: 12, playerMap });
  assert.equal(described.added.length, 0);
  assert.equal(described.dropped.length, 1);
  assert.equal(described.faabSpent, null);
});
