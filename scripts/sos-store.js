/** Durable append-only SOS archives. Mount SOS_DATA_DIR outside the public tree. */
import { mkdir, readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashSos } from './sos-sources.js';
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
export function createSosStore({ directory = process.env.SOS_DATA_DIR || '.cache/sos' } = {}) {
  const root = resolve(directory);
  async function atomic(name, value) {
    await mkdir(root, { recursive: true });
    const temporary = resolve(root, `.tmp-${randomUUID()}`);
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    try { await link(temporary, resolve(root, name)); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    finally { await unlink(temporary); }
  }
  async function load(id) {
    if (!validId(id)) throw Error('INVALID_SNAPSHOT_ID');
    try {
      const record = JSON.parse(await readFile(resolve(root, `${id}.json`), 'utf8'));
      if (hashSos(record.bundle) !== record.hash || record.bundle.snapshotId !== id) throw Error('SNAPSHOT_INTEGRITY_ERROR');
      return record.bundle;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    load,
    async save(bundle) {
      if (!validId(bundle.snapshotId) || !Number.isInteger(bundle.week) || !Number.isInteger(bundle.season)) throw Error('INVALID_SNAPSHOT');
      await atomic(`${bundle.snapshotId}.json`, { bundle, hash: hashSos(bundle) });
      // A complete immutable bundle is written before publication. First weekly pointer wins.
      const published = await atomic(`weekly-${bundle.season}-${bundle.week}.json`, { snapshotId: bundle.snapshotId });
      const pointer = JSON.parse(await readFile(resolve(root, `weekly-${bundle.season}-${bundle.week}.json`), 'utf8'));
      return { published, snapshotId: pointer.snapshotId };
    },
    async list() {
      let files; try { files = await readdir(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const records = [];
      for (const name of files.filter(name => /^weekly-\d{4}-\d{1,2}\.json$/.test(name))) {
        const pointer = JSON.parse(await readFile(resolve(root, name), 'utf8'));
        const bundle = await load(pointer.snapshotId);
        if (bundle) records.push({ snapshotId: bundle.snapshotId, asOf: bundle.asOf, season: bundle.season, week: bundle.week, methodologyVersion: bundle.methodologyVersion });
      }
      return records.sort((a, b) => b.asOf.localeCompare(a.asOf));
    },
    async saveEvaluation(snapshotId, result) {
      if (!validId(snapshotId)) throw Error('INVALID_SNAPSHOT_ID');
      const revision = hashSos(result);
      await atomic(`feedback-${snapshotId}-${revision}.json`, result);
      return revision;
    }
  };
}
export const sosStore = createSosStore();

export function historicalSos(bundle, horizon) {
  const result = structuredClone(bundle.horizons[horizon]);
  result.window = { ...result.window, snapshotId: bundle.snapshotId, viewMode: 'AS_OF_SNAPSHOT' };
  result.teams.forEach(team => { team.window = { ...result.window }; });
  return result;
}
