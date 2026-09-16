import { test } from "node:test";
import assert from "node:assert/strict";
import { sumTradeValueByPosition, calculateLeagueRosterStrength } from "../public/assets/roster-strength.js";

test("sumTradeValueByPosition buckets by position and skips unknown/placeholder positions", () => {
  const players = [
    { position: "RB", quality: { expertRank: 5 } },
    { position: "rb", quality: { expertRank: 40 } }, // lowercase must still bucket into RB
    { position: "WR", quality: { expertRank: 3 } },
    { position: "FLEX" } // placeholder for a roster player missing from the catalog — must not crash or bucket anywhere
  ];
  const totals = sumTradeValueByPosition(players);
  assert.ok(totals.RB > 0);
  assert.ok(totals.WR > 0);
  assert.equal(totals.QB, 0);
  assert.equal(Object.keys(totals).includes("FLEX"), false);
});

test("sumTradeValueByPosition returns all-zero totals for an empty or missing roster", () => {
  assert.deepEqual(sumTradeValueByPosition([]), { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });
  assert.deepEqual(sumTradeValueByPosition(undefined), { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });
});

test("calculateLeagueRosterStrength ranks the deeper RB roster higher at RB, and flags it as surplus", () => {
  const strongRb = { rosterId: 1, players: [
    { position: "RB", quality: { expertRank: 2 } },
    { position: "RB", quality: { expertRank: 8 } },
    { position: "WR", quality: { expertRank: 90 } }
  ] };
  const weakRb = { rosterId: 2, players: [
    { position: "RB", quality: { expertRank: 180 } },
    { position: "WR", quality: { expertRank: 5 } },
    { position: "WR", quality: { expertRank: 10 } }
  ] };

  const [strong, weak] = calculateLeagueRosterStrength([strongRb, weakRb]);
  assert.ok(strong.strength.RB > weak.strength.RB);
  assert.equal(strong.surplus, "RB");
  assert.equal(weak.need, "RB");
});

test("calculateLeagueRosterStrength handles a single-roster league without dividing by zero", () => {
  const [only] = calculateLeagueRosterStrength([{ rosterId: 1, players: [{ position: "QB", quality: { expertRank: 1 } }] }]);
  assert.equal(only.strength.QB, 50);
  assert.equal(only.strength.RB, 50);
});

test("calculateLeagueRosterStrength keeps tied positions at the same percentile", () => {
  const identicalRoster = { players: [{ position: "TE", quality: { expertRank: 50 } }] };
  const results = calculateLeagueRosterStrength([
    { rosterId: "a", ...identicalRoster },
    { rosterId: "b", ...identicalRoster },
    { rosterId: "c", players: [{ position: "TE", quality: { expertRank: 1 } }] }
  ]);
  const [a, b] = results;
  assert.equal(a.strength.TE, b.strength.TE);
});
