import test from "node:test";
import assert from "node:assert/strict";
import {
  COHERENCE_CATEGORIES, COHERENCE_MAX_LISTED_IDS, CUT_CONCENTRATION_MIN_ROWS, CUT_CONCENTRATION_SHARE,
  buildCoherenceWarnings, formatCoherenceWarnings, countEmptyStarterSlots } from "../public/assets/decision-coherence.js";

// Fictitious players only. A healthy board row: WATCH, ranked cut, covered gain, guard not applicable.
const cut = (sleeperId, name = `Cut ${sleeperId}`) => ({ sleeperId, name });
const row = (sleeperId, { action = "WATCH", fit = {}, ...extra } = {}) => ({
  sleeperId, name: `Joueur ${sleeperId}`, position: "WR",
  waiver: {
    decision: { recommendedAction: action },
    fit: fit === null ? undefined : { cutSelection: "RANKED_BY_NET_GAIN", dropCandidate: null, grossGainTotal: 1, netGainTotal: 1, selectionScore: 1, progressionGuard: "NOT_APPLICABLE", progressionSacrificeTotal: null, ...fit }
  },
  ...extra
});
const run = input => buildCoherenceWarnings(input);
const find = (result, code, category) => result.warnings.find(item => item.code === code && (!category || item.category === category));
const codes = result => result.warnings.map(item => item.code);

test("empty, missing and malformed input stay null-safe and publishable", () => {
  const empty = { warnings: [], publishable: true, counts: { CALCULATION_INCONSISTENCY: 0, COVERAGE_GAP: 0, CONSTRAINT: 0, JUSTIFIED_WATCH: 0 }, playerNames: {}, decisionStatus: { status: "EXECUTABLE", reasons: [] } };
  assert.deepEqual(buildCoherenceWarnings(), empty);
  assert.deepEqual(run({}), empty);
  assert.deepEqual(run({ boardRows: null, marketRows: undefined, myPlayers: "x" }), empty);
  const sparse = run({ boardRows: [{}, null, { sleeperId: "p1" }, { sleeperId: "p2", waiver: {} }, { waiver: { fit: null, decision: null } }, { sleeperId: "p3", ripple: [null], poolEntry: {}, events: {}, roleProfile: null }], marketRows: [{}, null], myPlayers: [{}, null] });
  assert.deepEqual(sparse, empty);
  assert.deepEqual(Object.keys(empty.counts), COHERENCE_CATEGORIES);
});

test("a healthy board raises nothing", () => {
  const boardRows = [row("p1", { action: "ADD_NOW", fit: { dropCandidate: cut("c1") } }), row("p2"), row("p3", { action: "IGNORE", fit: { grossGainTotal: 0, selectionScore: -1 } })];
  assert.deepEqual(run({ boardRows, marketRows: boardRows, myPlayers: [{ sleeperId: "c1", usageSignal: null }] }).warnings, []);
});

test("CUT_CONCENTRATION: ranked concentration is a coverage gap to review, not a calculation error", () => {
  const boardRows = [1, 2, 3].map(n => row(`p${n}`, { fit: { dropCandidate: cut("c1", "Coupe Alpha") } }))
    .concat([row("p4", { fit: { dropCandidate: cut("c2") } }), row("p5", { fit: { dropCandidate: cut("c3") } }), row("p6")]);
  const result = run({ boardRows });
  const found = find(result, "CUT_CONCENTRATION");
  assert.equal(found.category, "COVERAGE_GAP");
  assert.equal(found.severity, "REVIEW");
  assert.deepEqual(found.playerIds, ["p1", "p2", "p3"]);
  assert.deepEqual(found.details, { cutPlayerId: "c1", cutName: "Coupe Alpha", share: 0.6, rows: 3, rowsWithCut: 5, onlyEligible: false });
  assert.match(found.message, /Coupe Alpha/);
  assert.equal(result.publishable, true);
});

