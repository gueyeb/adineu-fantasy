import test from "node:test";
import assert from "node:assert/strict";
import { buildFaabHistory, buildTrendingAdds, summarizeFaabByPosition } from "../public/assets/league-market.js";

const meta = { a: { name: "Alpha", position: "WR" }, b: { name: "Bravo", position: "RB" }, c: { name: "Charlie", position: "WR", injuryStatus: "IR" } };
const playerMeta = id => meta[id];

test("buildFaabHistory keeps only winning waiver claims, highest bid first", () => {
  const claims = buildFaabHistory([
    { week: 1, transactions: [
      { type: "waiver", status: "complete", adds: { a: 3 }, settings: { waiver_bid: 41 } },
      { type: "waiver", status: "failed", adds: { b: 5 }, settings: { waiver_bid: 99 } },
      { type: "free_agent", status: "complete", adds: { b: 5 }, settings: null }
    ] },
    { week: 2, transactions: [{ type: "waiver", status: "complete", adds: { b: 5 }, settings: { waiver_bid: 176 } }] }
  ], { playerMeta, rosterName: id => `Team ${id}` });
  assert.deepEqual(claims.map(claim => [claim.name, claim.bid, claim.team, claim.week]), [["Bravo", 176, "Team 5", 2], ["Alpha", 41, "Team 3", 1]]);
});

test("summarizeFaabByPosition gives count, median and max per position", () => {
  const summary = summarizeFaabByPosition([{ position: "WR", bid: 10 }, { position: "WR", bid: 30 }, { position: "WR", bid: 301 }, { position: "RB", bid: 0 }]);
  assert.deepEqual(summary.WR, { count: 3, median: 30, max: 301, total: 341 });
  assert.equal(summary.RB.median, 0);
});

test("buildTrendingAdds flags players rostered in Adineu and joins the model row for free agents", () => {
  const trending = buildTrendingAdds([{ player_id: "a", count: 900 }, { player_id: "b", count: 500 }, { player_id: "c", count: 100 }], {
    rosteredIds: new Set(["b"]),
    rosterOf: () => "Boukki",
    playerMeta,
    modelRowOf: id => id === "a" ? { waiver: { score: 80 } } : null
  });
  assert.deepEqual(trending.map(row => [row.name, row.rostered, row.rosteredBy, row.waiver?.score ?? null, row.injuryStatus]),
    [["Alpha", false, null, 80, null], ["Bravo", true, "Boukki", null, null], ["Charlie", false, null, null, "IR"]]);
});
