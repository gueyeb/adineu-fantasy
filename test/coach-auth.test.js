import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createCoachAuth } from "../scripts/coach-auth.js";
import { createAppServer } from "../server.js";

test("coach session cookie expires, logs out, and never contains the password", () => {
  let time = 0;
  const auth = createCoachAuth({ password: "test-only", now: () => time });
  assert.equal(auth.authenticated(), false);
  const result = auth.login("test-only", "ip");
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict/);
  assert.match(result.cookie, /Secure/);
  assert.doesNotMatch(result.cookie, /test-only/);
  assert.equal(auth.authenticated(result.cookie), true);
  auth.logout(result.cookie);
  assert.equal(auth.authenticated(result.cookie), false);
  const next = auth.login("test-only", "ip");
  time = 8 * 60 * 60 * 1000;
  assert.equal(auth.authenticated(next.cookie), false);
});

test("coach login limits failed attempts and fails closed when disabled", () => {
  let time = 0;
  const auth = createCoachAuth({ password: "test-only", now: () => time });
  for (let i = 0; i < 10; i++) assert.equal(auth.login("wrong", "ip").status, 401);
  assert.equal(auth.login("test-only", "ip").status, 429);
  time = 15 * 60 * 1000;
  assert.equal(auth.login("test-only", "ip").status, 200);
  assert.equal(createCoachAuth().login("", "ip").status, 401);
});

test("coach login rejects cross-origin and malformed requests; anonymous API stays private", async t => {
  const server = createAppServer({ coachPassword: "test-only", secureCookies: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/coach`)).status, 404);
  const post = (origin, body) => fetch(`${base}/api/coach-session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
  assert.equal((await post("https://evil.example", '{}')).status, 403);
  assert.equal((await post("invalid", '{}')).status, 403);
  assert.equal((await post(base, "bad json")).status, 400);
  const response = await post(base, JSON.stringify({ password: "test-only" }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const logout = await fetch(`${base}/api/coach-session?logout=1`, { method: "POST", headers: { origin: base, cookie: response.headers.get("set-cookie") } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});
