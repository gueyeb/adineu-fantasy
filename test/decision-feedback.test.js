import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { applyPlanChoice, evaluateMove, normalizePlanChoice, planChoiceRows, reviewWindows } from "../public/assets/decision-log.js";
import { createDecisionLogStore } from "../scripts/decision-log.js";

const points = { a: { 5: 10, 6: 12, 7: 8, 8: 20 }, b: { 5: 4, 6: 4, 7: 4, 8: 4 } };
const pointsOf = (id, week) => points[id]?.[week] ?? null;
const move = { kind: "CLAIM_WON", week: 5, added: [{ id: "a" }], dropped: [{ id: "b" }], bid: 10 };

test("2- and 4-week reviews stay null until their window is completed", () => {
  assert.deepEqual(reviewWindows(move, { pointsOf, lastCompletedWeek: 5 }), { weeks2: null, weeks4: null });
  const mid = reviewWindows(move, { pointsOf, lastCompletedWeek: 7 });
  assert.deepEqual(mid.weeks2, { fromWeek: 5, throughWeek: 6, addedPoints: 22, droppedPoints: 8, net: 14 });
  assert.equal(mid.weeks4, null, "a partial 4-week window is not shown as the review");
  assert.equal(reviewWindows(move, { pointsOf, lastCompletedWeek: 8 }).weeks4.net, 34);
  assert.equal(reviewWindows({ ...move, kind: "CLAIM_LOST" }, { pointsOf, lastCompletedWeek: 8 }).weeks2.net, null, "a lost claim has no net");
  assert.deepEqual(reviewWindows({ ...move, week: null }, { pointsOf, lastCompletedWeek: 8 }), { weeks2: null, weeks4: null });
  assert.equal(evaluateMove(move, { pointsOf, lastCompletedWeek: 6 }).reviews.weeks2.net, 14);
});

test("a plan choice is validated, stored per recommended player and never a move", () => {
  assert.throws(() => normalizePlanChoice({ choice: "MAYBE" }), /Choix invalide/);
  assert.deepEqual(normalizePlanChoice({ choice: null, reason: "x" }), { choice: null, reason: null });
  assert.deepEqual(normalizePlanChoice({ choice: "REFUSED", reason: "  roster plein " }), { choice: "REFUSED", reason: "roster plein" });
  const details = { recommendations: [{ playerId: "10", name: "Hockenson", action: "CLAIM_IF_CHEAP", suggestedBid: 9 }, { playerId: "20", name: "CIN", action: "ADD_NOW" }, { playerId: "30", name: "Watch", action: "WATCH" }] };
  assert.throws(() => applyPlanChoice(details, "99", { choice: "ACCEPTED", reason: null }), /Recommandation inconnue/);
  const chosen = applyPlanChoice(applyPlanChoice(details, "10", { choice: "ACCEPTED", reason: null }, "T1"), "20", { choice: "REFUSED", reason: "bye" }, "T2");
  assert.deepEqual(chosen.recommendations, details.recommendations, "the plan itself is unchanged");
  assert.deepEqual(applyPlanChoice(chosen, "20", { choice: null, reason: null }).choices, { 10: { choice: "ACCEPTED", reason: null, at: "T1" } });

  const rows = planChoiceRows([{ id: "2026:1:plan:8", week: 8, ...chosen }], [
    { kind: "CLAIM_LOST", week: 8, added: [{ id: "10" }] }, { kind: "CLAIM_WON", week: 9, added: [{ id: "10" }] }
  ]);
  assert.deepEqual(rows.map(row => [row.playerId, row.choice, row.move, row.executed]), [["10", "ACCEPTED", "ATTEMPTED", false], ["20", "REFUSED", "NONE", false]],
    "WATCH is not a choice to make; an accepted claim that lost, or a move another week, is not executed");
  assert.equal(planChoiceRows([{ id: "p", week: 9, ...chosen }], [{ kind: "CLAIM_WON", week: 9, added: [{ id: "10" }] }])[0].executed, true);
});

test("the store writes a choice only into a MODEL_PLAN row of that roster", async () => {
  const updates = [];
  const row = { id: "2026:1:plan:8", details: { recommendations: [{ playerId: "10", action: "CLAIM_IF_CHEAP" }] } };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }),
    update: values => { updates.push(values); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } };
  const store = createDecisionLogStore({ getSupabase: async () => ({ from: () => query }), season: 2026 });
  await assert.rejects(store.setChoice(1, "2026:2:plan:8", "10", { choice: "ACCEPTED" }), /Plan inconnu/);
  await assert.rejects(store.setChoice(1, "2026:1:t1", "10", { choice: "ACCEPTED" }), /Plan inconnu/);
  const saved = await store.setChoice(1, "2026:1:plan:8", "10", { choice: "DEFERRED", reason: "attendre jeudi" });
  assert.deepEqual([saved.choice, saved.reason], ["DEFERRED", "attendre jeudi"]);
  assert.deepEqual(Object.keys(updates[0]).sort(), ["details", "updated_at"], "reason/outcome columns of the row are untouched");
});

test("PUT with a choice goes to setChoice; invalid ids and choices are 400", async t => {
  const calls = [];
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    decisionLogStore: {
      list: async () => ({ entries: [], plans: [], planChoices: [], summary: {} }),
      setReason: async () => { throw new Error("must not be reached"); },
      setChoice: async (rosterId, planId, playerId, input) => {
        const { choice, reason } = normalizePlanChoice(input);
        if (!planId.startsWith(`2026:${rosterId}:plan:`)) throw new Error("Plan inconnu");
        calls.push([rosterId, planId, playerId, choice, reason]);
        return { planId, playerId, choice, reason };
      }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const put = body => fetch(`http://127.0.0.1:${server.address().port}/api/coach/decisions`, { method: "PUT", headers: { authorization: "Bearer test-api", "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await put({ rosterId: 1, id: "2026:1:plan:8", playerId: "10", choice: "ACCEPTED", reason: "ok" })).status, 200);
  assert.equal((await put({ rosterId: 1, id: "2026:1:plan:8", playerId: "10", choice: "YES" })).status, 400);
  assert.equal((await put({ rosterId: 1, id: "2026:2:plan:8", playerId: "10", choice: "REFUSED" })).status, 400);
  assert.equal((await put({ rosterId: 1, id: "2026:1:plan:8", playerId: "<x>", choice: "REFUSED" })).status, 400);
  assert.deepEqual(calls, [[1, "2026:1:plan:8", "10", "ACCEPTED", "ok"]]);
});
