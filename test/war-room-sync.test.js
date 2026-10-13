import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import { createWarRoomStore } from "../scripts/war-room-sync.js";
import { mergeBidHistory, normalizeBidHistory } from "../public/assets/war-room.js";

const entry = (playerId, reason = "9 cibles") => ({ playerId, name: `Joueur ${playerId}`, position: "WR", addedAt: "2026-10-11T18:00:00.000Z", week: 6, reason });
const reading = (at, bid) => ({ at, dataThroughWeek: 5, bid, max: 20 });

test("normalizeBidHistory keeps well-formed readings only and mergeBidHistory unions two devices", () => {
  const cleaned = normalizeBidHistory({ 77: [reading("2026-10-11T10:00:00Z", 5), { at: "nope" }, reading("2026-10-10T10:00:00Z", 3)], "<x>": [reading("2026-10-11T10:00:00Z", 1)], 88: "bad" });
  assert.deepEqual(Object.keys(cleaned), ["77"]);
  assert.deepEqual(cleaned[77].map(point => point.bid), [3, 5]);
  assert.deepEqual(normalizeBidHistory(null), {});
  const merged = mergeBidHistory({ 77: [reading("2026-10-10T10:00:00Z", 3)] }, { 77: [reading("2026-10-10T10:00:00Z", 3), reading("2026-10-13T10:00:00Z", 8)], 99: [reading("2026-10-12T10:00:00Z", 1)] });
  assert.deepEqual(merged[77].map(point => point.bid), [3, 8]);
  assert.equal(merged[99].length, 1);
  const many = Array.from({ length: 9 }, (_, index) => reading(`2026-10-0${index + 1}T10:00:00Z`, index));
  assert.deepEqual(normalizeBidHistory({ 77: many })[77].map(point => point.bid), [3, 4, 5, 6, 7, 8]);
});

function fakeSupabase(rows = new Map()) {
  const calls = [];
  return { calls, rows, from: table => ({
    select: () => ({ match: key => ({ maybeSingle: async () => ({ data: rows.get(JSON.stringify(key)) ?? null, error: null }) }) }),
    upsert: async (row, options) => {
      calls.push({ table, row, options });
      rows.set(JSON.stringify({ season: row.season, league_id: row.league_id, roster_id: row.roster_id }), row);
      return { error: null };
    }
  }) };
}

test("the server store renormalizes what it writes and reads one row per roster", async () => {
  const supabase = fakeSupabase();
  const store = createWarRoomStore({ getSupabase: async () => supabase, season: 2026, leagueId: "L" });
  assert.equal(await store.load(3), null);
  const saved = await store.save(3, { watchlist: [entry("77"), { playerId: "<script>", reason: "x", addedAt: "2026-10-11" }, entry("88", "")], bidHistory: { 77: [reading("2026-10-11T10:00:00Z", 5)], bad: "x" } });
  assert.deepEqual(saved.watchlist.map(row => row.playerId), ["77"]);
  assert.deepEqual(Object.keys(saved.bidHistory), ["77"]);
  assert.deepEqual([supabase.calls[0].table, supabase.calls[0].row.season, supabase.calls[0].row.league_id, supabase.calls[0].row.roster_id], ["coach_war_room", 2026, "L", 3]);
  const loaded = await store.load(3);
  assert.deepEqual(loaded.watchlist, saved.watchlist);
  assert.equal(await store.load(4), null);
});

test("war room sync routes require the Coach access, validate the roster and survive a store failure", async t => {
  const state = new Map();
  let failing = false;
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", secureCookies: false,
    warRoomStore: {
      load: async rosterId => { if (failing) throw new Error("down"); return state.get(rosterId) ?? null; },
      save: async (rosterId, value) => { if (failing) throw new Error("down"); state.set(rosterId, { ...value, updatedAt: "now" }); return state.get(rosterId); }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/coach/war-room`;
  const bearer = { authorization: "Bearer test-api", "content-type": "application/json" };
  const put = (body, headers = bearer) => fetch(url, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

  assert.equal((await fetch(`${url}?roster=3`)).status, 404);
  assert.equal((await put({ rosterId: 3, watchlist: [] }, { "content-type": "application/json" })).status, 404);
  assert.deepEqual(await (await fetch(`${url}?roster=3`, { headers: bearer })).json(), { state: null });
  for (const roster of ["0", "abc", "33", "2.5"]) assert.equal((await fetch(`${url}?roster=${roster}`, { headers: bearer })).status, 400);
  assert.equal((await put({ rosterId: "3", watchlist: [] })).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ rosterId: 3, watchlist: [], pad: "x".repeat(70 * 1024) })).status, 413);
  assert.equal((await fetch(url, { method: "DELETE", headers: bearer })).status, 405);

  const saved = await put({ rosterId: 3, watchlist: [entry("77")], bidHistory: {} });
  assert.equal(saved.status, 200);
  assert.equal((await (await fetch(`${url}?roster=3`, { headers: bearer })).json()).state.watchlist[0].playerId, "77");

  // A browser session must come from the site itself to write.
  const login = await fetch(`${base}/api/coach-session`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ password: "test-only" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await put({ rosterId: 3, watchlist: [] }, { cookie, "content-type": "application/json" })).status, 403);
  assert.equal((await put({ rosterId: 3, watchlist: [] }, { cookie, origin: "https://evil.example", "content-type": "application/json" })).status, 403);
  assert.equal((await put({ rosterId: 3, watchlist: [] }, { cookie, origin: base, "content-type": "application/json" })).status, 200);

  failing = true;
  assert.deepEqual([(await fetch(`${url}?roster=3`, { headers: bearer })).status, (await put({ rosterId: 3, watchlist: [] })).status], [503, 503]);
});

test("syncWarRoom pulls the server copy, keeps unsent local changes and always merges readings", async t => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const realFetch = globalThis.fetch;
  let remote = { watchlist: [entry("77")], bidHistory: { 77: [reading("2026-10-10T10:00:00Z", 3)] } };
  let online = true;
  const puts = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!online) return { ok: false, status: 404, json: async () => ({}) };
    if (options.method === "PUT") { remote = JSON.parse(options.body); puts.push(remote); return { ok: true, json: async () => ({ state: remote }) }; }
    return { ok: true, json: async () => ({ state: remote }) };
  };
  t.after(() => { globalThis.fetch = realFetch; delete globalThis.localStorage; });
  const store = await import("../public/assets/war-room-store.js");

  assert.equal(await store.syncWarRoom(3), "PULLED");
  assert.deepEqual(store.loadWatchlist(3).map(row => row.playerId), ["77"]);
  assert.equal(puts.length, 0);

  // Offline (or signed out): the change stays local and is sent at the next sync.
  online = false;
  assert.equal(store.saveWatchlist(3, [entry("88"), ...store.loadWatchlist(3)]), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await store.syncWarRoom(3), "UNAVAILABLE");
  online = true;
  remote = { watchlist: [entry("99")], bidHistory: { 77: [reading("2026-10-10T10:00:00Z", 3), reading("2026-10-13T10:00:00Z", 9)] } };
  assert.equal(await store.syncWarRoom(3), "PUSHED");
  assert.deepEqual(remote.watchlist.map(row => row.playerId).sort(), ["77", "88"]);
  assert.deepEqual(store.loadBidHistory(3)[77].map(point => point.bid), [3, 9]);

  // Another device changed the list: with nothing unsent here, the server copy wins.
  remote = { ...remote, watchlist: [entry("99")] };
  assert.equal(await store.syncWarRoom(3), "PULLED");
  assert.deepEqual(store.loadWatchlist(3).map(row => row.playerId), ["99"]);
});
