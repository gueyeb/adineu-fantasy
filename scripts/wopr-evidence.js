#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const definition='WOPR_1.5_TARGET_SHARE_0.7_AIR_YARDS_SHARE';
const formulaSource='https://nflfastr.com/reference/nfl_stats_variables.html';
const average=rows=>rows.length ? rows.reduce((sum,value)=>sum+value,0)/rows.length : null;
const sortedIds=rows=>[...rows].sort();
const stable=value=>Array.isArray(value) ? value.map(stable) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const tolerance=0.000001;

/** Numeric source gate. No OCR, no inferred player identities or routes. */
export function validateWoprEvidence(input,{asOf}={}) {
  const issues=[];
  const now=Date.parse(asOf);
  const fetched=Date.parse(input?.fetchedAt);
  const through=Date.parse(input?.period?.dataThrough);
  input ??= {};
  if (input?.version!==1 || [input.datasetId,input.datasetVersion,input.lineageId,input.source,input.numericSource].some(value=>typeof value!=='string' || !value.trim())) issues.push('NUMERIC_SOURCE_AND_VERSION_REQUIRED');
  if (!['JSON','CSV','PARQUET'].includes(input.sourceFormat)) issues.push('NUMERIC_SOURCE_FORMAT_REQUIRED');
  if (!Number.isFinite(now) || !Number.isFinite(fetched) || !Number.isFinite(through) || through>fetched || fetched>now) issues.push('INVALID_SOURCE_TIME');
  const weeks=input?.period?.weeks;
  if (!Number.isInteger(input?.period?.season) || (Number.isFinite(through) && (new Date(through).getUTCFullYear()<input.period.season || new Date(through).getUTCFullYear()>input.period.season+1)) || !Array.isArray(weeks) || !weeks.length || weeks.some(week=>!Number.isInteger(week) || week<1 || week>18) || new Set(weeks).size!==weeks.length || input.period.includesLiveGames!==false || input.period.seasonType!=='REGULAR') issues.push('DEFINED_COMPLETED_PERIOD_REQUIRED');
  if (input?.definition?.id!==definition || input?.definition?.aggregation!=='RATIO_OF_PERIOD_TOTALS' || input?.units?.points!=='PPR_PERIOD_TOTAL' || input?.units?.shares!=='RATIO' || input?.units?.airYards!=='YARDS') issues.push('UNSUPPORTED_DEFINITION_OR_UNITS');
  const universe=input?.universe;
  if (!['SLEEPER','GSIS'].includes(input?.idNamespace) || !Array.isArray(universe?.positions) || !universe.positions.length || universe.positions.some(position=>!['WR','RB','TE'].includes(position)) || !Number.isInteger(universe?.minimumTargets) || universe.minimumTargets<0 || universe.completenessConfirmed!==true || !Array.isArray(universe?.expectedPlayerIds)) issues.push('EXPLICIT_UNIVERSE_REQUIRED');
  const rows=Array.isArray(input?.rows) ? input.rows : [];
  if (!rows.length) issues.push('NUMERIC_ROWS_REQUIRED');
  const ids=new Set();
  const normalized=[];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {issues.push("INVALID_NUMERIC_ROW");continue;}
    const rowIssues=[];
    if (typeof row.playerId!=='string' || !row.playerId || ids.has(row.playerId)) rowIssues.push('INVALID_OR_DUPLICATE_PLAYER_ID');
    ids.add(row.playerId);
    if (!universe?.positions?.includes(row.position) || !Number.isInteger(row.targets) || row.targets<(universe?.minimumTargets ?? 0) || !Number.isInteger(row.teamTargets) || row.teamTargets<=0 || row.targets>row.teamTargets) rowIssues.push('TARGETS_OR_POSITION_OUTSIDE_UNIVERSE');
    if (!Number.isFinite(row.airYards) || !Number.isFinite(row.teamAirYards) || row.teamAirYards<=0 || !Number.isFinite(row.pprPoints)) rowIssues.push('MISSING_ABSOLUTE_VOLUME_OR_POINTS');
    // Air yards can be negative; the share and WOPR must not be silently clipped to [0,1].
    const targetShare=row.targets/row.teamTargets;
    const airYardsShare=row.airYards/row.teamAirYards;
    const computed=1.5*targetShare+0.7*airYardsShare;
    if (!Number.isFinite(row.targetShare) || !Number.isFinite(row.airYardsShare) || !Number.isFinite(row.wopr) || Math.abs(row.targetShare-targetShare)>tolerance || Math.abs(row.airYardsShare-airYardsShare)>tolerance || Math.abs(row.wopr-computed)>tolerance || !Number.isFinite(computed)) rowIssues.push('FORMULA_OR_SHARE_MISMATCH');
    if (row.routes !== null && (!Number.isInteger(row.routes) || row.routes<0 || !row.routesSource)) rowIssues.push('ROUTES_REQUIRE_OWN_SOURCE_OR_NULL');
    if (rowIssues.length) issues.push(...rowIssues.map(reason=>`${row.playerId ?? 'unknown'}:${reason}`));
    normalized.push({playerId:row.playerId,position:row.position,targets:row.targets,targetShare:row.targetShare,airYards:row.airYards,airYardsShare:row.airYardsShare,wopr:row.wopr,pprPoints:row.pprPoints,routes:row.routes ?? null,source:input.source});
  }
  const expected=universe?.expectedPlayerIds;
  if (Array.isArray(expected) && (expected.some(id=>typeof id!=='string' || !id) || new Set(expected).size!==expected.length || !same(sortedIds(expected),sortedIds(ids)))) issues.push('PLAYER_UNIVERSE_MISMATCH');
  const means={pprPoints:average(normalized.map(row=>row.pprPoints)),wopr:average(normalized.map(row=>row.wopr))};
  if (!Number.isFinite(input?.reportedMeans?.pprPoints) || !Number.isFinite(input?.reportedMeans?.wopr)) issues.push('REPORTED_MEANS_REQUIRED');
  else if (means.pprPoints===null || Math.abs(means.pprPoints-input.reportedMeans.pprPoints)>0.051 || Math.abs(means.wopr-input.reportedMeans.wopr)>0.0051) issues.push('REPORTED_MEANS_MISMATCH');
  return {valid:issues.length===0,ingestionStatus:issues.length ? 'HOLD' : input.isSynthetic===true ? 'SYNTHETIC_VALIDATION_ONLY' : 'NUMERIC_EVIDENCE_READY',issues,rows:issues.length ? [] : normalized,computedMeans:means,
    definition,formulaSource,idNamespace:input?.idNamespace ?? null,datasetId:input?.datasetId ?? null,datasetVersion:input?.datasetVersion ?? null,lineageId:input?.lineageId ?? null,
    contentHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),reboundProbability:null,xfpEquivalent:false,modelParametersChanged:false,modelIntegrationEnabled:false};
}

