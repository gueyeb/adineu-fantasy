import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { attachModelView, buildMoveEntries, decisionWeekOf, evaluateMove, lastKickoffByWeek, normalizeReason, postWaiverReview, skippedRecommendations, summarizeDecisionLog } from "../public/assets/decision-log.js";
import { assembleDecisionLog, createDecisionLogStore, recommendationsFromReport } from "../scripts/decision-log.js";

const schedule = [
  { week: 1, kickoffAt: "2026-09-10T00:20:00Z" }, { week: 1, kickoffAt: "2026-09-15T00:15:00Z" },
  { week: 2, kickoffAt: "2026-09-17T00:15:00Z" }, { week: 2, kickoffAt: "2026-09-22T00:15:00Z" },
  { week: 3, kickoffAt: "2026-09-29T00:15:00Z" }
];
const players = { a: { name: "Alpha", position: "RB" }, b: { name: "Bravo", position: "RB" }, c: { name: "Charlie", position: "WR" } };
const at = iso => Date.parse(iso);

test("a move belongs to the first week whose last game has not kicked off", () => {
  const kickoffs = lastKickoffByWeek(schedule);
  assert.deepEqual(kickoffs, { 1: "2026-09-15T00:15:00Z", 2: "2026-09-22T00:15:00Z", 3: "2026-09-29T00:15:00Z" });
  assert.equal(decisionWeekOf(at("2026-09-16T10:00:00Z"), kickoffs), 2, "Wednesday waivers after week 1 are for week 2");
  assert.equal(decisionWeekOf(at("2026-09-14T17:00:00Z"), kickoffs), 1, "Sunday add before MNF still counts for week 1");
  assert.equal(decisionWeekOf(at("2026-10-30T00:00:00Z"), kickoffs), null);
});

const transactions = [
  { transaction_id: "t1", leg: 1, type: "waiver", status: "complete", status_updated: at("2026-09-16T10:00:00Z"), adds: { a: 1 }, drops: { b: 1 }, settings: { waiver_bid: 40 } },
  { transaction_id: "t2", leg: 1, type: "waiver", status: "failed", status_updated: at("2026-09-16T10:00:00Z"), adds: { c: 1 }, settings: { waiver_bid: 12 }, metadata: { notes: "This player was claimed by another owner." } },
  { transaction_id: "t3", leg: 1, type: "waiver", status: "complete", status_updated: at("2026-09-16T10:00:00Z"), adds: { c: 2 }, settings: { waiver_bid: 30 } },
  { transaction_id: "t4", leg: 2, type: "free_agent", status: "complete", status_updated: at("2026-09-20T10:00:00Z"), drops: { a: 1 } },
  { transaction_id: "t5", leg: 2, type: "free_agent", status: "complete", status_updated: at("2026-09-20T10:00:00Z"), adds: { b: 2 } }
];

test("moves of one roster: claims won and lost, cuts; other rosters' moves are ignored", () => {
  const entries = buildMoveEntries({ transactions, rosterId: 1, season: "2026", weekOf: ts => decisionWeekOf(ts, lastKickoffByWeek(schedule)), playerOf: id => players[id] });
  assert.deepEqual(entries.map(entry => [entry.kind, entry.week, entry.added.map(p => p.name).join(), entry.dropped.map(p => p.name).join(), entry.bid, entry.note]), [
    ["CLAIM_WON", 2, "Alpha", "Bravo", 40, null],
    ["CLAIM_LOST", 2, "Charlie", "", 12, "OUTBID"],
    ["DROP", 2, "", "Alpha", null, null]
  ]);
});

