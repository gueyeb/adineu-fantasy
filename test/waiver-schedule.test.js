import test from "node:test";
import assert from "node:assert/strict";
import { deriveWaiverRules } from "../public/assets/acquisition-availability.js";
import { buildWaiverSchedule, formatWaiverSchedule } from "../public/assets/waiver-schedule.js";
import { formatWaiverReport } from "../scripts/league-context.js";
import { buildCoachPlan, formatCoachPlan } from "../scripts/coach-assistant.js";
import { buildDecisionContext, formatDecisionContext } from "../scripts/ai-context.js";
const settings = { waiver_type: 2, daily_waivers: 0, waiver_day_of_week: 2, daily_waivers_hour: 0, waiver_clear_days: 1 };
const history = ["2026-10-14T07:09:00Z", "2026-10-21T07:09:00Z"].flatMap(at => Array.from({ length: 4 }, (_, i) => ({ type: "waiver", status: "complete", status_updated: Date.parse(at) + i * 1000 })));
const rules = deriveWaiverRules({ leagueSettings: settings, transactions: history });

test("Paris waiver label follows the actual instant across the Europe/US clock-change gap", () => {
  const before = buildWaiverSchedule({ waiverRules: rules, asOf: "2026-10-20T12:00:00Z" });
  const gap = buildWaiverSchedule({ waiverRules: rules, asOf: "2026-10-26T12:00:00Z" });
  const after = buildWaiverSchedule({ waiverRules: rules, asOf: "2026-11-02T12:00:00Z" });
  assert.equal(before.nextRunAt, "2026-10-21T07:00:00.000Z");
  assert.equal(gap.nextRunAt, "2026-10-28T07:00:00.000Z");
  assert.equal(after.nextRunAt, "2026-11-04T08:00:00.000Z");
  assert.match(formatWaiverSchedule(before), /09:00/);
  assert.match(formatWaiverSchedule(gap), /28 octobre 2026 à 08:00/);
  assert.match(formatWaiverSchedule(after), /09:00/);
  assert.match(formatWaiverSchedule(gap), /estimé.*Europe\/Paris.*Confirmer/);
});

test("missing history cannot publish a habitual fixed time; processing stays conditional", () => {
  assert.match(formatWaiverSchedule(buildWaiverSchedule({ asOf: "2026-10-26T12:00:00Z" })), /non vérifié/);
  assert.equal(buildWaiverSchedule({ waiverRules: { ...rules, validation: null }, asOf: "2026-10-26T12:00:00Z" }).status, "UNAVAILABLE");
  const running = buildWaiverSchedule({ waiverRules: rules, asOf: "2026-10-28T07:05:00Z" });
  assert.equal(running.status, "PROCESSING_INFERRED");
  assert.match(formatWaiverSchedule(running), /Traitement estimé.*08:00.*fin estimée/);
});

test("decision context uses the waiver report schedule instead of a stale static 09:00 label", () => {
  const waiverSchedule = buildWaiverSchedule({ waiverRules: rules, asOf: "2026-10-26T12:00:00Z" });
  const context = { week: 7, league: { name: "Test", teams: 12, waiverClear: "Wednesday 09:00 Europe/Paris", rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
    myTeam: { teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 2, losses: 4 } } };
  const decision = buildDecisionContext({ context, waivers: { byPosition: {}, waiverSchedule } });
  assert.deepEqual(decision.league.waiverSchedule, waiverSchedule);
  assert.match(decision.league.waiverClear, /08:00/);
  const text = formatDecisionContext(decision);
  assert.match(text, /28 octobre 2026 à 08:00/);
  assert.ok(!text.includes("Wednesday 09:00"));
  assert.match(buildDecisionContext({ context }).league.waiverClear, /non vérifié/);
  const waiverText = formatWaiverReport({ byPosition: {}, waiverSchedule });
  assert.match(waiverText, /28 octobre 2026 à 08:00/);
  const plan = buildCoachPlan({ decisionContext: decision, trades: { results: [] } });
  assert.deepEqual(plan.waiverSchedule, waiverSchedule);
  assert.match(formatCoachPlan(plan), /28 octobre 2026 à 08:00/);
});