test("CUT_CONCENTRATION: a forced cut (only eligible) is a constraint", () => {
  const forced = { dropCandidate: cut("c1"), cutSelection: "ONLY_ELIGIBLE_CUT" };
  const boardRows = [1, 2, 3, 4, 5].map(n => row(`p${n}`, { fit: forced }));
  const found = find(run({ boardRows }), "CUT_CONCENTRATION");
  assert.equal(found.category, "CONSTRAINT");
  assert.equal(found.severity, "INFO");
  assert.equal(found.details.onlyEligible, true);
  assert.equal(found.details.share, 1);
  // One ranked row among them is enough to send it back to review.
  boardRows[4] = row("p5", { fit: { dropCandidate: cut("c1") } });
  assert.equal(find(run({ boardRows }), "CUT_CONCENTRATION").category, "COVERAGE_GAP");
});

test("CUT_CONCENTRATION: below the row or share thresholds nothing is raised", () => {
  assert.equal(CUT_CONCENTRATION_MIN_ROWS, 5);
  assert.equal(CUT_CONCENTRATION_SHARE, 0.6);
  const few = [1, 2, 3, 4].map(n => row(`p${n}`, { fit: { dropCandidate: cut("c1") } }));
  assert.equal(find(run({ boardRows: few }), "CUT_CONCENTRATION"), undefined);
  const spread = [1, 2].map(n => row(`p${n}`, { fit: { dropCandidate: cut("c1") } }))
    .concat([3, 4, 5].map(n => row(`p${n}`, { fit: { dropCandidate: cut(`c${n}`) } })));
  assert.equal(find(run({ boardRows: spread }), "CUT_CONCENTRATION"), undefined);
});

test("NO_CUT_COMPARISON_COVERED: only when every row with a fit is unranked", () => {
  const unranked = { cutSelection: "UNRANKED_INCOMPLETE_COVERAGE" };
  const boardRows = [row("p1", { fit: unranked }), row("p2", { fit: unranked }), row("p3", { fit: null })];
  const found = find(run({ boardRows }), "NO_CUT_COMPARISON_COVERED");
  assert.equal(found.category, "COVERAGE_GAP");
  assert.equal(found.severity, "REVIEW");
  assert.deepEqual(found.playerIds, ["p1", "p2"]);
  assert.deepEqual(found.details, { total: 2, rows: 2 });
  assert.equal(find(run({ boardRows: [...boardRows, row("p4")] }), "NO_CUT_COMPARISON_COVERED"), undefined);
  assert.equal(find(run({ boardRows: [row("p3", { fit: null })] }), "NO_CUT_COMPARISON_COVERED"), undefined);
});

test("NEWS_WITHOUT_EXPLAINED_EFFECT: sourced event with no flag and no role profile", () => {
  const boardRows = [
    row("p1", { ripple: [{ trigger: "SOURCED_EVENT", triggerPlayerId: "t1" }] }),
    row("p2", { poolEntry: { reasons: ["SOURCED_EVENT"] }, events: { flags: [] }, roleProfile: { profile: null } }),
    row("p3", { ripple: [{ trigger: "SOURCED_EVENT" }], events: { flags: ["PROMOTION"] } }),
    row("p4", { poolEntry: { reasons: ["SOURCED_EVENT"] }, roleProfile: { profile: "HANDCUFF" } }),
    row("p5", { ripple: [{ trigger: "SNAPSHOT_STATUS" }], poolEntry: { reasons: ["TRENDING"] } })
  ];
  const result = run({ boardRows });
  const found = find(result, "NEWS_WITHOUT_EXPLAINED_EFFECT");
  assert.equal(found.category, "COVERAGE_GAP");
  assert.equal(found.severity, "REVIEW");
  assert.deepEqual(found.playerIds, ["p1", "p2"]);
  assert.equal(found.details.total, 2);
  assert.equal(result.publishable, true);
  assert.equal(find(run({ boardRows: boardRows.slice(2) }), "NEWS_WITHOUT_EXPLAINED_EFFECT"), undefined);
});

