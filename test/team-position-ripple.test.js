import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamPositionRipple, RIPPLE_EVENT_TYPES } from "../public/assets/team-position-ripple.js";

// Fictitious teams, ids and names only: nothing here is a claim about a real NFL depth chart.
const context = { asOf: "2026-10-06T10:00:00Z", week: 5, season: "2026", leagueId: "league" };
const player = (id, position, nflTeam, extra = {}) => ({ id, name: `Name ${id}`, position, nflTeam, injuryStatus: null, active: true, ...extra });
const event = (extra = {}) => ({ type: "INJURY", nflTeam: "AAA", positions: ["WR"], source: "https://example.com/team-report",
  observedAt: "2026-10-06T08:00:00Z", expiresAt: "2026-10-08T08:00:00Z", leagueId: "league", season: "2026", targetWeek: 5, ...extra });
const base = () => [
  player("wr-a", "WR", "AAA"), player("wr-b", "WR", "AAA"), player("wr-c", "WR", "AAA"),
  player("te-a", "TE", "AAA"), player("rb-a", "RB", "AAA"), player("wr-z", "WR", "ZZZ")
];
const run = (players, eventsById = {}, extra = {}) => buildTeamPositionRipple({ players, eventsById, ...context, ...extra });
const withStatus = (players, id, injuryStatus) => players.map(p => (p.id === id ? { ...p, injuryStatus } : p));

test("a snapshot status ripples to the other players of the same team:position group only", () => {
  const result = run(withStatus(base(), "wr-a", "Out"));
  assert.deepEqual([...result.byPlayerId.keys()], ["wr-b", "wr-c"]);
  assert.deepEqual(result.byPlayerId.get("wr-b"), [{ trigger: "SNAPSHOT_STATUS", triggerName: "Name wr-a", triggerStatus: "Out", certainty: "REPORTED_ABSENCE",
    type: null, observedAt: null, source: "SLEEPER_PLAYERS_SNAPSHOT", triggerPlayerId: "wr-a", group: "AAA:WR",
    effect: "REEVALUATE", shareAttributed: null, successionInferred: false }]);
  assert.equal(result.sourcedEventPlayerIds.size, 0);
  assert.deepEqual(result.issues, []);
});

test("every blocking Sleeper status triggers; Questionable is only a possible absence; healthy players do not", () => {
  for (const status of ["Out", "Doubtful", "IR", "PUP", "Sus", "NA"]) {
    assert.deepEqual([...run(withStatus(base(), "wr-a", status)).byPlayerId.keys()], ["wr-b", "wr-c"], status);
  }
  const possible = run(withStatus(base(), "wr-a", "Questionable")).byPlayerId.get("wr-b");
  assert.deepEqual(possible.map(entry => [entry.triggerStatus, entry.certainty, entry.effect, entry.shareAttributed]), [["Questionable", "POSSIBLE_ABSENCE", "REEVALUATE", null]]);
  assert.equal(run(base()).byPlayerId.size, 0);
});

test("a status without team or fantasy position proves no group; numeric ids are normalized", () => {
  assert.equal(run([player("wr-a", "WR", null, { injuryStatus: "Out" }), player("wr-b", "WR", null)]).byPlayerId.size, 0);
  assert.equal(run([player("x-a", null, "AAA", { injuryStatus: "Out" }), player("x-b", null, "AAA")]).byPlayerId.size, 0);
  const result = run([player(101, "RB", "AAA", { injuryStatus: "IR" }), player(102, "RB", "AAA")]);
  assert.deepEqual([...result.byPlayerId.keys()], ["102"]);
  assert.equal(result.byPlayerId.get("102")[0].triggerPlayerId, "101");
});

test("inactive players receive no entry", () => {
  const players = withStatus(base(), "wr-a", "Out").map(p => (p.id === "wr-c" ? { ...p, active: false } : p));
  assert.deepEqual([...run(players).byPlayerId.keys()], ["wr-b"]);
  const sourced = run(base().map(p => (p.id === "wr-c" ? { ...p, active: false } : p)), { "wr-a": event() });
  assert.deepEqual([...sourced.byPlayerId.keys()], ["wr-b"]);
});

test("a sourced event ripples to every listed position of its team and flags only the trigger", () => {
  const result = run(base(), { "wr-a": event({ type: "RETURN", positions: ["WR", "TE"] }) });
  assert.deepEqual([...result.byPlayerId.keys()], ["te-a", "wr-b", "wr-c"]);
  assert.deepEqual(result.byPlayerId.get("te-a"), [{ trigger: "SOURCED_EVENT", triggerName: "Name wr-a", triggerStatus: null, certainty: "SOURCED_EVENT",
    type: "RETURN", observedAt: "2026-10-06T08:00:00Z", source: "https://example.com/team-report", triggerPlayerId: "wr-a",
    group: "AAA:TE", effect: "REEVALUATE", shareAttributed: null, successionInferred: false }]);
  assert.equal(result.byPlayerId.get("wr-b")[0].group, "AAA:WR");
  assert.deepEqual([...result.sourcedEventPlayerIds], ["wr-a"]);
  assert.deepEqual(result.issues, []);
  for (const type of RIPPLE_EVENT_TYPES) assert.equal(run(base(), { "wr-a": event({ type }) }).byPlayerId.get("wr-b")[0].type, type);
});

