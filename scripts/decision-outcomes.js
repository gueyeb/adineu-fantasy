#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { replayDecisionSnapshot } from './decision-snapshot.js';

const mean = values => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
const median = values => {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;
};
const summarizeErrors = rows => ({ n:rows.length, mae:mean(rows.map(row=>Math.abs(row.error))), bias:mean(rows.map(row=>row.error)) });

/** Retrospective evaluation only. Outcomes never enter the archived calculation inputs. */
export function evaluateDecisionOutcomes(snapshot, outcomes, { decisionCutoff, evaluatedAt, minimumCalibrationSample = 20 } = {}) {
  replayDecisionSnapshot(snapshot,{cutoff:decisionCutoff});
  const evaluationTime=Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationTime) || evaluationTime < Date.parse(decisionCutoff)) throw Error('Valid evaluatedAt after decision cutoff required');
  const report=snapshot.report;
  if (outcomes?.version !== 1 || outcomes.snapshotHash !== snapshot.reportHash || String(outcomes.leagueId) !== String(report.leagueId) || String(outcomes.season) !== String(report.season)) throw Error('Outcome/snapshot scope mismatch');
  if (!Array.isArray(outcomes.observations)) throw Error('Outcome observations array required');
  if (!Number.isInteger(minimumCalibrationSample) || minimumCalibrationSample < 1) throw Error('Invalid minimum calibration sample');
  const candidates=Object.values(report.byPosition || {}).flat();
  const byId=new Map(candidates.map(row=>[String(row.sleeperId),row]));
  const exclusions=[];
  const seen=new Map();
  const conflicts=new Set();
  const observations=[];
  for (const row of outcomes.observations || []) {
    const reasons=[];
    const observed=Date.parse(row.observedAt);
    if (!row.source || !Number.isFinite(observed) || observed > evaluationTime) reasons.push('MISSING_SOURCE_OR_INVALID_OBSERVATION_TIME');
    if (observed <= Date.parse(decisionCutoff)) reasons.push('NOT_A_POST_DECISION_OBSERVATION');
    if (!['ACTUAL_POINTS','WINNING_CLAIM','ACTION_CHECK'].includes(row.kind) || typeof row.playerId !== 'string') reasons.push('INVALID_OBSERVATION_KIND_OR_PLAYER');
    let eventTime;
    if (row.kind === 'ACTUAL_POINTS') {
      const kickoff=Date.parse(row.kickoffAt);
      eventTime=Date.parse(row.finishedAt);
      if (row.unit !== 'PPR_POINTS' || row.gameCompleted !== true || !Number.isFinite(row.points) || !Number.isInteger(row.week) || row.week < report.week || !Number.isFinite(kickoff) || !Number.isFinite(eventTime) || !(Date.parse(decisionCutoff) < kickoff && kickoff < eventTime)) reasons.push('NONFINAL_OR_NONPREGAME_POINTS');
    } else if (row.kind === 'WINNING_CLAIM') {
      eventTime=Date.parse(row.processedAt);
      if (row.status !== 'complete' || !row.transactionId || !Number.isInteger(row.bid) || row.bid < 0 || row.week !== report.week) reasons.push('INVALID_WINNING_CLAIM');
    } else {
      eventTime=Date.parse(row.checkedAt);
      if (typeof row.executable !== 'boolean') reasons.push('UNCONFIRMED_OPERATIONAL_VALIDITY');
    }
    if (!Number.isFinite(eventTime) || eventTime <= Date.parse(decisionCutoff) || eventTime > observed) reasons.push('INVALID_POST_DECISION_EVENT_TIME');
    if (reasons.length) { exclusions.push({playerId:row.playerId,kind:row.kind,reasons}); continue; }
    const key=row.kind === 'ACTUAL_POINTS' ? `${row.kind}:${row.playerId}:${row.week}` : row.kind === 'WINNING_CLAIM' ? `${row.kind}:${row.transactionId}:${row.playerId}` : `${row.kind}:${row.playerId}:${row.checkedAt}`;
    // Duplicate sources do not increase sample size. Conflicting observations require resolution.
    const signature=JSON.stringify(row.kind === 'ACTUAL_POINTS' ? [row.points,row.kickoffAt,row.finishedAt] : row.kind === 'WINNING_CLAIM' ? [row.bid,row.processedAt] : [row.executable,row.checkedAt]);
    if (seen.has(key)) {
      if (seen.get(key) !== signature) { conflicts.add(key); exclusions.push({playerId:row.playerId,kind:row.kind,reasons:['CONFLICTING_OBSERVATIONS']}); }
      continue;
    }
    seen.set(key,signature);
    observations.push({key,row});
  }
  const valid=observations.filter(({key})=>!conflicts.has(key)).map(({row})=>row);
  const projectionRows=[];
  const claimRows=[];
  const actionRows=[];
  for (const row of valid) {
    const candidate=byId.get(row.playerId);
    if (row.kind === 'ACTUAL_POINTS') {
      const predicted=snapshot.inputs?.raw?.projectionsByWeek?.[row.week]?.[row.playerId]?.pts_ppr;
      const fetchedAt=snapshot.inputs?.raw?.fetchedAtByPath?.[`/projections/nfl/regular/${report.season}/${row.week}`];
      if (!Number.isFinite(predicted) || !Number.isFinite(Date.parse(fetchedAt)) || !(Date.parse(fetchedAt) < Date.parse(row.kickoffAt))) {
        exclusions.push({playerId:row.playerId,kind:row.kind,reasons:['NO_DATED_PREGAME_PROJECTION']}); continue;
      }
      projectionRows.push({source:row.source,observedAt:row.observedAt,finishedAt:row.finishedAt,playerId:row.playerId,week:row.week,horizonWeeks:row.week-report.week,predicted,actual:row.points,error:predicted-row.points});
    } else if (row.kind === 'WINNING_CLAIM') {
      const range=candidate?.waiver?.faabMarket;
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0]<0 || range[1]<range[0]) {
        exclusions.push({playerId:row.playerId,kind:row.kind,reasons:['NO_VALID_MARKET_ESTIMATE']}); continue;
      }
      claimRows.push({source:row.source,observedAt:row.observedAt,transactionId:row.transactionId,processedAt:row.processedAt,playerId:row.playerId,position:candidate.position,duration:candidate.waiver.duration || 'NONE',bid:row.bid,range,
        inRange:row.bid>=range[0] && row.bid<=range[1],midpointError:(range[0]+range[1])/2-row.bid});
    } else {
      if (!['ADD_NOW','CLAIM_IF_CHEAP'].includes(candidate?.waiver?.decision?.recommendedAction)) {
        exclusions.push({playerId:row.playerId,kind:row.kind,reasons:['NO_ACTIONABLE_RECOMMENDATION']}); continue;
      }
      actionRows.push({source:row.source,observedAt:row.observedAt,playerId:row.playerId,checkedAt:row.checkedAt,executable:row.executable,reason:row.reason ?? null});
    }
  }
  const finalPoints=valid.filter(row=>row.kind==='ACTUAL_POINTS');
  const recommendationOutcomes=candidates.map(candidate=>({playerId:candidate.sleeperId,recommendedAction:candidate.waiver?.decision?.recommendedAction ?? 'UNKNOWN',
    roleProfile:candidate.roleProfile?.profile ?? candidate.waiver?.roleProfile?.profile ?? 'NONE',
    windows:[2,4].map(windowWeeks=>{
      const points=finalPoints.filter(row=>row.playerId===candidate.sleeperId && row.week>=report.week && row.week<report.week+windowWeeks);
      return {windowWeeks,expectedWeeks:windowWeeks,observedWeeks:points.length,complete:points.length===windowWeeks,
        pointsTotal:points.length ? points.reduce((sum,row)=>sum+row.points,0) : null,
        assessment:'DESCRIPTIVE_NOT_TRANSACTION_REGRET',observations:points.map(row=>({week:row.week,points:row.points,source:row.source,observedAt:row.observedAt}))};
    })}));
  // Role profiles against 2/4-week outcomes, WATCH/IGNORE included. Descriptive only: it defines
  // no weight or threshold; those follow once a profile reaches the minimum sample.
  const dated=(playerId,week)=>projectionRows.find(row=>row.playerId===playerId && row.week===week)?.predicted ?? null;
  const roleProfileEvaluation=[...new Set(recommendationOutcomes.map(row=>row.roleProfile))].sort().flatMap(roleProfile=>[2,4].map(windowWeeks=>{
    const group=recommendationOutcomes.filter(row=>row.roleProfile===roleProfile);
    const complete=group.map(row=>({row,window:row.windows.find(window=>window.windowWeeks===windowWeeks)})).filter(({window})=>window.complete);
    const projected=complete.map(({row,window})=>window.observations.map(obs=>dated(row.playerId,obs.week)));
    const comparable=complete.filter((_,i)=>projected[i].every(Number.isFinite));
    const actions={};
    for (const {row} of complete) actions[row.recommendedAction]=(actions[row.recommendedAction] || 0)+1;
    return {roleProfile,windowWeeks,candidates:group.length,completeWindows:complete.length,
      meanActualPointsPerWeek:mean(complete.map(({window})=>window.pointsTotal/windowWeeks)),
      meanProjectedPointsPerWeek:comparable.length ? mean(comparable.map(({row,window})=>window.observations.reduce((sum,obs)=>sum+dated(row.playerId,obs.week),0)/windowWeeks)) : null,
      comparableWindows:comparable.length,byRecommendedAction:actions,
      sampleStatus:complete.length>=minimumCalibrationSample ? 'DESCRIPTIVE_SAMPLE_AVAILABLE' : 'INSUFFICIENT_SAMPLE'};
  }));
  const horizons=[...new Set(projectionRows.map(row=>row.horizonWeeks))].sort((a,b)=>a-b).map(horizonWeeks=>({horizonWeeks,...summarizeErrors(projectionRows.filter(row=>row.horizonWeeks===horizonWeeks))}));
  const groups=[...new Set(claimRows.map(row=>`${row.position}:${row.duration}`))].map(key=>{
    const group=claimRows.filter(row=>`${row.position}:${row.duration}`===key);
    return {group:key,n:group.length,inRangeRate:mean(group.map(row=>Number(row.inRange))),medianWinningBid:median(group.map(row=>row.bid)),midpointMae:mean(group.map(row=>Math.abs(row.midpointError))),
      sampleStatus:group.length>=minimumCalibrationSample ? 'DESCRIPTIVE_SAMPLE_AVAILABLE' : 'INSUFFICIENT_SAMPLE'};
  });
  return { mode:'RETROSPECTIVE_EVALUATION',snapshotHash:snapshot.reportHash,decisionCutoff,evaluatedAt,executable:false,
    projectionAccuracy:{...summarizeErrors(projectionRows),byHorizon:horizons,rows:projectionRows,metric:'SLEEPER_RAW_PPR_PROJECTION',errorDefinition:'PREDICTED_MINUS_ACTUAL',sampleUniverse:'MATCHED_DATED_PROJECTIONS_WITH_FINAL_OBSERVATIONS'},
    operational:{observedChecks:actionRows.length,invalidChecks:actionRows.filter(row=>!row.executable).length,validityRate:mean(actionRows.map(row=>Number(row.executable))),rows:actionRows},
    faab:{observedWinningClaims:claimRows.length,groups,rows:claimRows,minimumCalibrationSample,selectionBias:'WINNING_BIDS_ONLY',sampleUniverse:'RETURNED_CANDIDATES_WITH_MATCHED_WINNING_CLAIMS',auctionWinProbability:null,parametersChanged:false},
    recommendationOutcomes, roleProfileEvaluation:{rows:roleProfileEvaluation,minimumCalibrationSample,weightsDefined:false,thresholdsCalibrated:false,
      sampleUniverse:'RETURNED_CANDIDATES_WITH_COMPLETE_FINAL_WINDOWS',assessment:'DESCRIPTIVE_NOT_TRANSACTION_REGRET'}, exclusions,cutRegret:null,falseRoleAlertRate:null,calibrationApplied:false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [snapshotPath,outcomesPath,decisionCutoff,evaluatedAt]=process.argv.slice(2);
    if (!snapshotPath || !outcomesPath || !decisionCutoff || !evaluatedAt) throw Error('Usage: decision-outcomes.js SNAPSHOT.json OUTCOMES.json DECISION_CUTOFF EVALUATED_AT');
    const [snapshot,outcomes]=await Promise.all([snapshotPath,outcomesPath].map(async path=>JSON.parse(await readFile(path,'utf8'))));
    console.log(JSON.stringify(evaluateDecisionOutcomes(snapshot,outcomes,{decisionCutoff,evaluatedAt}),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