test("PROGRESSION_IGNORED: actionable blocks, passive rows split by guard, one warning per category", () => {
  const guarded = (guard, id = "c1") => ({ dropCandidate: cut(id), progressionGuard: guard, progressionSacrificeTotal: guard === "NOT_JUSTIFIED" ? 2.5 : null });
  const boardRows = [
    row("p1", { action: "ADD_NOW", fit: guarded("NOT_JUSTIFIED") }),
    row("p2", { action: "CLAIM_IF_CHEAP", fit: guarded("UNPRICED", "c2") }),
    row("p3", { action: "WATCH", fit: guarded("NOT_JUSTIFIED", "c3") }),
    row("p4", { action: "IGNORE", fit: guarded("UNPRICED", "c4") }),
    row("p5", { action: "ADD_NOW", fit: guarded("JUSTIFIED", "c5") }),
    row("p6", { action: "ADD_NOW", fit: { progressionGuard: "NOT_JUSTIFIED" } })
  ];
  const result = run({ boardRows });
  const all = result.warnings.filter(item => item.code === "PROGRESSION_IGNORED");
  assert.deepEqual(all.map(item => [item.category, item.severity, item.playerIds]), [
    ["CALCULATION_INCONSISTENCY", "BLOCKING", ["p1", "p2"]],
    ["COVERAGE_GAP", "REVIEW", ["p4"]],
    ["JUSTIFIED_WATCH", "INFO", ["p3"]]
  ]);
  assert.deepEqual(all[0].details.rows, [
    { playerId: "p1", cutPlayerId: "c1", guard: "NOT_JUSTIFIED", progressionSacrificeTotal: 2.5 },
    { playerId: "p2", cutPlayerId: "c2", guard: "UNPRICED", progressionSacrificeTotal: null }
  ]);
  assert.equal(result.publishable, false);
  assert.equal(run({ boardRows: boardRows.slice(2) }).publishable, true);
  assert.equal(find(run({ boardRows: boardRows.slice(4) }), "PROGRESSION_IGNORED"), undefined);
});

test("RELEVANT / PINNED_CANDIDATE_ABSENT: absent news is a gap, absent pinned is a bug", () => {
  const boardRows = [row("p1"), row("p2", { poolEntry: { pinned: true } })];
  const marketRows = [
    ...boardRows,
    { sleeperId: "m1", events: { newsOverride: true } },
    { sleeperId: "m2", poolEntry: { pinned: true } },
    { sleeperId: "m3", poolEntry: { pinned: true }, events: { newsOverride: true } },
    { sleeperId: "m4", events: { newsOverride: false }, poolEntry: { pinned: false } },
    { sleeperId: "p1", events: { newsOverride: true } }
  ];
  const result = run({ boardRows, marketRows });
  const news = find(result, "RELEVANT_CANDIDATE_ABSENT");
  const pinned = find(result, "PINNED_CANDIDATE_ABSENT");
  assert.deepEqual([news.category, news.severity, news.playerIds, news.details.total], ["COVERAGE_GAP", "REVIEW", ["m1"], 1]);
  assert.deepEqual([pinned.category, pinned.severity, pinned.playerIds, pinned.details.total], ["CALCULATION_INCONSISTENCY", "BLOCKING", ["m2", "m3"], 2]);
  assert.equal(result.publishable, false);
  assert.deepEqual(codes(run({ boardRows, marketRows: marketRows.slice(0, 3) })), ["RELEVANT_CANDIDATE_ABSENT"]);
  assert.deepEqual(run({ boardRows, marketRows: boardRows }).warnings, []);
});

test("absent-candidate warnings cap listed ids and keep the real total", () => {
  const marketRows = Array.from({ length: 13 }, (_, index) => ({ sleeperId: `m${String(index).padStart(2, "0")}`, usageSignal: "BUY_LOW", events: { newsOverride: true } }));
  const result = run({ marketRows });
  for (const code of ["RELEVANT_CANDIDATE_ABSENT", "BUY_LOW_NOT_REPRESENTED"]) {
    const found = find(result, code);
    assert.equal(found.playerIds.length, COHERENCE_MAX_LISTED_IDS);
    assert.equal(found.details.total, 13);
    assert.equal(found.playerIds[0], "m00");
  }
  assert.match(formatCoherenceWarnings(result)[1], /m09… \+3\)$/);
});

