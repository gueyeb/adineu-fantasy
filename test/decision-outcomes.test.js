import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionSnapshot } from '../scripts/decision-snapshot.js';
import { evaluateDecisionOutcomes } from '../scripts/decision-outcomes.js';
const report={leagueId:'fixture',season:'2026',week:4,generatedAt:'2026-10-04T10:00:00Z',availabilityAsOf:'2026-10-04T10:00:00Z',byPosition:{WR:[{sleeperId:'x',position:'WR',waiver:{faabMarket:[10,20],duration:'RENTAL_1W',decision:{recommendedAction:'ADD_NOW'}}}]}};
const inputs={version:1,leagueId:'fixture',season:'2026',week:4,raw:{projectionsByWeek:{4:{x:{pts_ppr:10}}},fetchedAtByPath:{'/projections/nfl/regular/2026/4':'2026-10-04T09:00:00Z'}}};
const snapshot=createDecisionSnapshot(report,{inputs});
const options={decisionCutoff:'2026-10-04T10:01:00Z',evaluatedAt:'2026-10-06T12:00:00Z'};
const actual={kind:'ACTUAL_POINTS',playerId:'x',source:'fixture://final-game',observedAt:'2026-10-04T21:00:00Z',kickoffAt:'2026-10-04T17:00:00Z',finishedAt:'2026-10-04T20:00:00Z',week:4,gameCompleted:true,points:0,unit:'PPR_POINTS'};
const claim={kind:'WINNING_CLAIM',playerId:'x',source:'fixture://transaction',observedAt:'2026-10-04T16:00:00Z',processedAt:'2026-10-04T15:00:00Z',week:4,bid:30,transactionId:'t1',status:'complete'};
const check={kind:'ACTION_CHECK',playerId:'x',source:'fixture://availability',observedAt:'2026-10-04T12:01:00Z',checkedAt:'2026-10-04T12:00:00Z',executable:false,reason:'Taken by another roster'};
const outcomes=observations=>({version:1,leagueId:'fixture',season:'2026',snapshotHash:snapshot.reportHash,observations});
test('retrospective evaluation separates action validity, projection error and market bidding',()=>{
  const before=JSON.stringify(snapshot);
  const result=evaluateDecisionOutcomes(snapshot,outcomes([actual,claim,check]),options);
  assert.equal(result.projectionAccuracy.n,1);
  assert.equal(result.projectionAccuracy.mae,10);
  assert.equal(result.projectionAccuracy.bias,10);
  assert.equal(result.operational.validityRate,0);
  assert.equal(result.faab.groups[0].inRangeRate,0);
  assert.equal(result.faab.groups[0].sampleStatus,'INSUFFICIENT_SAMPLE');
  assert.equal(result.faab.parametersChanged,false);
  assert.equal(result.faab.auctionWinProbability,null);
  assert.equal(result.cutRegret,null);
  assert.equal(JSON.stringify(snapshot),before);
});
test('duplicates never inflate samples; conflicting observations are excluded',()=>{
  const duplicate=evaluateDecisionOutcomes(snapshot,outcomes([actual,{...actual,source:'fixture://second-source'}]),options);
  assert.equal(duplicate.projectionAccuracy.n,1);
  const conflict=evaluateDecisionOutcomes(snapshot,outcomes([actual,{...actual,points:2}]),options);
  assert.equal(conflict.projectionAccuracy.n,0);
  assert.equal(conflict.projectionAccuracy.mae,null);
  assert.ok(conflict.exclusions.some(row=>row.reasons.includes('CONFLICTING_OBSERVATIONS')));
});
test('partial games, future observations, missing values and earlier events cannot calibrate',()=>{
  const result=evaluateDecisionOutcomes(snapshot,outcomes([{...actual,gameCompleted:false},{...actual,observedAt:'2026-10-10T21:00:00Z'},{...actual,points:null},{...claim,processedAt:'2026-10-04T09:00:00Z'}]),options);
  assert.equal(result.projectionAccuracy.n,0);
  assert.equal(result.faab.observedWinningClaims,0);
  assert.equal(result.exclusions.length,4);
});
test('a different league, snapshot binding or evaluation before cutoff is rejected',()=>{
  assert.throws(()=>evaluateDecisionOutcomes(snapshot,{...outcomes([]),snapshotHash:'different'},options),/scope/);
  assert.throws(()=>evaluateDecisionOutcomes(snapshot,{...outcomes([]),leagueId:'other'},options),/scope/);
  assert.throws(()=>evaluateDecisionOutcomes(snapshot,outcomes([]),{...options,evaluatedAt:'2026-10-04T09:00:00Z'}),/evaluatedAt/);
});
test('empty observations yield unknown metrics and no empirical calibration',()=>{
  const result=evaluateDecisionOutcomes(snapshot,outcomes([]),options);
  assert.equal(result.operational.validityRate,null);
  assert.equal(result.projectionAccuracy.mae,null);
  assert.deepEqual(result.faab.groups,[]);
  assert.equal(result.calibrationApplied,false);
});

test('local outcome files evaluate through the CLI without changing the snapshot',async()=>{
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const dir=await mkdtemp(join(tmpdir(),'adineu-outcomes-'));
  try {
    const snapshotPath=join(dir,'snapshot.json');
    const outcomesPath=join(dir,'outcomes.json');
    const original=JSON.stringify(snapshot);
    await writeFile(snapshotPath,original);
    await writeFile(outcomesPath,JSON.stringify(outcomes([actual,claim,check])));
    const {stdout}=await promisify(execFile)(process.execPath,['scripts/decision-outcomes.js',snapshotPath,outcomesPath,options.decisionCutoff,options.evaluatedAt]);
    const result=JSON.parse(stdout);
    assert.equal(result.projectionAccuracy.mae,10);
    assert.equal(result.operational.invalidChecks,1);
    assert.equal(await readFile(snapshotPath,'utf8'),original);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('WATCH and IGNORE observations receive descriptive windows even without acquisition',()=>{
  const ignoredSnapshot=createDecisionSnapshot({...report,byPosition:{WR:[{...report.byPosition.WR[0],waiver:{...report.byPosition.WR[0].waiver,decision:{recommendedAction:'IGNORE'}}}]}},{inputs});
  const result=evaluateDecisionOutcomes(ignoredSnapshot,{...outcomes([actual]),snapshotHash:ignoredSnapshot.reportHash},options);
  assert.equal(result.recommendationOutcomes[0].recommendedAction,'IGNORE');
  assert.equal(result.recommendationOutcomes[0].windows[0].observedWeeks,1);
  assert.equal(result.recommendationOutcomes[0].windows[0].complete,false);
  assert.equal(result.recommendationOutcomes[0].windows[0].pointsTotal,0);
});
