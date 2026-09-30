import test from "node:test";
import assert from "node:assert/strict";
import { appendManagerPreferences } from "../public/assets/ai-context-client.js";

test("copied AI context appends only valid browser-saved roster preferences", () => {
  const context = { myTeam: {
    starters: [{ player: { sleeperId: "p1", name: "Starter" } }],
    bench: [{ sleeperId: "p2", name: "Bench" }],
    ir: []
  } };
  const text = appendManagerPreferences("BASE", context, { p1: "UNTOUCHABLE", p2: "SHOP", stale: "KEEP" });
  assert.match(text, /MANAGER PREFERENCES — browser saved/);
  assert.match(text, /SHOP: Bench/);
  assert.match(text, /UNTOUCHABLE: Starter/);
  assert.doesNotMatch(text, /stale/);
});

test("copied AI context stays unchanged when no explicit preference exists", () => {
  assert.equal(appendManagerPreferences("BASE", { myTeam: { starters: [], bench: [], ir: [] } }, {}), "BASE");
});
