import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

async function start(t, options) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("weekly model job requires the bearer token and runs the job", async t => {
  let runs = 0;
  const base = await start(t, { modelJobToken: "secret-token", runModelJob: async () => { runs++; return { week: 4, message: "ok" }; } });
  assert.equal((await fetch(`${base}/api/model/weekly`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/api/model/weekly`, { method: "POST", headers: { authorization: "Bearer nope" } })).status, 401);
  const ok = await fetch(`${base}/api/model/weekly`, { method: "POST", headers: { authorization: "Bearer secret-token" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).week, 4);
  assert.equal(runs, 1);
});

test("weekly model job is disabled without a configured token", async t => {
  const base = await start(t, { modelJobToken: "", runModelJob: async () => ({}) });
  assert.equal((await fetch(`${base}/api/model/weekly`, { method: "POST", headers: { authorization: "Bearer " } })).status, 503);
});

test("model feedback endpoint returns the latest report and a text alias", async t => {
  const base = await start(t, { getModelFeedback: async () => ({ week: 4, report: { faab: {} }, message: "📈 SUIVI DU MODÈLE" }) });
  assert.equal((await (await fetch(`${base}/api/model/feedback`)).json()).week, 4);
  assert.match(await (await fetch(`${base}/api/model/feedback?format=text`)).text(), /SUIVI DU MODÈLE/);
});