export function compareWoprEvidence(left,right,{asOf}={}) {
  left ??= {}; right ??= {};
  const a=validateWoprEvidence(left,{asOf}),b=validateWoprEvidence(right,{asOf});
  const differences=[];
  if (!same(left.period,right.period)) differences.push('PERIOD');
  if (!same(left.definition,right.definition) || !same(left.units,right.units)) differences.push('DEFINITION_OR_UNITS');
  if (left.idNamespace!==right.idNamespace || !same({...left.universe,positions:sortedIds(left.universe?.positions || []),expectedPlayerIds:sortedIds(left.universe?.expectedPlayerIds || [])},{...right.universe,positions:sortedIds(right.universe?.positions || []),expectedPlayerIds:sortedIds(right.universe?.expectedPlayerIds || [])})) differences.push('UNIVERSE');
  const leftIds=new Set((Array.isArray(left.rows) ? left.rows : []).filter(Boolean).map(row=>row.playerId)),rightIds=new Set((Array.isArray(right.rows) ? right.rows : []).filter(Boolean).map(row=>row.playerId));
  const onlyLeft=[...leftIds].filter(id=>!rightIds.has(id)),onlyRight=[...rightIds].filter(id=>!leftIds.has(id));
  if (onlyLeft.length || onlyRight.length) differences.push('PLAYER_MEMBERSHIP');
  if (!same(left.reportedMeans,right.reportedMeans)) differences.push('REPORTED_MEANS');
  if (left.datasetVersion!==right.datasetVersion) differences.push('DATASET_VERSION');
  if (!same([...a.rows].sort((a,b)=>a.playerId.localeCompare(b.playerId)),[...b.rows].sort((a,b)=>a.playerId.localeCompare(b.playerId)))) differences.push('NUMERIC_ROWS');
  return {left:a,right:b,compatible:a.valid && b.valid && differences.length===0,differences,onlyLeft,onlyRight,
    sameLineage:Boolean(left.lineageId && left.lineageId===right.lineageId),independentEvidenceCount:left.lineageId && left.lineageId===right.lineageId ? 1 : null,
    interpretation:'RELATIVE_OPPORTUNITY_NOT_A_REBOUND_GUARANTEE',ingestionStatus:a.valid && b.valid && !differences.length ? left.isSynthetic===true || right.isSynthetic===true ? 'SYNTHETIC_COMPARISON_ONLY' : 'COMPATIBLE_NUMERIC_EVIDENCE' : 'HOLD_FOR_RECONCILIATION'};
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,leftPath,rightOrAsOf,asOf]=process.argv.slice(2);
    const left=JSON.parse(await readFile(leftPath,'utf8'));
    if (command==='validate') { const result=validateWoprEvidence(left,{asOf:rightOrAsOf}); console.log(JSON.stringify(result,null,2)); if(!result.valid) process.exitCode=2; }
    else if (command==='compare') { const result=compareWoprEvidence(left,JSON.parse(await readFile(rightOrAsOf,'utf8')),{asOf}); console.log(JSON.stringify(result,null,2)); if(!result.compatible) process.exitCode=2; }
    else throw Error('Usage: wopr-evidence.js validate NUMERIC.json ISO_ASOF | compare LEFT.json RIGHT.json ISO_ASOF');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
