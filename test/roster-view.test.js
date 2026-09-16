import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRosterIdentity,
  listRosterIdentities,
  findRosterByTeam,
  buildStarterSlotOrder,
  buildRosterSlots
} from "../public/assets/roster-view.js";
import { ROSTER_SETTINGS_2026 } from "../public/assets/league-settings.js";

const users = [
  { user_id: "u1", display_name: "t0z", metadata: { team_name: "Boukki Ball" } },
  { user_id: "u2", display_name: "Kuro" }
];

const rosters = [
  { roster_id: 1, owner_id: "u1", starters: ["100", "0", "101"], players: ["100", "101", "102"], reserve: ["103"] },
  { roster_id: 2, owner_id: "u2", starters: [], players: [], reserve: [] },
  { roster_id: 3, owner_id: "u9", starters: [], players: [], reserve: [] }
];

test("resolveRosterIdentity prefers the Sleeper team_name over display_name", () => {
  const userById = new Map(users.map(user => [user.user_id, user]));
  const identity = resolveRosterIdentity(rosters[0], userById);
  assert.equal(identity.ownerName, "t0z");
  assert.equal(identity.teamName, "Boukki Ball");
});

test("resolveRosterIdentity falls back to display_name, then to a generic label with no user", () => {
  const userById = new Map(users.map(user => [user.user_id, user]));
  assert.equal(resolveRosterIdentity(rosters[1], userById).teamName, "Kuro");
  assert.equal(resolveRosterIdentity(rosters[2], userById).ownerName, "Manager 3");
});

test("listRosterIdentities attaches identity to every roster in order", () => {
  const identities = listRosterIdentities(rosters, users);
  assert.equal(identities.length, 3);
  assert.deepEqual(identities.map(entry => entry.ownerName), ["t0z", "Kuro", "Manager 3"]);
});

test("findRosterByTeam matches by owner name, team name, or roster_id, case-insensitively", () => {
  assert.equal(findRosterByTeam(rosters, users, "T0Z").roster.roster_id, 1);
  assert.equal(findRosterByTeam(rosters, users, "boukki ball").roster.roster_id, 1);
  assert.equal(findRosterByTeam(rosters, users, "2").roster.roster_id, 2);
});

test("findRosterByTeam throws explicitly on an unknown team, never falling back to another roster", () => {
  assert.throws(() => findRosterByTeam(rosters, users, "nope"), /Équipe Sleeper inconnue/);
});

test("buildStarterSlotOrder follows the official 2026 roster settings (9 starters)", () => {
  const order = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
  assert.deepEqual(order, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]);
});

test("buildRosterSlots splits titulaires/banc/IR and labels an empty starter slot as null", () => {
  const playerMap = new Map([
    ["100", { sleeperId: "100", name: "QB One", position: "QB" }],
    ["101", { sleeperId: "101", name: "RB One", position: "RB" }]
    // 102 and 103 intentionally absent from the catalog to exercise the placeholder path.
  ]);
  const starterSlotOrder = ["QB", "RB", "RB"];
  const { starters, bench, ir } = buildRosterSlots({ roster: rosters[0], playerMap, starterSlotOrder });

  assert.deepEqual(starters.map(s => s.slot), ["QB", "RB", "RB"]);
  assert.equal(starters[0].player.name, "QB One");
  assert.equal(starters[1].player, null, "empty Sleeper slot (\"0\") resolves to a null player");
  assert.equal(starters[2].player.name, "RB One");

  assert.equal(bench.length, 1);
  assert.equal(bench[0].name, "Player #102", "a roster player missing from the catalog gets a placeholder, not a crash");

  assert.equal(ir.length, 1);
  assert.equal(ir[0].sleeperId, "103");
});
