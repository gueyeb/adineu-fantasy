import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("rankings API is public, passes weeks, validates input, and reports source failures", async t => {
  const seen = [];
  const server = createAppServer({ getRankings: async ({ week }) => {
    seen.push(week);
    if (week === 18) throw new Error("Source unavailable");
    return { week: week ?? 6, byPosition: {}, flex: [] };
  } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/rankings`;
  assert.equal((await (await fetch(base)).json()).week, 6);
  assert.equal((await (await fetch(`${base}?week=3`)).json()).week, 3);
  for (const value of ["", "0", "19", "2.5", "abc", "season"]) {
    assert.equal((await fetch(`${base}?week=${value}`)).status, 400);
  }
  const failure = await fetch(`${base}?week=18`);
  assert.equal(failure.status, 502);
  assert.equal((await failure.json()).error, "Source unavailable");
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
  assert.deepEqual(seen, [null, 3, 18]);
});

test("rankings request handler validates and responds without opening a socket", async () => {
  const seen = [];
  const server = createAppServer({ getRankings: async ({ week }) => {
    seen.push(week);
    if (week === 18) throw new Error("Source unavailable");
    return { week: week ?? 6, byPosition: {}, flex: [] };
  } });
  const handler = server.listeners("request")[0];
  const request = async (url, method = "GET") => {
    let status;
    let body;
    await handler({ url, method, headers: {} }, {
      writeHead(code) { status = code; },
      end(payload) { body = payload ? JSON.parse(payload) : null; }
    });
    return { status, body };
  };
  assert.equal((await request("/api/rankings")).body.week, 6);
  assert.equal((await request("/api/rankings?week=3")).body.week, 3);
  for (const value of ["", "0", "19", "2.5", "abc", "season"]) {
    assert.equal((await request(`/api/rankings?week=${value}`)).status, 400);
  }
  assert.equal((await request("/api/rankings?week=18")).status, 502);
  assert.equal((await request("/api/rankings", "POST")).status, 405);
  assert.deepEqual(seen, [null, 3, 18]);
});
