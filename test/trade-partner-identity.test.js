import test from "node:test";
import assert from "node:assert/strict";
import { partnerLabel } from "../public/assets/manager-identity.js";
import { buildLeagueRosterSnapshot, buildLeagueTradeIntelligence, formatLeagueTradeIntelligence } from "../public/assets/league-trade-intelligence.js";
import { findTradeProposals } from "../public/assets/trade-recommender.js";

test("trade partner label: team then confirmed manager, else current account", () => {
  assert.equal(partnerLabel({ account: "flemme", teamName: "flemme" }), "Team flemme (Tamsir)", "sync fallback team name");
  assert.equal(partnerLabel({ account: "SneakySlayerMG", teamName: null }), "Team SneakySlayerMG (Magatte)");
  assert.equal(partnerLabel({ account: "Shiro00", teamName: "Kuro" }), "Kuro (Mat)");
  assert.equal(partnerLabel({ account: "NouveauCompte", teamName: "Les Nouveaux" }), "Les Nouveaux (@NouveauCompte)", "unknown account never promoted");
  assert.equal(partnerLabel({ account: null, teamName: "Solo" }), "Solo");
  assert.equal(partnerLabel(), "Équipe sans nom public");
});

const users = [
  { user_id: "a", display_name: "SneakySlayerMG", metadata: {} },
  { user_id: "b", display_name: "Shiro00", metadata: { team_name: "Kuro" } },
  { user_id: "c", display_name: "flemme", metadata: {} }
];
const rosters = [
  { roster_id: 1, owner_id: "a", players: [], starters: [], reserve: [] },
  { roster_id: 2, owner_id: "b", players: [], starters: [], reserve: [] },
  { roster_id: 3, owner_id: "c", players: [], starters: [], reserve: [] }
];

test("league trade fit names partners like the roster pickers; machine fields unchanged", () => {
  const snapshot = buildLeagueRosterSnapshot({ rosters, users, playerFor: () => null, asOf: "2026-10-28T00:00:00Z" });
  const fit = buildLeagueTradeIntelligence({ snapshot, targetRosterId: 1, week: 9 });
  const byRoster = Object.fromEntries(fit.partners.map(partner => [partner.rosterId, partner]));
  assert.equal(byRoster[2].label, "Kuro (Mat)");
  assert.equal(byRoster[3].label, "Team flemme (Tamsir)");
  assert.equal(byRoster[3].teamName, "flemme", "raw team name kept for mapping");
  const text = formatLeagueTradeIntelligence(fit).join("\n");
  assert.match(text, /^Kuro \(Mat\): /m);
  assert.match(text, /^Team flemme \(Tamsir\): /m);
});

test("Finder proposals name the partner through the shared identity", () => {
  // Same bilateral fixture as test/trade-score.test.js.
  const player = (name, position, projectedPpg) => ({ name, position, projectedPpg, quality: { expertRank: 40 } });
  const core = prefix => [player(`${prefix}QB`, "QB", 20), player(`${prefix}TE`, "TE", 10), player(`${prefix}K`, "K", 8), player(`${prefix}DEF`, "DEF", 8)];
  const mine = [...core("M"), player("RB1", "RB", 14), player("RB2", "RB", 7), player("WR1", "WR", 18), player("WR2", "WR", 17), player("WR surplus", "WR", 15), player("WR bench", "WR", 14)];
  const theirs = [...core("T"), player("TRB1", "RB", 18), player("TRB2", "RB", 17), player("RB surplus", "RB", 15), player("TRB bench", "RB", 14), player("TWR1", "WR", 14), player("TWR2", "WR", 7)];
  const proposals = findTradeProposals({ targetRosterId: 1, rosters: [
    { roster_id: 1, ownerName: "SneakySlayerMG", name: "SneakySlayerMG", players: mine },
    { roster_id: 3, ownerName: "flemme", name: "flemme", players: theirs }
  ] });
  assert.ok(proposals.length > 0, "fixture produces at least one proposal");
  for (const proposal of proposals) assert.equal(proposal.partnerName, "Team flemme (Tamsir)");
});