test("BUY_LOW_NOT_REPRESENTED: only BUY_LOW free agents missing from the board", () => {
  const boardRows = [row("p1", { usageSignal: "BUY_LOW" })];
  const marketRows = [...boardRows, { sleeperId: "m1", usageSignal: "BUY_LOW" }, { sleeperId: "m2", usageSignal: "SELL_HIGH" }, { sleeperId: "m3", usageSignal: null }];
  const found = find(run({ boardRows, marketRows }), "BUY_LOW_NOT_REPRESENTED");
  assert.deepEqual([found.category, found.severity, found.playerIds, found.details.total], ["COVERAGE_GAP", "REVIEW", ["m1"], 1]);
  assert.equal(find(run({ boardRows, marketRows: [boardRows[0], marketRows[2]] }), "BUY_LOW_NOT_REPRESENTED"), undefined);
});

test("BUY_LOW_DESIGNATED_AS_CUT: blocks only when an actionable row cuts the BUY_LOW player", () => {
  const myPlayers = [
    { sleeperId: "c1", name: "Coupe Alpha", usageSignal: "BUY_LOW", emergingRole: { progression: "RISING" } },
    { sleeperId: "c2", name: "Coupe Beta", usageSignal: "SELL_HIGH" },
    { sleeperId: "c3", name: "Coupe Gamma", usageSignal: "BUY_LOW" }
  ];
  const boardRows = [
    row("p1", { action: "ADD_NOW", fit: { dropCandidate: cut("c1") } }),
    row("p2", { action: "WATCH", fit: { dropCandidate: cut("c1") } }),
    row("p3", { action: "CLAIM_IF_CHEAP", fit: { dropCandidate: cut("c2") } }),
    row("p4", { action: "WATCH", fit: { dropCandidate: cut("c3") } })
  ];
  const result = run({ boardRows, myPlayers });
  const found = find(result, "BUY_LOW_DESIGNATED_AS_CUT");
  assert.deepEqual([found.category, found.severity, found.playerIds], ["CALCULATION_INCONSISTENCY", "BLOCKING", ["c1"]]);
  assert.deepEqual(found.details.cuts, [{ cutPlayerId: "c1", cutName: "Coupe Alpha", addPlayerIds: ["p1"] }]);
  assert.equal(result.publishable, false);
  const passive = run({ boardRows: boardRows.slice(1), myPlayers });
  assert.equal(find(passive, "BUY_LOW_DESIGNATED_AS_CUT"), undefined);
  assert.equal(passive.publishable, true);
});

test("WATCH_JUSTIFIED_BY_CUT_COST: positive gross gain cancelled by the cut", () => {
  const boardRows = [
    row("p1", { action: "WATCH", fit: { dropCandidate: cut("cut-p1"), grossGainTotal: 3, selectionScore: -1 } }),
    row("p2", { action: "IGNORE", fit: { dropCandidate: cut("cut-p2"), grossGainTotal: 0.5, selectionScore: 0 } }),
    row("p3", { action: "WATCH", fit: { dropCandidate: cut("cut-p3"), grossGainTotal: 3, selectionScore: 0.1 } }),
    row("p4", { action: "WATCH", fit: { dropCandidate: cut("cut-p4"), grossGainTotal: 0, selectionScore: -1 } }),
    row("p5", { action: "WATCH", fit: { dropCandidate: cut("cut-p5"), grossGainTotal: null, selectionScore: -1 } }),
    row("p6", { action: "WATCH", fit: { dropCandidate: cut("cut-p6"), grossGainTotal: 3, selectionScore: null } }),
    row("p7", { action: "ADD_NOW", fit: { dropCandidate: cut("cut-p7"), grossGainTotal: 3, selectionScore: -1 } })
  ];
  const result = run({ boardRows });
  const found = find(result, "WATCH_JUSTIFIED_BY_CUT_COST");
  assert.deepEqual([found.category, found.severity, found.playerIds, found.details.total], ["JUSTIFIED_WATCH", "INFO", ["p1", "p2"], 2]);
  assert.equal(result.publishable, true);
  assert.equal(find(run({ boardRows: boardRows.slice(2) }), "WATCH_JUSTIFIED_BY_CUT_COST"), undefined);
  const many = Array.from({ length: 12 }, (_, index) => row(`w${String(index).padStart(2, "0")}`, { fit: { dropCandidate: cut(`cut-${index}`), grossGainTotal: 2, selectionScore: -2 } }));
  const capped = find(run({ boardRows: many }), "WATCH_JUSTIFIED_BY_CUT_COST");
  assert.equal(capped.playerIds.length, 10);
  assert.equal(capped.details.total, 12);
});