test("a move is evaluated over its window, added against dropped, started weeks apart; pending before its week", () => {
  const entry = { kind: "CLAIM_WON", week: 2, added: [{ id: "a" }], dropped: [{ id: "b" }], bid: 40 };
  const points = { "a|2": 10, "a|3": 20, "b|2": 4, "b|3": null };
  const outcome = evaluateMove(entry, { pointsOf: (id, week) => points[`${id}|${week}`] ?? null, startedOf: (id, week) => week === 3 ? 20 : 0, lastCompletedWeek: 3, window: 4 });
  assert.deepEqual(outcome, { status: "PARTIAL", fromWeek: 2, throughWeek: 3, weeks: 2, addedPoints: 30, droppedPoints: 4, net: 26, startedPoints: 20, pointsPerFaab: 0.75 });
  assert.equal(evaluateMove(entry, { pointsOf: () => 1, lastCompletedWeek: 3, window: 2 }).status, "COMPLETE");
  assert.deepEqual(evaluateMove(entry, { pointsOf: () => 1, lastCompletedWeek: 1 }), { status: "PENDING" });
  const lost = evaluateMove({ ...entry, kind: "CLAIM_LOST", dropped: [] }, { pointsOf: () => 5, lastCompletedWeek: 2 });
  assert.equal(lost.net, null);
  assert.equal(lost.addedPoints, 5);
});

test("model view is recorded, never guessed, and skipped recommendations are listed", () => {
  const recommendations = { 2: [{ playerId: "a", action: "CLAIM_IF_CHEAP", suggestedBid: 25, source: "WEEKLY_JOB" }, { playerId: "c", action: "WATCH", source: "WEEKLY_JOB" }, { playerId: "z", name: "Zulu", action: "ADD_NOW", source: "WEEKLY_JOB" }] };
  const base = { kind: "CLAIM_WON", week: 2, added: [{ id: "a" }], dropped: [] };
  assert.deepEqual(attachModelView(base, recommendations).model, { verdict: "RECOMMENDED", action: "CLAIM_IF_CHEAP", suggestedBid: 25, source: "WEEKLY_JOB" });
  assert.equal(attachModelView({ ...base, added: [{ id: "c" }] }, recommendations).model.verdict, "NOT_RECOMMENDED");
  assert.equal(attachModelView({ ...base, added: [{ id: "q" }] }, recommendations).model.verdict, "NOT_ON_BOARD");
  assert.equal(attachModelView({ ...base, week: 5 }, recommendations).model.verdict, "NO_MODEL_RECORD");
  assert.equal(attachModelView({ ...base, kind: "LINEUP" }, recommendations).model, null);
  assert.deepEqual(skippedRecommendations([base], recommendations).map(row => row.playerId), ["z"]);
});

test("assembleDecisionLog rebuilds moves and lineups with league points and summarizes them", () => {
  const result = assembleDecisionLog({ transactions, schedule, rosterId: 1, season: "2026", lastCompletedWeek: 2, playerOf: id => players[id],
    scoring: { rush_yd: 0.1 }, statsByWeek: { 2: { a: { rush_yd: 100 }, b: { rush_yd: 30 }, c: { rush_yd: 50 } } },
    matchupsByWeek: { 2: [{ roster_id: 1, points: 10, starters: ["a"], players: ["a", "c"], players_points: { a: 10, c: 14 } }] },
    recommendationsByWeek: { 2: recommendationsFromReport({ byPosition: { RB: [{ sleeperId: "a", name: "Alpha", waiver: { decision: { recommendedAction: "CLAIM_IF_CHEAP" }, suggestedBid: 22 } }] } }, "TEST") } });
  const won = result.entries.find(entry => entry.kind === "CLAIM_WON");
  assert.deepEqual([won.outcome.addedPoints, won.outcome.droppedPoints, won.outcome.net, won.outcome.startedPoints, won.model.verdict], [10, 3, 7, 10, "RECOMMENDED"]);
  assert.deepEqual(result.entries.find(entry => entry.kind === "CLAIM_LOST").lostTo, { rosterId: 2, bid: 30 });
  const lineup = result.entries.find(entry => entry.kind === "LINEUP");
  assert.equal(lineup.outcome.optimalPoints, 24, "Charlie (WR) on the bench would have started");
  assert.equal(lineup.outcome.pointsLeft, 14);
  assert.equal(result.summary.faabSpent, 40);
  assert.equal(result.summary.claimsLost, 1);
  assert.equal(result.summary.lineupPointsLeft, 14);
});

