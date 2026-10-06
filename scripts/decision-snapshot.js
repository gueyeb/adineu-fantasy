#!/usr/bin/env node
import { recomputeDecisionInputs } from './decision-recompute.js';
import { auditDecisionReport } from './decision-audit.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');
const fields = ['season', 'leagueId', 'week', 'lastCompletedWeek', 'generatedAt', 'availabilityAsOf', 'ownershipAsOf', 'transactionsFetchedAt', 'ownershipRechecked', 'snapshotSynchronized', 'transactionCoverage', 'snapshotIssues', 'recentTransactions', 'transactionsTruncatedCount', 'rankingModel', 'decisionScope', 'degraded', 'coverage', 'provenanceVersion', 'evaluatedCandidateCount', 'returnedCandidateCount', 'rosterProvenance', 'playerIndexProvenance', 'faabRemaining', 'byPosition', 'acquisitionPlan', 'rosterPreferences', 'poolCoverage', 'coherence'];

/** Frozen decision outputs only, not a training dataset or a new recommendation. */
export function createDecisionSnapshot(report, { recordedAt = new Date().toISOString(), inputs = null, modelFingerprint = null } = {}) {
  if (!report || !report.leagueId || !report.season || !Number.isInteger(report.week) || !Number.isFinite(Date.parse(report.availabilityAsOf)) || !report.byPosition) throw Error('Incomplete decision report scope');
  if (!Number.isFinite(Date.parse(recordedAt))) throw Error('Invalid recordedAt');
  const payload = JSON.parse(JSON.stringify(Object.fromEntries(fields.filter(key => report[key] !== undefined).map(key => [key, report[key]]))));
  if (inputs && (String(inputs.leagueId) !== String(report.leagueId) || String(inputs.season) !== String(report.season) || inputs.week !== report.week)) throw Error('Input/report scope mismatch');
  return { version:inputs ? 2 : 1, kind:'ADINEU_FROZEN_DECISION', recordedAt, reportHash:digest(payload), report:payload,
    ...(inputs ? { inputs:JSON.parse(JSON.stringify(inputs)), inputsHash:digest(inputs), modelFingerprint } : {}) };
}

function observationTimes(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'fetchedAtByPath') {
      for (const timestamp of Object.values(item || {})) {
        if (!Number.isFinite(Date.parse(timestamp))) throw Error('Invalid source cache time');
        found.push(Date.parse(timestamp));
      }
    } else if (['created','status_updated'].includes(key) && typeof item === 'number') {
      if (!Number.isFinite(item)) throw Error(`Invalid observation time: ${key}`);
      found.push(item);
    } else if (['capturedAt','asOf','playerIndexFetchedAt','createdAt','fetchedAt','observedAt','generatedAt','availabilityAsOf','ownershipAsOf','transactionsFetchedAt'].includes(key) && item !== null) {
      if (!Number.isFinite(Date.parse(item))) throw Error(`Invalid observation time: ${key}`);
      found.push(Date.parse(item));
    } else if (item && typeof item === 'object') observationTimes(item, found);
  }
  return found;
}

export function replayDecisionSnapshot(snapshot, { cutoff } = {}) {
  const asOf = Date.parse(cutoff);
  if (!Number.isFinite(asOf)) throw Error('Explicit valid replay cutoff required');
  if (![1,2].includes(snapshot?.version) || snapshot.kind !== 'ADINEU_FROZEN_DECISION' || digest(snapshot.report) !== snapshot.reportHash) throw Error('Invalid snapshot version or integrity');
  if (snapshot.version === 2 && digest(snapshot.inputs) !== snapshot.inputsHash) throw Error('Invalid input integrity');
  if ([...observationTimes(snapshot.report), ...observationTimes(snapshot.inputs)].some(time => time > asOf)) throw Error('Snapshot contains observations after replay cutoff');
  return { mode:'HISTORICAL_OUTPUT_REPLAY', executable:false, cutoff, reportHash:snapshot.reportHash, report:structuredClone(snapshot.report), audit:auditDecisionReport(snapshot.report) };
}

