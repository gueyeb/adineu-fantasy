import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";
import {
  buildOwnerRows, createCoachSettingsStore, createMemoryCoachSettingsStore, DEFAULT_COACH_SETTINGS,
  normalizeCoachSettings, normalizeOwnerName, resolveCoachTeam, resolveDeltaMode, validateCoachSettingsPatch
} from "../scripts/coach-settings.js";
import { readSettingsForm, renderCoachSettings, renameMessage } from "../public/assets/coach-settings-view.js";

const OWNER_A = "20bdf1be-a3dc-4ac5-8627-c24b7ec1d761";
const OWNER_B = "3f45d77a-f08a-4f83-a38e-9704dda44f0a";
const owners = () => [{ id: OWNER_A, display_name: "Tamsir" }, { id: OWNER_B, display_name: "Magatte" }];
const links = [
  { owner_id: OWNER_A, platform: "sleeper", platform_display_name: "flemme", platform_user_id: "secret-1" },
  { owner_id: OWNER_A, platform: "yahoo", platform_display_name: "Tamsir", platform_user_id: "secret-2" }
];

test("settings are normalized on read and strictly validated on write", () => {
  assert.deepEqual(normalizeCoachSettings(null), DEFAULT_COACH_SETTINGS);
  assert.deepEqual(normalizeCoachSettings({ teamRosterId: 4, deltaByDefault: true, nearKickoffHours: 2.4, extra: 1 }), { teamRosterId: 4, deltaByDefault: true, nearKickoffHours: 2.5 });
  assert.deepEqual(normalizeCoachSettings({ teamRosterId: 40, deltaByDefault: "yes", nearKickoffHours: 99 }), DEFAULT_COACH_SETTINGS);
  assert.deepEqual(validateCoachSettingsPatch({ teamRosterId: null, nearKickoffHours: 0.5 }), { patch: { teamRosterId: null, nearKickoffHours: 0.5 } });
  for (const bad of [null, [], { teamRosterId: 0 }, { teamRosterId: "4" }, { deltaByDefault: 1 }, { nearKickoffHours: 0.25 }, { nearKickoffHours: 1.3 }, { nearKickoffHours: 25 }, { team: "t0z" }]) {
    assert.ok(validateCoachSettingsPatch(bad).error, JSON.stringify(bad));
  }
});

test("followed team: explicit param > saved setting > COACH_TEAM > t0z; delta param beats the saved default", () => {
  const saved = { ...DEFAULT_COACH_SETTINGS, teamRosterId: 7 };
  assert.deepEqual(resolveCoachTeam({ param: "Kuro", settings: saved, env: { COACH_TEAM: "x" } }), { team: "Kuro", source: "PARAM" });
  assert.deepEqual(resolveCoachTeam({ settings: saved, env: { COACH_TEAM: "x" } }), { team: "7", source: "SETTINGS" });
  assert.deepEqual(resolveCoachTeam({ settings: DEFAULT_COACH_SETTINGS, env: { COACH_TEAM: "x" } }), { team: "x", source: "ENV" });
  assert.deepEqual(resolveCoachTeam({ settings: DEFAULT_COACH_SETTINGS, env: {} }), { team: "t0z", source: "DEFAULT" });
  const deltaOn = { ...DEFAULT_COACH_SETTINGS, deltaByDefault: true };
  assert.equal(resolveDeltaMode(null, deltaOn), true);
  assert.equal(resolveDeltaMode("0", deltaOn), false);
  assert.equal(resolveDeltaMode("1", DEFAULT_COACH_SETTINGS), true);
  assert.equal(resolveDeltaMode(null, DEFAULT_COACH_SETTINGS), false);
});