test("ACTIONABLE_WITHOUT_COVERED_GAIN: missing net gain or uncovered valuation blocks", () => {
  const boardRows = [
    row("p1", { action: "ADD_NOW", fit: { netGainTotal: null } }),
    row("p2", { action: "CLAIM_IF_CHEAP", poolEntry: { valuationCovered: false } }),
    row("p3", { action: "ADD_NOW", fit: null }),
    row("p4", { action: "ADD_NOW", poolEntry: { valuationCovered: true } }),
    row("p5", { action: "ADD_NOW", fit: { netGainTotal: 0 } }),
    row("p6", { action: "WATCH", fit: { netGainTotal: null }, poolEntry: { valuationCovered: false } })
  ];
  const result = run({ boardRows });
  const found = find(result, "ACTIONABLE_WITHOUT_COVERED_GAIN");
  assert.deepEqual([found.category, found.severity, found.playerIds], ["CALCULATION_INCONSISTENCY", "BLOCKING", ["p1", "p2", "p3"]]);
  assert.deepEqual(found.details.rows[1], { playerId: "p2", action: "CLAIM_IF_CHEAP", netGainMissing: false, valuationUncovered: true });
  assert.equal(result.publishable, false);
  assert.deepEqual(run({ boardRows: boardRows.slice(3) }).warnings, []);
});

test("ordering is deterministic: category order, then code, then first player id; counts and severities follow", () => {
  const boardRows = [
    row("p9", { action: "WATCH", fit: { dropCandidate: cut("cut-p9"), grossGainTotal: 2, selectionScore: -1 } }),
    row("p1", { action: "ADD_NOW", fit: { netGainTotal: null, dropCandidate: cut("c1"), progressionGuard: "UNPRICED" } }),
    row("p2", { ripple: [{ trigger: "SOURCED_EVENT" }] })
  ];
  const marketRows = [...boardRows, { sleeperId: "m2", usageSignal: "BUY_LOW" }, { sleeperId: "m1", poolEntry: { pinned: true } }];
  const myPlayers = [{ sleeperId: "c1", usageSignal: "BUY_LOW" }];
  const result = run({ boardRows, marketRows, myPlayers });
  assert.deepEqual(result.warnings.map(item => `${item.category}:${item.code}`), [
    "CALCULATION_INCONSISTENCY:ACTIONABLE_WITHOUT_COVERED_GAIN",
    "CALCULATION_INCONSISTENCY:BUY_LOW_DESIGNATED_AS_CUT",
    "CALCULATION_INCONSISTENCY:PINNED_CANDIDATE_ABSENT",
    "CALCULATION_INCONSISTENCY:PROGRESSION_IGNORED",
    "COVERAGE_GAP:BUY_LOW_NOT_REPRESENTED",
    "COVERAGE_GAP:NEWS_WITHOUT_EXPLAINED_EFFECT",
    "JUSTIFIED_WATCH:WATCH_JUSTIFIED_BY_CUT_COST"
  ]);
  assert.deepEqual(result.counts, { CALCULATION_INCONSISTENCY: 4, COVERAGE_GAP: 2, CONSTRAINT: 0, JUSTIFIED_WATCH: 1 });
  assert.equal(result.publishable, false);
  assert.deepEqual(run({ boardRows, marketRows, myPlayers }), result);
  for (const item of result.warnings) {
    assert.equal(item.severity, { CALCULATION_INCONSISTENCY: "BLOCKING", COVERAGE_GAP: "REVIEW", CONSTRAINT: "INFO", JUSTIFIED_WATCH: "INFO" }[item.category]);
    assert.equal(typeof item.message, "string");
    assert.ok(item.message.length > 0 && Array.isArray(item.playerIds) && item.details);
  }
  const input = JSON.stringify({ boardRows, marketRows, myPlayers });
  run({ boardRows, marketRows, myPlayers });
  assert.equal(JSON.stringify({ boardRows, marketRows, myPlayers }), input);
});

