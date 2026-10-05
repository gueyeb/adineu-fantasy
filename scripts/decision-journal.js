#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { replayDecisionSnapshot } from './decision-snapshot.js';

export function createDecisionJournal(snapshot,{cutoff}={}) {
  replayDecisionSnapshot(snapshot,{cutoff});
  if (!Number.isFinite(Date.parse(snapshot.report.generatedAt))) throw Error("Journal requires recommendation generation time");
  return {version:1,snapshotHash:snapshot.reportHash,modelVersion:snapshot.modelFingerprint || snapshot.report.rankingModel || 'UNVERSIONED',decisionScope:snapshot.report.decisionScope ?? {leagueId:snapshot.report.leagueId,season:snapshot.report.season,targetWeek:snapshot.report.week,roster:snapshot.inputs?.team ?? null},
    recommendations:Object.values(snapshot.report.byPosition).flat().map(row=>({decisionId:`${snapshot.reportHash}:${snapshot.report.week}:${row.sleeperId}`,playerId:row.sleeperId,player:row.name,week:snapshot.report.week,
      emittedAt:snapshot.report.generatedAt,recommendedAction:row.waiver?.decision?.recommendedAction ?? 'UNKNOWN',decisionClass:row.waiver?.decision?.decisionClass ?? null,
      dropCandidate:row.waiver?.fit?.dropCandidate ?? null,recommendedFaab:row.waiver?.suggestedBid ?? null,modelMetrics:row.modelMetrics ?? null,
      pregame:Number.isFinite(Date.parse(row.availability?.kickoffAt)) ? Date.parse(snapshot.report.generatedAt)<Date.parse(row.availability.kickoffAt) : null,
      userDecision:null,reason:null,outcome2w:null,outcome4w:null}))};
}

export function validateJournalEvent(journal,event,{recordedAt=new Date().toISOString()}={}) {
  const recommendation=journal.recommendations.find(row=>row.decisionId===event.decisionId);
  if (!recommendation || journal.version !== 1) throw Error('Unknown journal decision');
  const recorded=Date.parse(recordedAt);
  if (!Number.isFinite(recorded) || recorded<Date.parse(recommendation.emittedAt)) throw Error('Event cannot precede recommendation');
  if (event.kind==='CHOICE') {
    if (!['ADD','CLAIM','SKIP','KEEP','WATCH','IGNORE'].includes(event.decision) || typeof event.reason !== 'string' || !event.reason.trim() || event.reason.length>1000) throw Error('Explicit decision and reason required');
    return {version:1,eventId:randomUUID(),decisionId:event.decisionId,kind:'CHOICE',recordedAt,decision:event.decision,reason:event.reason.trim()};
  }
  if (event.kind==='OUTCOME') {
    const outcome=event.outcome;
    if (outcome?.windowCompleted !== true || ![2,4].includes(outcome?.windowWeeks) || !Number.isInteger(outcome.throughWeek) || outcome.throughWeek<recommendation.week+outcome.windowWeeks-1 || !outcome.source || typeof outcome.summary !== 'string' || !outcome.summary.trim() || outcome.summary.length>2000 || !Number.isFinite(Date.parse(outcome.observedAt)) || Date.parse(outcome.observedAt)>recorded || Date.parse(outcome.observedAt)<=Date.parse(recommendation.emittedAt)) throw Error('Dated sourced outcome and completed window required');
    return {version:1,eventId:randomUUID(),decisionId:event.decisionId,kind:'OUTCOME',recordedAt,outcome:{windowCompleted:true,windowWeeks:outcome.windowWeeks,throughWeek:outcome.throughWeek,source:outcome.source,observedAt:outcome.observedAt,summary:outcome.summary.trim(),assessmentMethod:'EXPLICIT_OPERATOR_OBSERVATION'}};
  }
  throw Error('Unknown journal event kind');
}

export function materializeDecisionJournal(journal,events=[]) {
  const rows=structuredClone(journal.recommendations);
  const byId=new Map(rows.map(row=>[row.decisionId,row]));
  for (const event of [...events].sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId))) {
    validateJournalEvent(journal,event,{recordedAt:event.recordedAt});
    const row=byId.get(event.decisionId);
    if (!row) throw Error('Event does not belong to journal');
    if (event.kind==='CHOICE') {row.userDecision=event.decision;row.reason=event.reason;}
    else if (event.kind==='OUTCOME') row[event.outcome.windowWeeks===2?'outcome2w':'outcome4w']=event.outcome;
  }
  return {...journal,recommendations:rows,eventCount:events.length};
}

export async function initializeJournal(directory,journal) {
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory,'recommendations.json'),`${JSON.stringify(journal,null,2)}\n`,{flag:'wx',mode:0o600});
}
export async function appendJournalEvent(directory,event) {
  const journal=JSON.parse(await readFile(join(directory,'recommendations.json'),'utf8'));
  const validated=validateJournalEvent(journal,event);
  await writeFile(join(directory,`event-${validated.eventId}.json`),`${JSON.stringify(validated,null,2)}\n`,{flag:'wx',mode:0o600});
  return validated;
}
export async function readJournal(directory) {
  const journal=JSON.parse(await readFile(join(directory,'recommendations.json'),'utf8'));
  const files=(await readdir(directory)).filter(name=>/^event-[a-f0-9-]+\.json$/.test(name));
  const events=await Promise.all(files.map(async name=>JSON.parse(await readFile(join(directory,name),'utf8'))));
  return materializeDecisionJournal(journal,events);
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,input,output,cutoff]=process.argv.slice(2);
    if (command==='init' && input && output && cutoff) {
      const snapshot=JSON.parse(await readFile(input,'utf8'));
      const journal=createDecisionJournal(snapshot,{cutoff});
      await initializeJournal(output,journal);
      console.log(JSON.stringify({saved:output,recommendations:journal.recommendations.length}));
    } else if (command==='record' && input && output) {
      console.log(JSON.stringify(await appendJournalEvent(input,JSON.parse(await readFile(output,'utf8')))));
    } else if (command==='show' && input) console.log(JSON.stringify(await readJournal(input),null,2));
    else throw Error('Usage: decision-journal.js init SNAPSHOT DIR CUTOFF | record DIR EVENT.json | show DIR');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
