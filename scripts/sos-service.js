import { calculateWrSos, SOS_HORIZONS, SOS_METHODOLOGY_VERSION } from '../public/assets/wr-ros-sos.js';
import { loadSosSources, hashSos } from './sos-sources.js';

export function buildSosBundle(inputs) {
  const snapshotId = hashSos({ version: SOS_METHODOLOGY_VERSION, inputs: { ...inputs, dvp: { ...inputs.dvp, byDefense: [...inputs.dvp.byDefense] } } });
  const horizons = Object.fromEntries(SOS_HORIZONS.map(horizon => {
    const result = calculateWrSos({ ...inputs, horizon });
    return [horizon, { ...result, snapshotId, sources: { ...result.sources,
      schedule: { ...result.sources.schedule, inputHash: inputs.schedule.inputHash ?? hashSos(inputs.schedule.games) },
      dvp: { ...result.sources.dvp, inputHash: inputs.dvp.inputHash ?? hashSos([...inputs.dvp.byDefense]) } },
      warnings: [...result.warnings, ...(inputs.warnings ?? [])] }];
  }));
  return { snapshotId, asOf: inputs.asOf, season: inputs.season, week: inputs.week, methodologyVersion: SOS_METHODOLOGY_VERSION,
    horizons, inputs: { ...inputs, dvp: { ...inputs.dvp, byDefense: [...inputs.dvp.byDefense] } } };
}

export function createSosService({ load = loadSosSources, now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
  let cached; let expires = 0; let pending;
  return { async getBundle() {
    if (cached && now() < expires) return structuredClone(cached);
    if (!pending) pending = (async () => {
      const bundle = buildSosBundle(await load());
      const kickoff = bundle.inputs.schedule.games.map(g => Date.parse(g.kickoffAt)).filter(t => t > Date.parse(bundle.asOf));
      expires = Math.min(Date.parse(bundle.asOf) + ttlMs, ...kickoff);
      cached = bundle;
      return bundle;
    })().finally(() => { pending = null; });
    return structuredClone(await pending);
  } };
}
export const sosService = createSosService();

/** Offline reproduction uses archived inputs, including the original source times and cutoff. */
export function replaySosBundle(archive) {
  const inputs = { ...archive.inputs, dvp: { ...archive.inputs.dvp, byDefense: new Map(archive.inputs.dvp.byDefense) } };
  const recomputed = buildSosBundle(inputs);
  if (recomputed.snapshotId !== archive.snapshotId || hashSos(recomputed.horizons) !== hashSos(archive.horizons)) throw Error('SOS_REPLAY_MISMATCH');
  return { snapshotId: archive.snapshotId, reproduced: true, methodologyVersion: archive.methodologyVersion };
}
