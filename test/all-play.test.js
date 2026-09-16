import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAllPlayRecords } from "../public/assets/all-play.js";

const managers = ["Alice", "Bob", "Cara"];

// Week 1: Alice 120 > Bob 100 > Cara 90 -> Alice 2-0, Bob 1-1, Cara 0-2
// Week 2: Cara 130 > Alice 110 > Bob 105 -> Cara 2-0, Alice 1-1, Bob 0-2
const rows = [
  { week: 1, manager: "Alice", points: 120, opponentPoints: 100, isPlayoff: false },
  { week: 1, manager: "Bob", points: 100, opponentPoints: 120, isPlayoff: false },
  { week: 1, manager: "Cara", points: 90, opponentPoints: 80, isPlayoff: false },
  { week: 2, manager: "Alice", points: 110, opponentPoints: 105, isPlayoff: false },
  { week: 2, manager: "Bob", points: 105, opponentPoints: 110, isPlayoff: false },
  { week: 2, manager: "Cara", points: 130, opponentPoints: 60, isPlayoff: false }
];

test("locked before the same 2-completed-week gate as Power Rankings", () => {
  const result = calculateAllPlayRecords(rows.filter(r => r.week === 1), { currentWeek: null, expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "insufficient_weeks");
  assert.deepEqual(result.records, []);
});

test("locked when one team is missing a completed week (incomplete coverage)", () => {
  const partial = rows.filter(row => !(row.manager === "Cara" && row.week === 2));
  const result = calculateAllPlayRecords(partial, { currentWeek: null, expectedManagers: managers });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "incomplete_coverage");
});

test("computes correct all-play wins/losses across completed weeks once ready", () => {
  const result = calculateAllPlayRecords(rows, { currentWeek: null, expectedManagers: managers });
  assert.equal(result.ready, true);

  const alice = result.records.find(r => r.manager === "Alice");
  const bob = result.records.find(r => r.manager === "Bob");
  const cara = result.records.find(r => r.manager === "Cara");

  assert.deepEqual([alice.wins, alice.losses, alice.ties], [3, 1, 0]); // W1: beat Bob+Cara; W2: beat Bob, lost to Cara
  assert.deepEqual([bob.wins, bob.losses, bob.ties], [1, 3, 0]); // W1: beat Cara, lost to Alice; W2: lost to both
  assert.deepEqual([cara.wins, cara.losses, cara.ties], [2, 2, 0]); // W1: lost to both; W2: beat both
  assert.equal(alice.winPct, 0.75);
});

test("excludes playoff rows and the live (current) week from the all-play tally", () => {
  const withNoise = [
    ...rows,
    { week: 2, manager: "Alice", points: 999, opponentPoints: 1, isPlayoff: true }, // playoff noise, same week
    { week: 3, manager: "Alice", points: 200, opponentPoints: 1, isPlayoff: false }, // live week if currentWeek=3
    { week: 3, manager: "Bob", points: 1, opponentPoints: 200, isPlayoff: false },
    { week: 3, manager: "Cara", points: 5, opponentPoints: 1, isPlayoff: false }
  ];
  const result = calculateAllPlayRecords(withNoise, { currentWeek: 3, expectedManagers: managers });
  const alice = result.records.find(r => r.manager === "Alice");
  assert.equal(alice.games, 2, "only the 2 completed weeks count, not the live week 3 or the playoff row");
});

test("ties are split evenly (each team gets a tie, not a phantom win)", () => {
  const tiedWeek = [
    { week: 1, manager: "Alice", points: 100, isPlayoff: false },
    { week: 1, manager: "Bob", points: 100, isPlayoff: false },
    { week: 2, manager: "Alice", points: 110, isPlayoff: false },
    { week: 2, manager: "Bob", points: 90, isPlayoff: false }
  ];
  const result = calculateAllPlayRecords(tiedWeek, { currentWeek: null, expectedManagers: ["Alice", "Bob"] });
  const alice = result.records.find(r => r.manager === "Alice");
  assert.deepEqual([alice.wins, alice.losses, alice.ties], [1, 0, 1]);
});
