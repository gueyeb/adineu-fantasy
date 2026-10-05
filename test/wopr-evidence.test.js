import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWoprEvidence, compareWoprEvidence } from '../scripts/wopr-evidence.js';
const asOf='2026-10-04T10:00:00Z';
const row={playerId:'JSN-fixture',position:'WR',targets:20,teamTargets:100,airYards:200,teamAirYards:1000,targetShare:0.2,airYardsShare:0.2,wopr:0.44,pprPoints:40,routes:null};
const dataset={version:1,title:'2026 Weeks 1–3 WR Min 15 Tgt',datasetId:'fixture',datasetVersion:'v1',lineageId:'fixture-data',source:'fixture://provider',numericSource:'fixture://numeric-json',sourceFormat:'JSON',fetchedAt:'2026-10-04T09:00:00Z',period:{season:2026,seasonType:'REGULAR',weeks:[1,2,3],dataThrough:'2026-09-29T12:00:00Z',includesLiveGames:false},definition:{id:'WOPR_1.5_TARGET_SHARE_0.7_AIR_YARDS_SHARE',aggregation:'RATIO_OF_PERIOD_TOTALS'},units:{points:'PPR_PERIOD_TOTAL',shares:'RATIO',airYards:'YARDS'},idNamespace:'SLEEPER',universe:{positions:['WR'],minimumTargets:15,completenessConfirmed:true,expectedPlayerIds:['JSN-fixture']},reportedMeans:{pprPoints:40,wopr:0.44},rows:[row]};
test('numeric WOPR requires explicit universe, formula, absolute volume and missing routes',()=>{
  const result=validateWoprEvidence(dataset,{asOf});
  assert.equal(result.valid,true);
  assert.equal(result.rows[0].routes,null);
  assert.equal(result.xfpEquivalent,false);
  assert.equal(result.reboundProbability,null);
  assert.equal(result.modelParametersChanged,false);
});
test('same title does not reconcile missing JSN or changed means',()=>{
  const other=structuredClone(dataset);other.rows=[];other.reportedMeans={pprPoints:38.7,wopr:0.58};
  const result=compareWoprEvidence(dataset,other,{asOf});
  assert.equal(result.compatible,false);
  assert.deepEqual(result.onlyLeft,['JSN-fixture']);
  assert.ok(result.differences.includes('REPORTED_MEANS'));
  assert.equal(result.independentEvidenceCount,1);
});
test('percent shares, fabricated routes and rounded OCR numbers fail closed',()=>{
  const other=structuredClone(dataset);other.rows[0].targetShare=20;other.rows[0].routes=60;
  const result=validateWoprEvidence(other,{asOf});
  assert.equal(result.valid,false);assert.deepEqual(result.rows,[]);
  assert.ok(result.issues.some(reason=>reason.includes('FORMULA_OR_SHARE_MISMATCH')));
  assert.ok(result.issues.some(reason=>reason.includes('ROUTES_REQUIRE')));
});
test('image-only source, future observations, live weeks and incomplete universes cannot ingest',()=>{
  for (const modified of [{...dataset,numericSource:null},{...dataset,fetchedAt:'2026-10-05T09:00:00Z'},{...dataset,period:{...dataset.period,includesLiveGames:true}},{...dataset,universe:{...dataset.universe,expectedPlayerIds:['other']}}]) assert.equal(validateWoprEvidence(modified,{asOf}).valid,false);
});
test('negative air yards and zero production are valid numerical opportunity evidence',()=>{
  const other=structuredClone(dataset);Object.assign(other.rows[0],{airYards:-100,airYardsShare:-0.1,wopr:0.23,pprPoints:0});other.reportedMeans={pprPoints:0,wopr:0.23};
  assert.equal(validateWoprEvidence(other,{asOf}).valid,true);
});
test('same dataset is one lineage and object-key ordering is not a new version',()=>{
  const other=structuredClone(dataset);other.units={airYards:'YARDS',shares:'RATIO',points:'PPR_PERIOD_TOTAL'};
  const result=compareWoprEvidence(dataset,other,{asOf});
  assert.equal(result.compatible,true);assert.equal(result.independentEvidenceCount,1);
  assert.equal(validateWoprEvidence(null,{asOf}).valid,false);
  assert.equal(validateWoprEvidence({...dataset,rows:[null]},{asOf}).valid,false);
});

test('validation CLI preserves numeric source and holds incompatible input with nonzero status',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const dir=await mkdtemp(join(tmpdir(),'adineu-wopr-'));
  try {const path=join(dir,'numeric.json');await writeFile(path,JSON.stringify(dataset));const {stdout}=await promisify(execFile)(process.execPath,['scripts/wopr-evidence.js','validate',path,asOf]);assert.equal(JSON.parse(stdout).valid,true);await writeFile(path,JSON.stringify({...dataset,sourceFormat:'IMAGE'}));await assert.rejects(promisify(execFile)(process.execPath,['scripts/wopr-evidence.js','validate',path,asOf]),{code:2});} finally {await rm(dir,{recursive:true,force:true});}
});
