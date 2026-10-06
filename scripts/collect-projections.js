#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECTION_PROVIDERS } from './projection-comparison.js';
const execute = promisify(execFile);

export async function collectProjections({ season, week, position, output, run = execute }) {
  if (!Number.isInteger(season) || season < 2026 || !Number.isInteger(week) || week < 1 || week > 18 || !['WR', 'RB', 'TE'].includes(position) || !output) throw Error('Explicit season, week, WR/RB/TE position and output required');
  try { await access(output); throw Object.assign(Error('Output already exists'), { code: 'EEXIST' }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scratch = await mkdtemp(join(tmpdir(), 'adineu-projections-'));
  const capture = { version: 1, season, week, scoring: 'PPR', sources: [] };
  try {
    for (const [provider, contract] of Object.entries(PROJECTION_PROVIDERS)) {
      const path = join(scratch, `${provider}.json`);
      const options = { position, scoring: 'PPR', week, limit: 100, ...(provider === 'draftsharks-com' ? { superflex: false } : { type: 'weekly' }) };
      let source;
      try {
        await run('firecrawl', ['scrape', `${provider}/${contract.capability}`, '--options', JSON.stringify(options), '--json', '-o', path], { timeout: 120000, maxBuffer: 1000000 });
        const response = JSON.parse(await readFile(path, 'utf8'));
        const entries = response.data?.alexandria?.filter(entry => entry.provider === provider && entry.capability === contract.capability) ?? [];
        if (response.success !== true || entries.length !== 1 || entries[0].error || !entries[0].data?.players) throw Error('Provider response invalid');
        source = { data: entries[0].data, scrapeId: response.scrape_id ?? null, creditsUsed: response.receipt?.creditsUsed ?? null };
      } catch { source = { error: 'COLLECTION_FAILED' }; }
      capture.sources.push({ provider, capability: contract.capability, position, options, fetchedAt: new Date().toISOString(), ...source });
    }
    capture.capturedAt = new Date().toISOString();
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { saved: output, successfulSources: capture.sources.filter(source => !source.error).length, failedSources: capture.sources.filter(source => source.error).length };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4) throw Error('Usage: collect-projections.js SEASON WEEK POSITION OUTPUT.json');
    const result = await collectProjections({ season: Number(args[0]), week: Number(args[1]), position: args[2], output: resolve(args[3]) });
    console.log(JSON.stringify(result));
    if (!result.successfulSources) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