test("formatCoherenceWarnings: verdict line, one line per warning, safe on empty input", () => {
  for (const empty of [undefined, null, {}, { warnings: [] }, run({})]) {
    assert.deepEqual(formatCoherenceWarnings(empty), ["Cohérence : aucun avertissement."]);
  }
  const review = run({ boardRows: [row("p1", { action: "WATCH", fit: { dropCandidate: cut("cut-p1"), grossGainTotal: 2, selectionScore: -1 } })] });
  const reviewLines = formatCoherenceWarnings(review);
  assert.equal(reviewLines[0], "Cohérence : publiable");
  assert.equal(reviewLines.length, 2);
  assert.ok(reviewLines[1].startsWith("[JUSTIFIED_WATCH/INFO] WATCH_JUSTIFIED_BY_CUT_COST — "));
  assert.ok(reviewLines[1].endsWith("(Joueur p1)"));
  const blocked = run({
    boardRows: [row("p1", { action: "ADD_NOW", fit: { netGainTotal: null } })],
    marketRows: [{ sleeperId: "m1", poolEntry: { pinned: true } }]
  });
  const lines = formatCoherenceWarnings(blocked);
  assert.equal(lines[0], "Cohérence : NON publiable (2 incohérence(s) de calcul)");
  assert.ok(lines[1].startsWith("[CALCULATION_INCONSISTENCY/BLOCKING] ACTIONABLE_WITHOUT_COVERED_GAIN — "));
  assert.ok(lines[2].startsWith("[CALCULATION_INCONSISTENCY/BLOCKING] PINNED_CANDIDATE_ABSENT — "));
});

test("decision status: unverified availability and an unresolved empty starter slot degrade the decision without blocking publication", () => {
  const unknown = id => ({ ...row(id), availability: { availability: "UNKNOWN" } });
  const degraded = buildCoherenceWarnings({ boardRows: [unknown("p1"), unknown("p2")], rosterState: { emptyStarterSlotCount: 1, planStepCount: 0 } });
  assert.deepEqual(degraded.warnings.map(item => [item.code, item.category]), [["AVAILABILITY_UNVERIFIED", "COVERAGE_GAP"], ["EMPTY_STARTER_SLOT_UNRESOLVED", "COVERAGE_GAP"]]);
  assert.equal(degraded.publishable, true);
  assert.deepEqual(degraded.decisionStatus, { status: "DEGRADED", reasons: ["AVAILABILITY_UNVERIFIED", "EMPTY_STARTER_SLOT_UNRESOLVED"] });
  assert.match(formatCoherenceWarnings(degraded)[0], /DÉCISION DÉGRADÉE \(AVAILABILITY_UNVERIFIED, EMPTY_STARTER_SLOT_UNRESOLVED\)/);
  // Un candidat vérifié suffit à lever le doute global ; un plan qui comble le slot aussi.
  const verified = buildCoherenceWarnings({ boardRows: [unknown("p1"), { ...row("p2"), availability: { availability: "FREE_AGENT" } }], rosterState: { emptyStarterSlotCount: 1, planStepCount: 1 } });
  assert.deepEqual(verified.decisionStatus, { status: "EXECUTABLE", reasons: [] });
  assert.equal(buildCoherenceWarnings({ modelDegraded: true }).decisionStatus.status, "DEGRADED");
  assert.equal(countEmptyStarterSlots({ starterIds: new Set(["a", "b", "0"]) }, 9), 7);
  assert.equal(countEmptyStarterSlots(null, 9), 0);
});
