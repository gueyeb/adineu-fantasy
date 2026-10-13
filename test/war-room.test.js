import test from "node:test";
import assert from "node:assert/strict";
import { addToWatchlist, buildWarRoom, formatClaimOrder, normalizeWatchlist, parseWatchIds, recordBids, removeFromWatchlist, watchIdsHeader, WATCHLIST_LIMIT } from "../public/assets/war-room.js";

const cut = { sleeperId: "bench1", name: "Banc Un" };
const step = (playerId, name, bid, extra = {}) => ({ playerId, name, position: "WR", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: bid, personalMaxBid: bid + 10,
  dropCandidate: cut, weeklyLineupDeltas: [{ week: 7, delta: 2.5 }, { week: 8, delta: 1 }], netGainTotal: 12, horizonWeeks: 2, ...extra });
const plan = {
  steps: [step("def", "Défense", 0, { position: "DEF", recommendedAction: "ADD_NOW", dropCandidate: null }), step("coleman", "Coleman", 47)],
  alternativeClaimGroups: [{ primaryPlayerId: "coleman", dropCandidate: cut, claims: [
    { playerId: "coleman", name: "Coleman", position: "WR", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 47, personalMaxBid: 57, dropCandidate: cut, netGainTotal: 12, horizonWeeks: 2 },
    { playerId: "harris", name: "Harris", position: "WR", recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 23, personalMaxBid: 30, dropCandidate: cut, netGainTotal: 8, horizonWeeks: 2 }] }],
  budgetKnown: true, initialFaab: 200, reservedFaab: 47, remainingFaab: 153, claimPortfolio: { maximumReviewedFaabExposure: 47 }
};
const row = (sleeperId, name, extra = {}) => ({ sleeperId, name, position: "RB", nflTeam: "KC", recommendedAction: "WATCH", suggestedBid: null, maxForTeam: 6,
  dropCandidate: cut, weeklyLineupDeltas: [{ week: 7, delta: 0.4 }], netGainTotal: 1, horizonWeeks: 3, ...extra });

test("watchlist entries need a reason and a date, keep their first date and stay bounded", () => {
  assert.deepEqual(normalizeWatchlist([{ playerId: "a", addedAt: "2026-10-11T18:00:00Z", reason: "  " }, { playerId: "b", reason: "x" }, null, "junk"]), []);
  let list = addToWatchlist([], { sleeperId: "a", name: "Alpha", position: "RB" }, { reason: " 9 cibles ", now: "2026-10-11T18:00:00Z", week: 6 });
  assert.deepEqual(list, [{ playerId: "a", name: "Alpha", position: "RB", addedAt: "2026-10-11T18:00:00.000Z", week: 6, reason: "9 cibles" }]);
  list = addToWatchlist(list, { playerId: "a", name: "Alpha", position: "RB" }, { reason: "titulaire blessé", now: "2026-10-13T09:00:00Z", week: 7 });
  assert.equal(list.length, 1);
  assert.equal(list[0].addedAt, "2026-10-11T18:00:00.000Z");
  assert.equal(list[0].week, 6);
  assert.equal(list[0].reason, "titulaire blessé");
  list = addToWatchlist(list, { playerId: "b", name: "Beta", position: "WR" }, { reason: "snaps", now: "2026-10-12T09:00:00Z" });
  assert.deepEqual(list.map(entry => entry.playerId), ["b", "a"]);
  assert.deepEqual(removeFromWatchlist(list, "b").map(entry => entry.playerId), ["a"]);
  const many = Array.from({ length: 60 }, (_, i) => ({ playerId: `p${i}`, addedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), reason: "r".repeat(500) }));
  const bounded = normalizeWatchlist(many);
  assert.equal(bounded.length, WATCHLIST_LIMIT);
  assert.equal(bounded[0].playerId, "p59");
  assert.equal(bounded[0].reason.length, 200);
});