test("an event on another team than the snapshot is a mismatch, not a ripple", () => {
  const result = run(base(), { "wr-a": event({ nflTeam: "ZZZ" }) });
  assert.equal(result.byPlayerId.size, 0);
  assert.equal(result.sourcedEventPlayerIds.size, 0);
  assert.deepEqual(result.issues, [{ code: "EVENT_TEAM_MISMATCH", playerId: "wr-a" }]);
});

test("an event without a sourced team/position group never ripples: a name alone proves nothing", () => {
  for (const extra of [{ positions: [] }, { positions: undefined }, { positions: "WR" }, { positions: ["WR", "LB"] }, { nflTeam: undefined }, { nflTeam: "" }]) {
    const result = run(base(), { "wr-a": event(extra) });
    assert.equal(result.byPlayerId.size, 0);
    assert.equal(result.sourcedEventPlayerIds.size, 0);
    assert.deepEqual(result.issues, [{ code: "EVENT_GROUP_UNSOURCED", playerId: "wr-a" }]);
  }
  assert.deepEqual(run(base(), { "wr-a": event({ type: "FANTASY_ADD" }) }).issues, [{ code: "EVENT_TYPE_UNSUPPORTED", playerId: "wr-a" }]);
});

test("expired, future, unsourced or out-of-scope evidence is rejected", () => {
  const rejected = [{ expiresAt: "2026-10-06T09:00:00Z" }, { observedAt: "2026-10-06T11:00:00Z" }, { source: "" }, { targetWeek: 4 }, { leagueId: "other" }, { season: "2025" }];
  for (const extra of rejected) {
    const result = run(base(), { "wr-a": event(extra) });
    assert.equal(result.byPlayerId.size, 0);
    assert.equal(result.sourcedEventPlayerIds.size, 0);
    assert.deepEqual(result.issues, [{ code: "EVENT_EVIDENCE_NOT_CURRENT", playerId: "wr-a" }]);
  }
  assert.deepEqual(run(base(), { "wr-a": event() }, { asOf: undefined }).issues, [{ code: "EVENT_EVIDENCE_NOT_CURRENT", playerId: "wr-a" }]);
});

test("a trigger missing from the snapshot still ripples to its sourced group", () => {
  const result = run(base(), { "wr-new": event({ type: "NFL_TRANSACTION" }) });
  assert.deepEqual([...result.byPlayerId.keys()], ["wr-a", "wr-b", "wr-c"]);
  assert.equal(result.byPlayerId.get("wr-a")[0].triggerName, null);
  assert.deepEqual([...result.sourcedEventPlayerIds], ["wr-new"]);
  assert.deepEqual(result.issues, []);
});

test("no entry ever carries a share, a successor or a duration", () => {
  const players = withStatus(base(), "wr-a", "IR");
  const result = run(players, { "wr-a": event({ note: "fictitious note", targetShare: 0.3, successorId: "wr-b", weeksOut: 4 }), "te-a": event({ type: "ROLE_CHANGE", positions: ["TE", "WR"] }) });
  const allowed = ["certainty", "effect", "group", "observedAt", "shareAttributed", "source", "successionInferred", "trigger", "triggerName", "triggerPlayerId", "triggerStatus", "type"];
  const all = [...result.byPlayerId.values()].flat();
  assert.ok(all.length > 0);
  for (const entry of all) {
    assert.deepEqual(Object.keys(entry).sort(), allowed);
    assert.equal(entry.effect, "REEVALUATE");
    assert.equal(entry.shareAttributed, null);
    assert.equal(entry.successionInferred, false);
    assert.ok(Object.values(entry).every(value => typeof value !== "number"));
  }
});

test("output is deterministic whatever the input order", () => {
  const players = withStatus(withStatus(base(), "wr-c", "Out"), "wr-a", "Doubtful");
  const events = { "wr-c": event({ type: "ROLE_CHANGE" }), "wr-a": event(), "rb-a": event({ positions: [] }), "te-a": event({ nflTeam: "ZZZ" }) };
  const shape = result => ({ byPlayerId: [...result.byPlayerId], sourced: [...result.sourcedEventPlayerIds], issues: result.issues });
  const forward = shape(run(players, events));
  const reversed = shape(run([...players].reverse(), Object.fromEntries(Object.entries(events).reverse())));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.byPlayerId.map(([id]) => id), ["wr-a", "wr-b", "wr-c"]);
  assert.deepEqual(forward.byPlayerId.find(([id]) => id === "wr-b")[1].map(entry => [entry.trigger, entry.triggerPlayerId]),
    [["SNAPSHOT_STATUS", "wr-a"], ["SNAPSHOT_STATUS", "wr-c"], ["SOURCED_EVENT", "wr-a"], ["SOURCED_EVENT", "wr-c"]]);
  assert.deepEqual(forward.sourced, ["wr-a", "wr-c"]);
  assert.deepEqual(forward.issues, [{ code: "EVENT_GROUP_UNSOURCED", playerId: "rb-a" }, { code: "EVENT_TEAM_MISMATCH", playerId: "te-a" }]);
});
