import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSleeperTrades, buildTradeRanking, buildTradeRecords, evaluateSeasonTrades, replacementLevel, tradeStartWeek } from "../public/assets/trade-ledger.js";

const trade = (...managers) => ({ sides: managers.map(manager => ({ manager })) });

test("buildTradeRanking counts a trade once per manager, ranks ties together and finds partners", () => {
  const ranking = buildTradeRanking([
    { year: 2024, trades: [trade("A", "B"), trade("A", "C")] },
    { year: 2025, trades: [trade("A", "B"), trade("C", "D")] }
  ], { seasonsPlayed: new Map([["A", 2], ["B", 2]]) });
  assert.equal(ranking.totalTrades, 4);
  assert.deepEqual(ranking.managers.map(row => [row.rank, row.manager, row.trades]), [[1, "A", 3], [2, "B", 2], [2, "C", 2], [4, "D", 1]]);
  assert.deepEqual(ranking.managers[0].bySeason, { 2024: 2, 2025: 1 });
  assert.deepEqual(ranking.managers[0].topPartner, { manager: "B", trades: 2 });
  assert.deepEqual([ranking.managers[0].perSeason, ranking.managers[2].perSeason], [1.5, null]);
  assert.deepEqual(ranking.pairs[0], { managers: ["A", "B"], trades: 2 });
  assert.deepEqual(ranking.busiestSeason, { year: 2024, trades: 2 });
  assert.deepEqual(ranking.years, [2024, 2025]);
});

test("buildSleeperTrades keeps completed trades only and never guesses an unmapped roster", () => {
  const managers = new Map([[1, "A"], [2, "B"]]);
  const rows = [
    { transaction_id: "1", type: "trade", status: "complete", roster_ids: [1, 2], created: Date.UTC(2026, 8, 12) },
    { transaction_id: "1", type: "trade", status: "complete", roster_ids: [1, 2], created: Date.UTC(2026, 8, 12) },
    { transaction_id: "2", type: "trade", status: "failed", roster_ids: [1, 2], created: 1 },
    { transaction_id: "3", type: "waiver", status: "complete", roster_ids: [1], created: 1 },
    { transaction_id: "4", type: "trade", status: "complete", roster_ids: [1, 9], created: 1 }
  ];
  const { trades, unmapped } = buildSleeperTrades(rows, managers);
  assert.deepEqual(trades, [{ date: "2026-09-12", sides: [{ manager: "A" }, { manager: "B" }] }]);
  assert.equal(unmapped, 1);
});

test("the Yahoo trade archive is internally consistent with the manager history", async () => {
  const archive = JSON.parse(await readFile(new URL("../public/data/yahoo-trades.json", import.meta.url), "utf8"));
  const history = JSON.parse(await readFile(new URL("../public/data/yahoo-history.json", import.meta.url), "utf8"));
  assert.deepEqual(archive.seasons.map(season => [season.year, season.tradeCount]), [[2019, 20], [2020, 16], [2021, 6], [2022, 21], [2023, 14], [2024, 7], [2025, 11]]);
  assert.equal(archive.totalTrades, 95);
  for (const season of archive.seasons) {
    assert.equal(season.trades.length, season.tradeCount);
    assert.equal(season.leagueId, history.seasons.find(entry => entry.year === season.year).leagueId);
    for (const item of season.trades) {
      assert.equal(item.sides.length, 2);
      assert.notEqual(item.sides[0].manager, item.sides[1].manager);
      assert.match(item.date, new RegExp(`^${season.year}-\\d{2}-\\d{2}$`));
      for (const side of item.sides) {
        const manager = history.managerHistory.find(entry => entry.manager === side.manager);
        assert.equal(manager?.seasons[season.year], side.team, `${season.year} ${side.team}`);
        assert.ok(side.received.length > 0);
      }
    }
  }
  const ranking = buildTradeRanking(archive.seasons);
  assert.deepEqual(ranking.managers.slice(0, 3).map(row => [row.manager, row.trades]), [["Birama", 38], ["Babacar", 36], ["Louis François", 22]]);
  assert.equal(ranking.managers.reduce((sum, row) => sum + row.trades, 0), 190);
});

