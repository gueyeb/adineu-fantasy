#!/usr/bin/env node
/** Called by the existing Tuesday job; can also run independently through NFL W18. */
import { pathToFileURL } from 'node:url';
import { sosService } from './sos-service.js';
import { sosStore } from './sos-store.js';
import { evaluateSos } from './sos-feedback.js';
export async function trackSos({ service = sosService, store = sosStore, dryRun = false } = {}) {
  const bundle = await service.getBundle();
  if (dryRun) return { dryRun: true, snapshotId: bundle.snapshotId, rankedTeams: bundle.horizons.FANTASY_ROS.rankedTeams };
  const evaluations = [];
  for (const archive of await store.list()) {
    const historical = await store.load(archive.snapshotId);
    const result = evaluateSos(historical, bundle.inputs.dvp.observations, bundle.asOf);
    evaluations.push(await store.saveEvaluation(archive.snapshotId, result));
  }
  return { ...await store.save(bundle), evaluations };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  trackSos({ dryRun: process.argv.includes('--dry-run') }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
