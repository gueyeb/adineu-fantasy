import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecisionSnapshot, replayDecisionSnapshot, saveDecisionSnapshot } from '../scripts/decision-snapshot.js';
const report = { leagueId:'fixture',season:'2026',week:4,availabilityAsOf:'2026-10-04T10:00:00Z',generatedAt:'2026-10-04T10:01:00Z', byPosition:{WR:[{sleeperId:'x',provenance:{fetchedAt:'2026-10-04T09:00:00Z'}}]}, secret:'excluded' };
test('frozen snapshots preserve scope, integrity and cannot leak unrelated root configuration', () => {
  const snapshot = createDecisionSnapshot(report);
  assert.equal(snapshot.report.secret,undefined);
  assert.equal(replayDecisionSnapshot(snapshot,{cutoff:'2026-10-04T11:00:00Z'}).executable,false);
  assert.throws(() => replayDecisionSnapshot(snapshot,{cutoff:'2026-10-04T10:00:00Z'}), /after replay cutoff/);
  snapshot.report.week=5;
  assert.throws(() => replayDecisionSnapshot(snapshot,{cutoff:'2026-10-04T11:00:00Z'}), /integrity/);
});
test('snapshot persistence is immutable and round trips offline', async () => {
  const dir = await mkdtemp(join(tmpdir(),'adineu-decision-'));
  try {
    const path=join(dir,'snapshot.json');
    const snapshot=createDecisionSnapshot(report);
    await saveDecisionSnapshot(path,snapshot);
    await assert.rejects(saveDecisionSnapshot(path,snapshot),{code:'EEXIST'});
    const replay=replayDecisionSnapshot(JSON.parse(await readFile(path,'utf8')),{cutoff:'2026-10-04T11:00:00Z'});
    assert.equal(replay.report.byPosition.WR[0].sleeperId,'x');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('replay checks nested source observation times and invalid scope', () => {
  assert.throws(()=>createDecisionSnapshot({...report,leagueId:null}),/scope/);
  const snapshot=createDecisionSnapshot({...report,byPosition:{WR:[{provenance:{fetchedAt:'2026-10-05T09:00:00Z'}}]}});
  assert.throws(()=>replayDecisionSnapshot(snapshot,{cutoff:'2026-10-04T11:00:00Z'}),/after replay cutoff/);
});

test('future transaction timestamps cannot enter a historical replay', () => {
  const snapshot=createDecisionSnapshot({...report,recentTransactions:[{status_updated:Date.parse('2026-10-05T09:00:00Z')}]});
  assert.throws(()=>replayDecisionSnapshot(snapshot,{cutoff:'2026-10-04T11:00:00Z'}),/after replay cutoff/);
});
