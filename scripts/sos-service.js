import { calculatePositionSos, SOS_HORIZONS, sosMethodology, sosPosition } from '../public/assets/wr-ros-sos.js';
import { loadSosSources, hashSos } from './sos-sources.js';

export function buildSosBundle(inputs, position = sosPosition(inputs)) {
  const version = sosMethodology(position);
  const snapshotId = hashSos({ version, inputs: { ...inputs, dvp: { ...inputs.dvp, byDefense: [...inputs.dvp.byDefense] } } });
  const horizons = Object.fromEntries(SOS_HORIZONS.map(horizon => {
    const result = calculatePositionSos({ ...inputs, position, horizon });
    return [horizon, { ...result, snapshotId, sources: { ...result.sources,
      schedule: { ...result.sources.schedule, inputHash: inputs.schedule.inputHash ?? hashSos(inputs.schedule.games) },
      dvp: { ...result.sources.dvp, inputHash: inputs.dvp.inputHash ?? hashSos([...inputs.dvp.byDefense]) } },
      warnings: [...result.warnings, ...(inputs.warnings ?? [])] }];
  }));
  return { snapshotId, asOf: inputs.asOf, season: inputs.season, week: inputs.week, methodologyVersion: version,
    horizons, inputs: { ...inputs, dvp: { ...inputs.dvp, byDefense: [...inputs.dvp.byDefense] } } };
}

export function createSosService({ load = loadSosSources, now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
  let cached; let expires = 0; let pending;
  const build = position => {
    const inputs = structuredClone(cached.inputs);
    if (position === 'RB') {
      if (!cached.rbDvp) throw Error('RB_DVP_UNAVAILABLE');
      inputs.dvp = structuredClone(cached.rbDvp);
      inputs.warnings = structuredClone(cached.rbWarnings ?? inputs.warnings);
    }
    return buildSosBundle(inputs, position);
  };
  return { async getBundle(position = 'WR') {
    sosMethodology(position);
    if (cached && now() < expires) return build(position);
    if (!pending) pending = (async () => {
      const { rbDvp, rbWarnings, ...inputs } = await load();
      const bundle = { inputs, rbDvp, rbWarnings };
      const kickoff = bundle.inputs.schedule.games.map(g => Date.parse(g.kickoffAt)).filter(t => t > Date.parse(bundle.inputs.asOf));
      expires = Math.min(Date.parse(bundle.inputs.asOf) + ttlMs, ...kickoff);
      cached = bundle;
      return bundle;
    })().finally(() => { pending = null; });
    await pending;
    return build(position);
  } };
}
export const sosService = createSosService();

/** Offline reproduction uses archived inputs, including the original source times and cutoff. */
export function replaySosBundle(archive) {
  const inputs = { ...archive.inputs, dvp: { ...archive.inputs.dvp, byDefense: new Map(archive.inputs.dvp.byDefense) } };
  const recomputed = buildSosBundle(inputs, sosPosition(archive));
  if (recomputed.snapshotId !== archive.snapshotId || hashSos(recomputed.horizons) !== hashSos(archive.horizons)) throw Error('SOS_REPLAY_MISMATCH');
  return { snapshotId: archive.snapshotId, reproduced: true, methodologyVersion: archive.methodologyVersion };
}