test("without the table or Supabase the store serves labeled defaults and refuses writes", async () => {
  const offline = createCoachSettingsStore({ getSupabase: async () => { throw new Error("SUPABASE_URL requis"); } });
  assert.deepEqual(await offline.load(), { settings: DEFAULT_COACH_SETTINGS, source: "UNAVAILABLE", updatedAt: null });
  await assert.rejects(offline.save({ deltaByDefault: true }), { code: "SETTINGS_UNAVAILABLE", status: 503 });

  const missingTable = { from: () => ({ select: () => ({ match: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'relation "coach_settings" does not exist' } }) }) }) }) };
  assert.equal((await createCoachSettingsStore({ getSupabase: async () => missingTable }).load()).source, "UNAVAILABLE");

  let reads = 0;
  const savedRow = { from: () => ({ select: () => ({ match: () => ({ maybeSingle: async () => { reads++; return { data: { settings: { teamRosterId: 5, nearKickoffHours: 6, junk: true }, updated_at: "2026-10-28T08:00:00Z" }, error: null }; } }) }) }) };
  const store = createCoachSettingsStore({ getSupabase: async () => savedRow });
  assert.deepEqual(await store.load(), { settings: { teamRosterId: 5, deltaByDefault: false, nearKickoffHours: 6 }, source: "SAVED", updatedAt: "2026-10-28T08:00:00Z" });
  await store.load();
  assert.equal(reads, 1, "cached between requests");
});

test("owner rename goes through the audited function; its absence never writes partially", async () => {
  const calls = [];
  const client = error => ({ rpc: async (name, args) => { calls.push([name, args]); return error ? { data: null, error: { message: error } } : { data: [{ owner_id: OWNER_A, previous_name: "Tamsir", new_name: "Tams", changed_at: "t" }], error: null }; } });
  const ok = createCoachSettingsStore({ getSupabase: async () => client(null) });
  assert.deepEqual(await ok.renameOwner(OWNER_A, { expected: "Tamsir", next: "  Tams " }), { ownerId: OWNER_A, previousName: "Tamsir", newName: "Tams", changedAt: "t" });
  assert.deepEqual(calls[0], ["rename_owner_display_name", { p_owner: OWNER_A, p_expected: "Tamsir", p_next: "Tams" }]);
  await assert.rejects(ok.renameOwner(OWNER_A, { expected: "Tamsir", next: "x".repeat(41) }), { code: "NOM_INVALIDE", status: 400 });
  assert.equal(calls.length, 1, "an invalid name never reaches the database");
  await assert.rejects(createCoachSettingsStore({ getSupabase: async () => client("NOM_DEJA_UTILISE") }).renameOwner(OWNER_A, { expected: "Tamsir", next: "Magatte" }), { status: 409 });
  await assert.rejects(createCoachSettingsStore({ getSupabase: async () => client("Could not find the function public.rename_owner_display_name") }).renameOwner(OWNER_A, { expected: "Tamsir", next: "T" }), { code: "OWNER_RENAME_UNAVAILABLE", status: 503 });
  assert.equal(normalizeOwnerName("a\u0007b"), null);
  assert.equal(normalizeOwnerName("   "), null);
});

test("owner rows expose platform names and confirmed aliases, never platform user ids", () => {
  const rows = buildOwnerRows(owners(), links);
  assert.deepEqual(rows.find(row => row.id === OWNER_A), {
    id: OWNER_A, displayName: "Tamsir", accounts: [{ platform: "sleeper", name: "flemme" }, { platform: "yahoo", name: "Tamsir" }], confirmedAliases: ["flemme"]
  });
  assert.doesNotMatch(JSON.stringify(rows), /secret-/);
});