test("tradeStartWeek is the first week kicking off on or after the trade date", () => {
  assert.equal(tradeStartWeek("2025-08-20", 2025), 1);
  assert.equal(tradeStartWeek("2025-09-04", 2025), 1);
  assert.equal(tradeStartWeek("2025-09-05", 2025), 2);
  assert.equal(tradeStartWeek("2025-09-11", 2025), 2);
  assert.equal(tradeStartWeek("2025-11-18", 2025), 12);
  assert.equal(tradeStartWeek("2030-01-01", 2030), null);
});

test("replacementLevel is the last startable score of the week", () => {
  assert.equal(replacementLevel([30, 20, 10, 5], "QB", 2), 20);
  assert.equal(replacementLevel([30, 20, 10, 5, 4, 1], "RB", 2), 4);
  assert.equal(replacementLevel([30], "QB", 12), 0);
});

test("evaluateSeasonTrades values each haul above replacement and only calls a clear winner", () => {
  const player = (name, sleeperId, position = "RB") => ({ name, yahooId: sleeperId, sleeperId, position });
  const season = { year: 2025, trades: [
    { date: "2025-11-25", sides: [{ manager: "A", received: [player("Star", "s")] }, { manager: "B", received: [player("Passer", "q", "QB")] }] },
    { date: "2025-11-25", sides: [{ manager: "A", received: [player("Even1", "e1")] }, { manager: "B", received: [player("Even2", "e2")] }] },
    { date: "2025-11-25", sides: [{ manager: "A", received: [{ name: "Ghost", yahooId: "g", position: "RB" }] }, { manager: "B", received: [player("Star", "s")] }] },
    { date: "2025-12-30", sides: [{ manager: "A", received: [player("Star", "s")] }, { manager: "B", received: [player("Even1", "e1")] }] }
  ] };
  // Weeks 13..17 count; the passer out-scores the runner in raw points but not above replacement.
  const scores = { s: 20, q: 24, e1: 12, e2: 13 };
  const pointsOf = (id, week) => (id === "s" && week === 14 ? null : scores[id]);
  const [won, even, incomplete, late] = evaluateSeasonTrades(season, pointsOf, position => (position === "QB" ? 18 : 8));
  assert.deepEqual([won.sides[0].points, won.sides[0].value, won.sides[0].received[0].games], [80, 48, 4]);
  assert.deepEqual([won.sides[1].points, won.sides[1].value], [120, 30]);
  assert.deepEqual(won.outcome, { fromWeek: 13, throughWeek: 17, winner: "A", margin: 18, verdict: "WON" });
  assert.deepEqual([even.outcome.verdict, even.outcome.winner, even.outcome.margin], ["EVEN", null, 5]);
  assert.deepEqual([incomplete.outcome.verdict, incomplete.sides[0].value], ["INCOMPLETE", null]);
  assert.equal(late.outcome.verdict, "NO_GAMES");
  const records = buildTradeRecords([{ trades: [won, even, incomplete, late] }]);
  assert.deepEqual(records, [{ manager: "A", won: 1, lost: 0, even: 1, net: 13 }, { manager: "B", won: 0, lost: 1, even: 1, net: -13 }]);
});

test("every archived trade carries an outcome built from id-resolved players", async () => {
  const archive = JSON.parse(await readFile(new URL("../public/data/yahoo-trades.json", import.meta.url), "utf8"));
  const trades = archive.seasons.flatMap(season => season.trades);
  for (const item of trades) {
    assert.ok(["WON", "EVEN"].includes(item.outcome.verdict));
    for (const side of item.sides) for (const player of side.received) {
      assert.match(player.yahooId, /^\d+$/);
      assert.match(player.sleeperId, /^\d+$/);
      assert.ok(["yahoo_id", "name+position"].includes(player.matchedBy));
    }
  }
  const records = buildTradeRecords(archive.seasons);
  assert.equal(records.reduce((sum, row) => sum + row.won, 0), records.reduce((sum, row) => sum + row.lost, 0));
  assert.ok(Math.abs(records.reduce((sum, row) => sum + row.net, 0)) < 0.5);
});