const modelFiles = ['public/assets/role-profile.js','public/assets/team-position-ripple.js','public/assets/decision-coherence.js','public/assets/team-metrics.js','public/assets/roster-preferences.js','scripts/decision-features.js','scripts/decision-provenance.js','public/assets/acquisition-availability.js','scripts/waiver-evaluator.js','scripts/decision-recompute.js','scripts/league-context.js','public/assets/waiver-model.js','public/assets/waiver-plan.js','public/assets/trade-score.js','public/assets/trade-value.js','public/assets/rest-of-season.js','public/assets/usage-score.js','public/assets/league-settings.js','public/assets/roster-view.js'];
export async function decisionModelFingerprint() {
  const hashes = await Promise.all(modelFiles.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')]));
  return digest(hashes);
}

export async function recomputeDecisionSnapshot(snapshot, { cutoff, allowModelChange = false } = {}) {
  replayDecisionSnapshot(snapshot, { cutoff });
  if (snapshot.version !== 2 || !snapshot.inputs || !snapshot.modelFingerprint) throw Error('Calculation inputs and model fingerprint required');
  const currentFingerprint = await decisionModelFingerprint();
  const sameModel = currentFingerprint === snapshot.modelFingerprint;
  if (!sameModel && !allowModelChange) throw Error('Model changed; explicit comparison mode required');
  const report = recomputeDecisionInputs(snapshot.inputs);
  // Coherence checks are derived from the board: archives written before them still compare on the board itself.
  const compared = value => ({ byPosition:value.byPosition, acquisitionPlan:value.acquisitionPlan, ...(snapshot.report.coherence ? { coherence:value.coherence } : {}) });
  const sameOutput = digest(compared(report)) === digest(compared(snapshot.report));
  return { mode:'OFFLINE_CALCULATION_REPLAY', executable:false, sameModel, sameOutput, currentFingerprint,
    snapshotFingerprint:snapshot.modelFingerprint, featureExtractionRecomputed:snapshot.inputs.version === 2, report };
}

export async function saveDecisionSnapshot(path, snapshot) {
  await mkdir(dirname(path), { recursive:true, mode:0o700 });
  // Never overwrite an existing historical observation.
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, { flag:'wx', mode:0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, input, outputOrCutoff] = process.argv.slice(2);
    if (command === 'capture' && input && outputOrCutoff) {
      const report = JSON.parse(await readFile(input, 'utf8'));
      const snapshot = createDecisionSnapshot(report);
      await saveDecisionSnapshot(outputOrCutoff, snapshot);
      console.log(JSON.stringify({ saved:outputOrCutoff, reportHash:snapshot.reportHash }));
    } else if (command === 'collect' && input && outputOrCutoff) {
      const { getFreeAgents } = await import('./league-context.js');
      let inputs;
      const report = await getFreeAgents({ team:input, onDecisionInputs:value=>{inputs=value;} });
      const snapshot = createDecisionSnapshot(report, { inputs, modelFingerprint:await decisionModelFingerprint() });
      await saveDecisionSnapshot(outputOrCutoff, snapshot);
      console.log(JSON.stringify({ saved:outputOrCutoff, version:snapshot.version, reportHash:snapshot.reportHash }));
    } else if (command === 'recompute' && input && outputOrCutoff) {
      console.log(JSON.stringify(await recomputeDecisionSnapshot(JSON.parse(await readFile(input, 'utf8')), { cutoff:outputOrCutoff }), null, 2));
    } else if (command === 'replay' && input && outputOrCutoff) {
      console.log(JSON.stringify(replayDecisionSnapshot(JSON.parse(await readFile(input, 'utf8')), { cutoff:outputOrCutoff }), null, 2));
    } else throw Error('Usage: decision-snapshot.js capture REPORT.json SNAPSHOT.json | replay SNAPSHOT.json ISO_CUTOFF | collect TEAM SNAPSHOT.json | recompute SNAPSHOT.json ISO_CUTOFF');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