test("reasons are trimmed and bounded; the store refuses another roster's entry", async () => {
  assert.equal(normalizeReason("  bye week  "), "bye week");
  assert.equal(normalizeReason("   "), null);
  assert.equal(normalizeReason("x".repeat(900)).length, 500);
  assert.throws(() => normalizeReason(42));
  const store = createDecisionLogStore({ getSupabase: async () => { throw new Error("must not be reached"); }, season: 2026 });
  await assert.rejects(store.setReason(1, "2026:2:t1", "x"), /inconnue/);
  assert.equal(summarizeDecisionLog([]).moves, 0);
});

test("decision routes require the Coach access and only write a reason", async t => {
  const reasons = new Map();
  let failing = false;
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    decisionLogStore: {
      list: async rosterId => { if (failing) throw new Error("down"); return { entries: [{ id: `2026:${rosterId}:t1`, reason: reasons.get(`2026:${rosterId}:t1`) ?? null }], summary: {} }; },
      setReason: async (rosterId, id, reason) => { if (!id.startsWith(`2026:${rosterId}:`)) throw new Error("Entrée inconnue"); reasons.set(id, normalizeReason(reason)); return { id, reason: reasons.get(id) }; }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/coach/decisions`;
  const bearer = { authorization: "Bearer test-api", "content-type": "application/json" };
  const put = body => fetch(url, { method: "PUT", headers: bearer, body: JSON.stringify(body) });

  assert.equal((await fetch(`${url}?roster=1`)).status, 404);
  assert.equal((await fetch(`${url}?roster=99`, { headers: bearer })).status, 400);
  assert.equal((await put({ rosterId: 1, reason: "x" })).status, 400);
  assert.equal((await put({ rosterId: 1, id: "2026:2:t1", reason: "x" })).status, 400);
  assert.deepEqual(await (await put({ rosterId: 1, id: "2026:1:t1", reason: "  bye  " })).json(), { id: "2026:1:t1", reason: "bye" });
  assert.equal((await (await fetch(`${url}?roster=1`, { headers: bearer })).json()).entries[0].reason, "bye");
  failing = true;
  assert.equal((await fetch(`${url}?roster=1`, { headers: bearer })).status, 503);
});

test("post-waiver review lists the week's claims with who beat each bid, spend and skipped plan picks", () => {
  const entries = [
    { kind: "CLAIM_WON", week: 6, added: [{ name: "Xavier Worthy" }], dropped: [{ name: "Tre Harris" }], bid: 21 },
    { kind: "CLAIM_LOST", week: 6, added: [{ name: "Jordan Love" }], dropped: [], bid: 25, lostTo: { rosterId: 4, bid: 41 } },
    { kind: "FREE_ADD", week: 6, added: [{ name: "Colts" }], dropped: [{ name: "Browns" }], bid: null },
    { kind: "CLAIM_WON", week: 5, added: [{ name: "Old" }], dropped: [], bid: 99 }
  ];
  const review = postWaiverReview({ entries, skipped: [{ week: 6, playerId: "9", name: "Germie Bernard", action: "CLAIM_IF_CHEAP", suggestedBid: 12 }],
    week: 6, teamName: "Boukki", budgetLeft: 410, teamNameOf: id => ({ 4: "Saitaamaa" })[id] });
  assert.deepEqual([review.claimsWon, review.claimsLost, review.freeAdds, review.spent], [1, 1, 1, 21]);
  assert.equal(review.message, [
    "Waivers semaine 6 — Boukki",
    "✅ Xavier Worthy — 21 $ (coupe Tre Harris)",
    "❌ Jordan Love — ton offre 25 $, Saitaamaa à 41 $",
    "➕ Colts (agent libre), coupe Browns",
    "FAAB dépensé : 21 $ · reste 410 $",
    "Plan du modèle non placé : Germie Bernard (CLAIM_IF_CHEAP 12 $)"
  ].join("\n"));
  assert.match(postWaiverReview({ week: 7 }).message, /Aucun claim/);
});

test("journal refresh route needs the job token", async t => {
  let runs = 0;
  const server = createAppServer({ modelJobToken: "job-test", runJournalJob: async () => { runs++; return { message: "ok" }; } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/coach/decisions/sync`;
  assert.equal((await fetch(url, { method: "POST" })).status, 401);
  assert.deepEqual(await (await fetch(url, { method: "POST", headers: { authorization: "Bearer job-test" } })).json(), { message: "ok" });
  assert.equal(runs, 1);
});
