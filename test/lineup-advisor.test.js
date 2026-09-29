import test from "node:test";
import assert from "node:assert/strict";
import { compareWithOptimalLineup, diagnoseLineup, formatLineupAdvisory } from "../scripts/lineup-advisor.js";

const bench = [
  { sleeperId: "bench-rb", name: "Backup Runner", position: "RB", nflTeam: "KC", quality: { expertRank: 60 } },
  { sleeperId: "bench-wr", name: "Deep Threat", position: "WR", nflTeam: "MIA", quality: { expertRank: 80 } }
];

test("diagnoseLineup ignores healthy starters with no bye", () => {
  const myTeam = {
    starters: [{ slot: "QB", player: { sleeperId: "qb1", name: "Healthy QB", position: "QB", nflTeam: "SF" } }],
    bench: [],
    ir: []
  };
  const { alerts } = diagnoseLineup({ myTeam, playerStatuses: new Map() });
  assert.deepEqual(alerts, []);
});

test("diagnoseLineup flags an empty slot as ALERT and suggests the best bench replacement", () => {
  const myTeam = {
    starters: [{ slot: "RB", player: null }],
    bench,
    ir: []
  };
  const { alerts } = diagnoseLineup({ myTeam, playerStatuses: new Map() });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "ALERT");
  assert.equal(alerts[0].reason, "Slot vide");
  assert.equal(alerts[0].replacement.source, "bench");
  assert.equal(alerts[0].replacement.player.sleeperId, "bench-rb");
});

test("diagnoseLineup marks Out as ALERT and Questionable as WATCH", () => {
  const myTeam = {
    starters: [
      { slot: "RB", player: { sleeperId: "rb-out", name: "Hurt Runner", position: "RB", nflTeam: "DAL" } },
      { slot: "WR", player: { sleeperId: "wr-q", name: "Iffy Receiver", position: "WR", nflTeam: "NYJ" } }
    ],
    bench,
    ir: []
  };
  const playerStatuses = new Map([["rb-out", "Out"], ["wr-q", "Questionable"]]);
  const { alerts } = diagnoseLineup({ myTeam, playerStatuses });

  assert.equal(alerts.find(a => a.slot === "RB").severity, "ALERT");
  assert.equal(alerts.find(a => a.slot === "WR").severity, "WATCH");
});

test("diagnoseLineup never suggests a bench replacement that is itself flagged", () => {
  const myTeam = {
    starters: [{ slot: "RB", player: { sleeperId: "rb-out", name: "Hurt Runner", position: "RB", nflTeam: "DAL" } }],
    bench,
    ir: []
  };
  const playerStatuses = new Map([["rb-out", "Out"], ["bench-rb", "Doubtful"]]);
  const { alerts } = diagnoseLineup({ myTeam, playerStatuses, freeAgentsByPosition: {
    RB: [{ sleeperId: "fa-rb", name: "Waiver Back", position: "RB", nflTeam: "CHI", quality: { expertRank: 150 } }]
  } });

  assert.equal(alerts[0].replacement.source, "free_agent");
  assert.equal(alerts[0].replacement.player.sleeperId, "fa-rb");
});

test("diagnoseLineup flags a bye week using the provided schedule and nothing when the table is empty", () => {
  const myTeam = {
    starters: [{ slot: "TE", player: { sleeperId: "te1", name: "Bye Tight End", position: "TE", nflTeam: "GB" } }],
    bench: [],
    ir: []
  };
  const flagged = diagnoseLineup({ myTeam, byeWeeks: { GB: 5 }, currentWeek: 5 });
  assert.equal(flagged.alerts[0].reason, "Bye Week (semaine 5)");

  const notFlagged = diagnoseLineup({ myTeam, byeWeeks: {}, currentWeek: 5 });
  assert.deepEqual(notFlagged.alerts, []);
});

test("formatLineupAdvisory reports a clean bill of health and a real bulletin", () => {
  assert.match(formatLineupAdvisory({ alerts: [] }), /Aucune alerte/);

  const text = formatLineupAdvisory({
    alerts: [{
      slot: "K",
      player: null,
      severity: "ALERT",
      reason: "Slot vide",
      replacement: { source: "free_agent", player: { name: "Streaming Kicker", position: "K", nflTeam: "LAC" } }
    }]
  });
  assert.match(text, /START\/SIT ADVISOR/);
  assert.match(text, /K — Slot vide/);
  assert.match(text, /Remplaçant conseillé \(free agent\) : Streaming Kicker \(K LAC\)/);
});

test("compareWithOptimalLineup: a projected bench player replaces an Out starter and reports the gain", () => {
  const player = (sleeperId, position) => ({ sleeperId, name: sleeperId, position });
  const myTeam = {
    starters: [
      { slot: "QB", player: player("qb", "QB") }, { slot: "RB", player: player("rb1", "RB") }, { slot: "RB", player: player("rbOut", "RB") },
      { slot: "WR", player: player("wr1", "WR") }, { slot: "WR", player: player("wr2", "WR") }, { slot: "TE", player: player("te", "TE") },
      { slot: "FLEX", player: player("wr3", "WR") }, { slot: "K", player: player("k", "K") }, { slot: "DEF", player: player("def", "DEF") }
    ],
    bench: [player("rbBench", "RB")]
  };
  const projections = Object.fromEntries([["qb", 20], ["rb1", 15], ["wr1", 14], ["wr2", 12], ["te", 9], ["wr3", 10], ["k", 8], ["def", 7], ["rbBench", 11]].map(([id, pts]) => [id, { pts_ppr: pts }]));
  const result = compareWithOptimalLineup({ myTeam, projections, playerStatuses: new Map([["rbOut", "Out"]]) });
  assert.equal(result.gain, 11);
  assert.deepEqual(result.promote.map(p => p.sleeperId), ["rbBench"]);
  assert.deepEqual(result.bench.map(p => p.sleeperId), ["rbOut"]);
});

test("compareWithOptimalLineup never promotes an Out player even if Sleeper still projects him (Puka case)", () => {
  const player = (sleeperId, position) => ({ sleeperId, name: sleeperId, position });
  const myTeam = {
    starters: [{ slot: "WR", player: player("wr1", "WR") }, { slot: "WR", player: player("wr2", "WR") }],
    bench: [player("puka", "WR")]
  };
  const projections = { wr1: { pts_ppr: 12 }, wr2: { pts_ppr: 10 }, puka: { pts_ppr: 19 } };
  const result = compareWithOptimalLineup({ myTeam, projections, playerStatuses: new Map([["puka", "Out"]]) });
  assert.equal(result.gain, 0);
  assert.equal(result.promote.length, 0);
});
