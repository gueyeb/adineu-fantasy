import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSleeperTrades, buildTradeRanking } from "../public/assets/trade-ledger.js";

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
  assert.deepEqual(ranking.managers.slice(0, 3).map(row => [row.manager, row.trades]), [["Birama", 38], ["babttz", 36], ["Louis François", 22]]);
  assert.equal(ranking.managers.reduce((sum, row) => sum + row.trades, 0), 190);
});
