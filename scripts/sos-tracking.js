#!/usr/bin/env node
/** Called by the existing Tuesday job; can also run independently through NFL W18. */
import { pathToFileURL } from 'node:url';
import { sosService, replaySosBundle } from './sos-service.js';
import { sosStore } from './sos-store.js';
import { evaluateSos } from './sos-feedback.js';
async function trackPosition({ service = sosService, store = sosStore, dryRun = false, position = 'WR' } = {}) {
  const bundle = await service.getBundle(position);
  if (bundle.methodologyVersion !== `${position}_TEMPORAL_V1`) return { skipped: 'POSITION_UNAVAILABLE' };
  if (dryRun) return { dryRun: true, snapshotId: bundle.snapshotId, rankedTeams: bundle.horizons.FANTASY_ROS.rankedTeams };
  const evaluations = [];
  for (const archive of await store.list(position)) {
    const historical = await store.load(archive.snapshotId);
    if (historical.methodologyVersion !== bundle.methodologyVersion) continue;
    const result = evaluateSos(historical, bundle.inputs.dvp.observations, bundle.asOf);
    const revision = await store.saveEvaluation(archive.snapshotId, result);
    evaluations.push({ snapshotId: archive.snapshotId, revision, sample: result.sample, mae: result.mae, baselineMae: result.baselineMae });
  }
  if (bundle.week > 18) return { skipped: 'NO_REMAINING_REGULAR_SEASON_GAMES', evaluations };
  return { ...await store.save(bundle), evaluations };
}
export async function trackSos(options = {}) {
  const results = {};
  for (const position of ['WR', 'RB']) {
    try { results[position] = await trackPosition({ ...options, position }); }
    catch (error) { results[position] = { error: error.message }; }
  }
  return { ...results.WR, positions: results };
}
/** One Tuesday-message line per position: archived forecasts vs the league-average baseline. */
export function formatSosLines(sos) {
  return Object.entries(sos?.positions ?? {}).flatMap(([position, result]) => {
    const rows = (result?.evaluations ?? []).filter(row => row.sample > 0 && Number.isFinite(row.mae) && Number.isFinite(row.baselineMae));
    const n = rows.reduce((sum, row) => sum + row.sample, 0);
    if (!n) return [`SOS ${position} : aucune prévision évaluée (n=0).`];
    const weighted = key => rows.reduce((sum, row) => sum + row[key] * row.sample, 0) / n;
    const mae = weighted('mae'), base = weighted('baselineMae');
    return [`SOS ${position} : ${n} prévisions · MAE ${mae.toFixed(1)} vs ${base.toFixed(1)} (moyenne ligue) · skill ${base > 0 ? `${Math.round((1 - mae / base) * 100)} %` : 'n/d'}`];
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const replay = process.argv.indexOf('--replay');
  const work = replay >= 0 ? sosStore.load(process.argv[replay + 1]).then(bundle => { if (!bundle) throw Error('SNAPSHOT_NOT_FOUND'); return replaySosBundle(bundle); })
    : trackSos({ dryRun: process.argv.includes('--dry-run') });
  work.then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