test("only validated ids travel in the header", () => {
  assert.equal(watchIdsHeader([{ playerId: "12", addedAt: "2026-10-11T18:00:00Z", reason: "x" }, { playerId: "KC", addedAt: "2026-10-12T18:00:00Z", reason: "y" }]), "KC,12");
  assert.deepEqual(parseWatchIds("12, KC,12,<script>,,a b"), ["12", "KC"]);
  assert.deepEqual(parseWatchIds(undefined), []);
  assert.equal(parseWatchIds(Array.from({ length: 90 }, (_, i) => i).join(",")).length, WATCHLIST_LIMIT);
});

test("claims sharing one cut are grouped and the entry order lists fallbacks after their primary", () => {
  const warRoom = buildWarRoom({ acquisitionPlan: plan, week: 7, dataThroughWeek: 6,
    rows: [row("coleman", "Coleman"), row("watched", "Suivi"), row("extra", "Hors plan", { recommendedAction: "CLAIM_IF_CHEAP", suggestedBid: 5 })] });
  assert.equal(warRoom.cutGroups.length, 1);
  const [group] = warRoom.cutGroups;
  assert.equal(group.dropName, "Banc Un");
  assert.equal(group.competing, true);
  assert.equal(group.maximumBid, 47);
  // A followed player the engine only watches is not a claim.
  assert.deepEqual(group.lines.map(line => [line.playerId, line.role]), [["coleman", "PLAN"], ["harris", "FALLBACK"], ["extra", "OUT_OF_PLAN"]]);
  // The plan's recalculated numbers win over the standalone row.
  assert.equal(warRoom.lines.find(line => line.playerId === "coleman").bid, 47);
  assert.deepEqual(warRoom.claimOrder.claims.map(claim => [claim.rank, claim.playerId, claim.kind, claim.bid]), [[1, "coleman", "PRIMARY", 47], [2, "harris", "FALLBACK", 23]]);
  assert.deepEqual(warRoom.claimOrder.freeAdds.map(add => add.playerId), ["def"]);
  assert.equal(warRoom.claimOrder.enteredBidTotal, 70);
  assert.equal(warRoom.claimOrder.submitsAutomatically, false);
  const text = formatClaimOrder(warRoom);
  assert.match(text, /SEMAINE 7/);
  assert.match(text, /• Défense \(DEF\) — couper personne \(place libre\)/);
  assert.match(text, /1\. Coleman \(WR\) — enchère 47 \$ — couper Banc Un\n2\. Harris \(WR\) — enchère 23 \$ — couper Banc Un — repli de Coleman/);
  assert.match(text, /FAAB réservé par le plan : 47 \$ · restant après : 153 \$/);
  assert.match(text, /Somme des enchères saisies : 70 \$ · maximum si un seul claim par coupe aboutit : 47 \$/);
  assert.match(text, /rien n’est soumis automatiquement/);
});

test("a followed player shows its state: in the plan, evaluated, already rostered or not evaluated", () => {
  const added = "2026-10-11T18:00:00Z";
  const watchlist = ["coleman", "harris", "watched", "taken", "ghost"].map((playerId, i) => ({ playerId, name: playerId, addedAt: new Date(Date.parse(added) + i).toISOString(), reason: "motif" }));
  const warRoom = buildWarRoom({ watchlist, acquisitionPlan: plan, rows: [row("watched", "Suivi")],
    missing: [{ playerId: "taken", status: "ROSTERED", teamName: "Kuro" }] });
  const states = Object.fromEntries(warRoom.watch.map(entry => [entry.playerId, entry.state]));
  assert.deepEqual(states, { coleman: "IN_PLAN", harris: "FALLBACK", watched: "EVALUATED", taken: "ROSTERED", ghost: "NOT_EVALUATED" });
  assert.equal(warRoom.watch.find(entry => entry.playerId === "taken").rosteredBy, "Kuro");
  const watched = warRoom.watch.find(entry => entry.playerId === "watched").line;
  assert.equal(watched.bid, null);
  assert.equal(watched.maxBid, 6);
  assert.deepEqual(watched.weeklyDeltas, [{ week: 7, delta: 0.4 }]);
  const undetermined = buildWarRoom({ rows: [row("x", "X", { maxForTeam: 0, maxBidStatus: "NOT_DETERMINED_INCOMPLETE_COVERAGE" }), row("y", "Y", { maxForTeam: 0, maxBidStatus: "DETERMINED" })] }).lines;
  assert.deepEqual(undetermined.map(line => line.maxBid), [null, 0], "an undetermined ceiling is not a founded 0 $");
});