test("the settings panel escapes names, flags a vanished roster and validates the form", () => {
  const html = renderCoachSettings({ source: "SAVED", settings: { teamRosterId: 9, deltaByDefault: true, nearKickoffHours: 3 }, resolvedTeam: { team: "9", source: "SETTINGS" },
    teams: [{ rosterId: 1, label: "Boukki · babttz (@t0z)" }], owners: [{ id: OWNER_A, displayName: "<b>x</b>", accounts: [], confirmedAliases: [] }] });
  assert.match(html, /roster enregistré #9 n’existe plus/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /name="deltaByDefault" checked/);
  assert.match(renderCoachSettings({ source: "UNAVAILABLE", settings: DEFAULT_COACH_SETTINGS, teams: null, owners: null }), /Enregistrer les réglages<\/button>/);
  assert.match(renderCoachSettings({ source: "UNAVAILABLE", settings: DEFAULT_COACH_SETTINGS }), /type="submit" disabled/);
  assert.deepEqual(readSettingsForm({ teamRosterId: "", deltaByDefault: false, nearKickoffHours: "3.5" }), { payload: { teamRosterId: null, deltaByDefault: false, nearKickoffHours: 3.5 } });
  assert.ok(readSettingsForm({ teamRosterId: "2", deltaByDefault: true, nearKickoffHours: "0" }).error);
  assert.equal(renameMessage("NOM_DEJA_UTILISE"), "Ce nom est déjà utilisé par un autre manager.");
});

function coachServer(t, overrides = {}) {
  const requestedTeams = [];
  const prelockTeams = [];
  const server = createAppServer({
    coachPassword: "test-only", coachToken: "test-api", modelJobToken: "job", secureCookies: false,
    getContext: async ({ team }) => {
      requestedTeams.push(team);
      return { week: 2, league: { teams: 12, playoffTeams: 8, rosterSettings: { starters: {}, benchSlots: 6, reserveSlots: 1 } },
        myTeam: { rosterId: 1, teamName: "Boukki", owner: "t0z", starters: [], bench: [], ir: [], record: { wins: 1, losses: 0 }, standingsRank: 3, faab: { remaining: 497, budget: 1000 } } };
    },
    getInjuryStatuses: async () => new Map(),
    getPlayerValues: async () => ({ byId: new Map(), weeklyProjections: {} }),
    getFreeAgents: async () => ({ lastCompletedWeek: 1, byPosition: {} }),
    getMatchupContext: async () => null,
    analyze: async () => ({ results: [{ proposals: [] }] }),
    decisionLogStore: { coachState: async () => null, saveCoachState: async () => {} },
    runPrelockJob: async ({ team }) => { prelockTeams.push(team); return { ok: true }; },
    listCoachTeams: async () => [{ rosterId: 1, label: "Boukki · babttz (@t0z)" }, { rosterId: 7, label: "Kuro · Mat (@Shiro00)" }],
    ...overrides
  });
  server.listen(0, "127.0.0.1");
  t.after(() => server.close());
  return { server, requestedTeams, prelockTeams };
}

test("settings API: same access as the plan, validated writes, audited renames, and the saved team drives the Coach", async t => {
  const store = createMemoryCoachSettingsStore({ owners: owners(), links });
  const { server, requestedTeams, prelockTeams } = coachServer(t, { coachSettingsStore: store });
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/coach/settings`;
  const bearer = { authorization: "Bearer test-api", "content-type": "application/json" };
  const put = (body, headers = bearer, path = url) => fetch(path, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

  assert.equal((await fetch(url)).status, 404);
  assert.equal((await put({ deltaByDefault: true }, { "content-type": "application/json" })).status, 404);
  const initial = await (await fetch(url, { headers: bearer })).json();
  assert.equal(initial.source, "DEFAULT");
  assert.equal(initial.teams.length, 2);
  assert.equal(initial.owners.length, 2);
  assert.doesNotMatch(JSON.stringify(initial), /secret-/);

  for (const bad of [{ teamRosterId: "7" }, { nearKickoffHours: 30 }, { unknown: 1 }]) assert.equal((await put(bad)).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ pad: "x".repeat(3000) })).status, 413);
  assert.equal((await fetch(url, { method: "DELETE", headers: bearer })).status, 405);

  // A browser session writes only from the site itself.
  const login = await fetch(`${base}/api/coach-session`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ password: "test-only" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await put({ teamRosterId: 7 }, { cookie, "content-type": "application/json" })).status, 403);
  assert.equal((await put({ teamRosterId: 7 }, { cookie, origin: "https://evil.example", "content-type": "application/json" })).status, 403);
  const saved = await put({ teamRosterId: 7, nearKickoffHours: 1.5 }, { cookie, origin: base, "content-type": "application/json" });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).settings, { teamRosterId: 7, deltaByDefault: false, nearKickoffHours: 1.5 });

  // The signed-in page follows the saved team; a bearer call may still name another one.
  await fetch(`${base}/api/coach?team=ignored`, { headers: { cookie } });
  await fetch(`${base}/api/coach?team=t0z`, { headers: bearer });
  await fetch(`${base}/api/coach`, { headers: bearer });
  assert.deepEqual(requestedTeams, ["7", "t0z", "7"]);
  await fetch(`${base}/api/coach/prelock`, { method: "POST", headers: { authorization: "Bearer job" } });
  await fetch(`${base}/api/coach/prelock?team=Kuro`, { method: "POST", headers: { authorization: "Bearer job" } });
  assert.deepEqual(prelockTeams, ["7", "Kuro"]);

  // Change-only bulletins by default: a bearer call without `delta` answers with `notify`; delta=0 opts out.
  assert.equal("notify" in await (await fetch(`${base}/api/coach`, { headers: bearer })).json(), false);
  await put({ deltaByDefault: true });
  assert.equal("notify" in await (await fetch(`${base}/api/coach`, { headers: bearer })).json(), true);
  assert.equal("notify" in await (await fetch(`${base}/api/coach?delta=0`, { headers: bearer })).json(), false);

  // Renames: validated, conflict-checked, audited.
  const owner = `${url}/owners/${OWNER_A}`;
  assert.equal((await put({ displayName: "Tams" }, bearer, owner)).status, 400, "expected name required");
  assert.equal((await put({ expected: "Tamsir", displayName: "magatte" }, bearer, owner)).status, 409);
  assert.equal((await put({ expected: "Old", displayName: "Tams" }, bearer, owner)).status, 409);
  assert.equal((await put({ expected: "Tamsir", displayName: "Tams" }, bearer, `${url}/owners/not-a-uuid`)).status, 404);
  assert.equal((await put({ expected: "Tamsir", displayName: "Tams" }, { cookie, "content-type": "application/json" }, owner)).status, 403);
  const renamed = await put({ expected: "Tamsir", displayName: " Tams " }, bearer, owner);
  assert.equal(renamed.status, 200);
  assert.deepEqual((await renamed.json()).change.newName, "Tams");
  assert.deepEqual(store.audit.map(row => [row.previousName, row.newName]), [["Tamsir", "Tams"]]);
});

test("settings API degrades without the table: defaults readable, writes refused, Coach unaffected", async t => {
  const { server, requestedTeams } = coachServer(t, { coachSettingsStore: createCoachSettingsStore({ getSupabase: async () => { throw new Error("SUPABASE_URL requis"); } }), listCoachTeams: async () => { throw new Error("offline"); } });
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const bearer = { authorization: "Bearer test-api", "content-type": "application/json" };
  const body = await (await fetch(`${base}/api/coach/settings`, { headers: bearer })).json();
  assert.equal(body.source, "UNAVAILABLE");
  assert.equal(body.teams, null);
  assert.equal(body.owners, null);
  const write = await fetch(`${base}/api/coach/settings`, { method: "PUT", headers: bearer, body: JSON.stringify({ deltaByDefault: true }) });
  assert.equal(write.status, 503);
  assert.deepEqual(await write.json(), { error: "SETTINGS_UNAVAILABLE" });
  assert.equal((await fetch(`${base}/api/coach`, { headers: bearer })).status, 200);
  assert.deepEqual(requestedTeams, [process.env.COACH_TEAM || "t0z"]);
});
