import test from "node:test";
import assert from "node:assert/strict";
import { renderRecentTransactions } from "../public/assets/transaction-view.js";
const at = Date.parse("2026-10-28T07:00:00Z");
test("named movements preserve teams, zero FAAB and separately observed current ownership", () => {
  const row = { transaction_id: "tx", status: "complete", type: "waiver", status_updated: at, settings: { waiver_bid: 0 }, movements: [{ action: "DROP", playerId: "p", playerName: "Player", rosterId: 1, teamName: "Old Team", currentOwnerRosterId: 2 }] };
  const before = structuredClone(row);
  const html = renderRecentTransactions([row], { rosterFor: id => ({ name: `Team ${id}` }) });
  assert.match(html, /Player/); assert.match(html, /Old Team/); assert.match(html, /actuellement chez Team 2/);
  assert.match(html, /FAAB dépensé : 0/); assert.match(html, /08:00 Paris/);
  assert.deepEqual(row, before);
});
test("failed requests never become completed acquisitions and raw rows can resolve public names", () => {
  const html = renderRecentTransactions([{ status: "failed", type: "waiver", created: at, adds: { p: 1 } }], { playerFor: () => ({ name: "Named Player" }), rosterFor: () => ({ name: "Named Team" }) });
  assert.match(html, /Échoué/); assert.match(html, /Ajout demandé/); assert.match(html, /ne prouve pas/);
  assert.match(html, /Named Player/); assert.match(html, /Named Team/);
});
test("unknown names and dates remain unknown, HTML is escaped and private actors are not rendered", () => {
  const html = renderRecentTransactions([{ transaction_id: '<script>', status: "complete", type: "trade", creator: "private-owner", created: null, adds: { unknown: 1 }, movements: [{ action: "ADD", playerId: "unknown", playerName: '<img src=x>', rosterId: 1 }] }]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('private-owner')); assert.match(html, /Date non confirmée/);
  assert.match(html, /Équipe non identifiée/); assert.match(html, /Identifiants de la source/);
  assert.match(renderRecentTransactions([]), /Aucune transaction/);
});
