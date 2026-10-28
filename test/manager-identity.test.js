import test from "node:test";
import assert from "node:assert/strict";
import { accountNote, canonicalManagerName, describeIdentity, managerLabel, ownerTag, rosterOptionLabel, teamLabel, teamOwnerLabel } from "../public/assets/manager-identity.js";
import { sleeperManager } from "../public/assets/rivalry-week.js";
import { publicTeamIdentity } from "../public/assets/weekly-awards.js";
import { renderLiveTrackerCards } from "../public/assets/live-tracker-view.js";

// Public names read from Sleeper and v_standings on 28/10/2026 (no account ids).
test("stored 2026 names resolve to confirmed managers only; unknown accounts stay accounts", () => {
  assert.equal(canonicalManagerName("SneakySlayerMG"), "Magatte");
  assert.equal(canonicalManagerName("flemme"), "Tamsir");
  assert.equal(canonicalManagerName("MouhammadAT"), "Mat");
  assert.equal(canonicalManagerName("Shiro00"), "Mat");
  assert.equal(canonicalManagerName("Birama"), "Birama", "already canonical in Supabase");
  assert.equal(canonicalManagerName("NouveauCompte"), null);
  assert.equal(canonicalManagerName(""), null);
  assert.equal(sleeperManager({ display_name: "SneakySlayerMG" }), "Magatte", "rivalry mapping unchanged");
});

test("a team name equal to the account is a sync fallback, not a team chosen by the manager", () => {
  const sneaky = describeIdentity({ account: "SneakySlayerMG", teamName: "SneakySlayerMG" });
  assert.deepEqual(sneaky, { manager: "Magatte", account: "SneakySlayerMG", accountIsCurrent: false, teamName: null, defaultAccount: "SneakySlayerMG" });
  assert.equal(teamLabel(sneaky), "Team SneakySlayerMG");
  assert.equal(teamLabel({ account: null, teamName: null }), "Équipe sans nom public");
  assert.equal(managerLabel(sneaky), "Magatte");
  assert.equal(accountNote(sneaky), "Compte enregistré · @SneakySlayerMG");
  const kuro = describeIdentity({ account: "MouhammadAT", teamName: "Kuro" });
  assert.equal(teamLabel(kuro), "Kuro");
  assert.equal(accountNote(kuro), "Compte enregistré · @MouhammadAT", "a stored name is never called the current account");
  assert.equal(accountNote(describeIdentity({ account: "Shiro00", teamName: "Kuro", accountIsCurrent: true })), "Compte Sleeper · @Shiro00");
  assert.equal(accountNote(describeIdentity({ account: "Birama", teamName: "Ethan Hunt" })), null);
  const unknown = describeIdentity({ account: "NouveauCompte", teamName: "Les Nouveaux" });
  assert.equal(managerLabel(unknown), "@NouveauCompte");
  assert.equal(accountNote(unknown), null);
  assert.equal(managerLabel(describeIdentity()), "Manager inconnu");
});

test("roster pickers name team, confirmed manager and current account", () => {
  assert.equal(rosterOptionLabel({ account: "flemme", teamName: null }), "Team flemme · Tamsir (@flemme)");
  assert.equal(rosterOptionLabel({ account: "flemme", teamName: "flemme" }), "Team flemme · Tamsir (@flemme)");
  assert.equal(rosterOptionLabel({ account: "t0z", teamName: "Boukki" }), "Boukki · Babacar (@t0z)");
  assert.equal(rosterOptionLabel({ account: "NouveauCompte", teamName: "X" }), "X · @NouveauCompte");
});

test("weekly awards mark an unnamed team instead of passing the manager off as its name", () => {
  const users = [{ user_id: "a", display_name: "flemme", metadata: {} }, { user_id: "b", display_name: "Inconnu", metadata: {} }];
  assert.deepEqual(publicTeamIdentity({ owner_id: "a" }, users), { teamName: "Team flemme (Tamsir)", manager: "Tamsir" });
  assert.equal(publicTeamIdentity({ owner_id: "b" }, users).teamName, "Team Inconnu");
  assert.equal(publicTeamIdentity({ owner_id: "z" }, users).teamName, "Équipe sans nom public");
});

test("Live cards separate team, confirmed manager and current Sleeper account", () => {
  const side = (account, publicTeamName) => ({ teamName: publicTeamName || account, manager: account, account, publicTeamName, points: 0, estimate: null, starters: [], bench: [], started: true, finished: false, projectionGaps: [] });
  const html = renderLiveTrackerCards({ matchups: [{ teams: [side("SneakySlayerMG", null), side("Shiro00", "Kuro")] }] });
  assert.match(html, /Magatte · Compte Sleeper · @SneakySlayerMG<\/span><strong>Team SneakySlayerMG<\/strong>/);
  assert.match(html, /Mat · Compte Sleeper · @Shiro00<\/span><strong>Kuro<\/strong>/);
  const legacy = renderLiveTrackerCards({ matchups: [{ teams: [{ ...side("x", "T"), account: undefined, manager: "Owner", teamName: "Team" }, side("y", "U")] }] });
  assert.match(legacy, /Owner<\/span><strong>Team<\/strong>/, "rows without identity fields render as before");
});

test("a stored canonical owner still recognizes its own account used as team name", () => {
  assert.equal(teamLabel(describeIdentity({ account: "Tamsir", teamName: "flemme" })), "Team flemme");
  assert.equal(teamLabel(describeIdentity({ account: "Magatte", teamName: "SneakySlayerMG" })), "Team SneakySlayerMG");
  assert.equal(teamLabel(describeIdentity({ account: "Mat", teamName: "Kuro" })), "Kuro");
  // Another manager's account is a real team name, never a fallback for this one.
  assert.equal(teamLabel(describeIdentity({ account: "Mat", teamName: "flemme" })), "flemme");
  assert.equal(accountNote(describeIdentity({ account: "Tamsir", teamName: "flemme" })), null);
});

test("former archive names still resolve after the first-name rename", () => {
  assert.equal(canonicalManagerName("t0z"), "Babacar");
  assert.equal(canonicalManagerName("babttz"), "Babacar");
  assert.equal(canonicalManagerName("mouzay"), "Moussé");
  assert.equal(canonicalManagerName("YeezyJr"), "Moussé");
  assert.equal(canonicalManagerName("Saitaamaa22"), "Oumar");
  assert.equal(canonicalManagerName("Toughness"), "Oumar");
  assert.equal(canonicalManagerName("moussé"), "Moussé");
});

test("message headers tag the account with its confirmed manager; unknown accounts stay accounts", () => {
  assert.equal(ownerTag("t0z"), "Babacar, @t0z");
  assert.equal(ownerTag("Birama"), "@Birama", "a canonical name is not repeated");
  assert.equal(ownerTag("NouveauCompte"), "@NouveauCompte");
  assert.equal(teamOwnerLabel("BOUKKI", "t0z"), "BOUKKI (Babacar, @t0z)");
  assert.equal(teamOwnerLabel("Kuro", "Shiro00"), "Kuro (Mat, @Shiro00)");
  assert.equal(teamOwnerLabel("Boukki", null), "Boukki");
});
