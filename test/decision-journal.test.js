import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecisionSnapshot} from '../scripts/decision-snapshot.js';
import {createDecisionJournal,validateJournalEvent,materializeDecisionJournal,initializeJournal,appendJournalEvent,readJournal} from '../scripts/decision-journal.js';
const snapshot=createDecisionSnapshot({leagueId:'fixture',season:'2026',week:4,generatedAt:'2026-10-04T10:00:00Z',availabilityAsOf:'2026-10-04T10:00:00Z',byPosition:{WR:['WATCH','IGNORE'].map((action,i)=>({sleeperId:`x${i}`,name:`Fixture ${i}`,availability:{kickoffAt:'2026-10-04T17:00:00Z'},waiver:{decision:{recommendedAction:action}}}))}});
const journal=createDecisionJournal(snapshot,{cutoff:'2026-10-04T11:00:00Z'});
test('journal retains WATCH and IGNORE and never invents user choice or outcome',()=>{
  assert.equal(journal.recommendations.length,2);
  assert.equal(journal.recommendations[1].recommendedAction,'IGNORE');
  assert.equal(journal.recommendations[0].pregame,true);
  assert.equal(journal.recommendations[0].userDecision,null);
  assert.equal(journal.recommendations[0].outcome2w,null);
});
test('explicit choices and sourced windows are separate immutable events',()=>{
  const id=journal.recommendations[0].decisionId;
  const choice=validateJournalEvent(journal,{decisionId:id,kind:'CHOICE',decision:'SKIP',reason:'Opportunity cost'},{recordedAt:'2026-10-04T12:00:00Z'});
  const result=materializeDecisionJournal(journal,[choice]);
  assert.equal(result.recommendations[0].userDecision,'SKIP');
  assert.equal(journal.recommendations[0].userDecision,null);
  assert.throws(()=>validateJournalEvent(journal,{decisionId:id,kind:'OUTCOME',outcome:{windowCompleted:true,windowWeeks:2,throughWeek:4,source:'fixture://result',summary:'Incomplete',observedAt:'2026-10-05T12:00:00Z'}},{recordedAt:'2026-10-06T12:00:00Z'}),/completed window/);
  const outcome=validateJournalEvent(journal,{decisionId:id,kind:'OUTCOME',outcome:{windowCompleted:true,windowWeeks:2,throughWeek:5,source:'fixture://result',summary:'Role unchanged',observedAt:'2026-10-13T12:00:00Z'}},{recordedAt:'2026-10-14T12:00:00Z'});
  assert.equal(materializeDecisionJournal(journal,[outcome]).recommendations[0].outcome2w.summary,'Role unchanged');
});
test('journal persistence never overwrites recommendations and accepts explicit choices',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'adineu-journal-'));
  try {await initializeJournal(dir,journal);await assert.rejects(initializeJournal(dir,journal),{code:'EEXIST'});await appendJournalEvent(dir,{decisionId:journal.recommendations[1].decisionId,kind:'CHOICE',decision:'IGNORE',reason:'Fixture explicit choice'});assert.equal((await readJournal(dir)).recommendations[1].userDecision,'IGNORE');} finally {await rm(dir,{recursive:true,force:true});}
});
