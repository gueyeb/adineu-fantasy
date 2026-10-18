import test from "node:test";
import assert from "node:assert/strict";
import { buildPrelockCheck } from "../public/assets/prelock-check.js";
import { diagnoseLineup, compareWithOptimalLineup, formatReplacement } from "../scripts/lineup-advisor.js";
const advisor = { diagnoseLineup, compareWithOptimalLineup, formatReplacement };
const player = (sleeperId, nflTeam = "BUF") => ({ sleeperId, name: sleeperId, position: "QB", nflTeam });
const run = (overrides = {}) => buildPrelockCheck({ week: 6, now: "2026-10-18T15:45:00Z",
  myTeam: { starters: [{ slot: "QB", player: player("a") }], bench: [player("b", "KC")] },
  projections: { a: { pts_ppr: 10 }, b: { pts_ppr: 20 } },
  schedule: [{ week: 6, home_team: "BUF", away_team: "NYJ", kickoffAt: "2026-10-18T17:00:00Z" },
    { week: 6, home_team: "KC", away_team: "LV", kickoffAt: "2026-10-18T20:25:00Z" }], ...overrides }, advisor);
test("Out starter gets an unlocked bench replacement", () => {
  const report = run({ playerStatuses: new Map([["a", "Out"]]) });
  assert.equal(report.swaps[0].in.sleeperId, "b");
  assert.match(report.message, /Δ proj. Sleeper/);
});
test("locked starter is ignored and never moved by optimal", () => {
  const report = run({ now: "2026-10-18T18:00:00Z", playerStatuses: new Map([["a", "Out"]]) });
  assert.equal(report.locked.length, 1);
  assert.equal(report.alerts.length, 0);
  assert.doesNotMatch(report.message, /Points gagnés/);
});
test("Questionable gets conditional fallback, no swap", () => {
  const report = run({ playerStatuses: new Map([["a", "Questionable"]]) });
  assert.match(report.alerts[0].advice, /b en secours/);
  assert.equal(report.swaps.length, 0);
});
test("bye starter gets replacement", () => assert.match(run({ byeWeeks: { BUF: 6 } }).alerts[0].reason, /Bye/));
test("empty slot gets replacement", () => assert.equal(run({ myTeam: { starters: [{ slot: "QB", player: null }], bench: [player("b", "KC")] } }).swaps.length, 1));
test("healthy lineup has concise OK message and Paris kickoff", () => assert.match(run().message, /✅ Lineup OK[\s\S]*19:00.*Paris/));
test("locked bench cannot be proposed", () => {
  const report = run({ now: "2026-10-18T21:00:00Z", myTeam: { starters: [{ slot: "QB", player: null }], bench: [player("b", "KC")] } });
  assert.equal(report.alerts[0].replacement, null);
});
test("missing projections never publishes an Adineu fallback as Sleeper optimal gain", () => {
  assert.doesNotMatch(run({ projections: {} }).message, /Points gagnés/);
});
test("Doubtful, IR, Sus, PUP and NA are actionable", () => {
  for (const status of ["Doubtful", "IR", "Sus", "PUP", "NA"]) assert.equal(run({ playerStatuses: new Map([["a", status]]) }).swaps.length, 1);
});
test("bench bye is excluded and a replacement is never reused", () => {
  const report = run({ byeWeeks: { KC: 6 }, playerStatuses: new Map([["a", "Out"]]) });
  assert.equal(report.alerts[0].replacement, null);
  const empty = run({ myTeam: { starters: [{ slot: "QB", player: null }, { slot: "QB", player: null }], bench: [player("b", "KC")] } });
  assert.equal(empty.swaps.length, 1);
});
test("replacement uses highest weekly projection, not long-term trade value", () => {
  const report = run({ playerStatuses: new Map([["a", "Out"]]),
    myTeam: { starters: [{ slot: "QB", player: player("a") }], bench: [player("b", "KC"), { ...player("c", "KC"), quality: { expertRank: 1 } }] },
    projections: { a: { pts_ppr: 0 }, b: { pts_ppr: 25 }, c: { pts_ppr: 5 } } });
  assert.equal(report.swaps[0].in.sleeperId, "b");
});