test("a bid is revised against the last reading taken before the latest games", () => {
  const before = buildWarRoom({ acquisitionPlan: { ...plan, steps: [step("coleman", "Coleman", 30)], alternativeClaimGroups: [] } }).lines;
  let history = recordBids({}, before, { now: "2026-10-11T20:00:00Z", dataThroughWeek: 5 });
  history = recordBids(history, before, { now: "2026-10-12T08:00:00Z", dataThroughWeek: 5 });
  assert.equal(history.coleman.length, 1, "an unchanged reading is not duplicated");
  const now = buildWarRoom({ acquisitionPlan: plan, rows: [row("fresh", "Nouveau")], history, dataThroughWeek: 6 });
  history = recordBids(history, now.lines, { now: "2026-10-13T09:00:00Z", dataThroughWeek: 6 });
  assert.equal(history.coleman.length, 2);
  const revised = buildWarRoom({ acquisitionPlan: plan, rows: [row("fresh", "Nouveau")], history, dataThroughWeek: 6 });
  assert.deepEqual(revised.revisions.map(line => line.playerId), ["coleman"]);
  const { revision } = revised.revisions[0];
  assert.equal(revision.basis, "BEFORE_LAST_GAMES");
  assert.equal(revision.at, "2026-10-11T20:00:00.000Z");
  assert.equal(revision.bidBefore, 30);
  assert.equal(revision.bidDelta, 17);
  assert.equal(revision.maxDelta, 17);
  // First reading only: a reference exists but nothing changed; an undetermined bid stays null, never 0.
  const fresh = revised.lines.find(line => line.playerId === "fresh");
  assert.equal(fresh.revision.basis, "SAME_DATA");
  assert.equal(fresh.revision.changed, false);
  assert.equal(fresh.revision.bidDelta, null);
  assert.equal(buildWarRoom({ acquisitionPlan: plan }).lines[0].revision, null);
});

test("old readings expire and the history stays bounded", () => {
  const lines = bid => [{ playerId: "a", bid, maxBid: bid }];
  let history = recordBids({ gone: [{ at: "2026-09-01T00:00:00Z", bid: 1, max: 1 }], "bad id": [{ at: "2026-10-12T00:00:00Z" }] }, lines(1), { now: "2026-10-12T00:00:00Z", dataThroughWeek: 5 });
  assert.deepEqual(Object.keys(history), ["a"]);
  for (let bid = 2; bid < 12; bid++) history = recordBids(history, lines(bid), { now: `2026-10-12T00:${String(bid).padStart(2, "0")}:00Z`, dataThroughWeek: 5 });
  assert.equal(history.a.length, 6);
  assert.equal(history.a.at(-1).bid, 11);
});

test("no executable acquisition means nothing to enter", () => {
  assert.match(formatClaimOrder(buildWarRoom({ acquisitionPlan: null, rows: [row("watched", "Suivi")] })), /Aucun claim à saisir/);
  const unknown = buildWarRoom({ acquisitionPlan: { ...plan, budgetKnown: false, alternativeClaimGroups: [] } });
  assert.equal(unknown.claimOrder.reservedFaab, null);
  assert.match(formatClaimOrder(unknown), /Budget FAAB inconnu/);
});
