import { pathToFileURL } from 'node:url';

const text = value => value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Read-only source audit. Collection time is never represented as publication time. */
export function auditNflInjuryReport(html, { season, week, now = Date.now() }) {
  const source = `https://www.nfl.com/injuries/league/${season}/reg${week}`;
  const title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  if (!title.includes(`Week ${week} of the ${season} Season`)) throw Error('NFL report season/week mismatch');
  const reports = [];
  const sections = html.matchAll(/class="nfl-t-stats__title"([\s\S]*?)<table\b[^>]*>([\s\S]*?)<\/table>/g);
  for (const [, heading, table] of sections) {
    const team = text(heading.match(/<span\b[^>]*>([\s\S]*?)<\/span>/)?.[1] || '');
    const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => text(match[1]));
    if (!team || headers.join('|') !== 'Player|Position|Injuries|Practice Status|Game Status') throw Error('Unsupported NFL report structure');
    for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => text(match[1]));
      if (!cells.length) continue;
      if (cells.length !== 5 || !cells[0] || !cells[1]) throw Error('Invalid NFL injury row');
      reports.push({ team, playerName: cells[0], position: cells[1], injury: cells[2] || null,
        practiceParticipation: cells[3] || null, gameStatus: cells[4] || null });
    }
  }
  if (!reports.length) throw Error('NFL report empty or unsupported');
  return { source, season, week, collectedAt: new Date(now).toISOString(), publishedAt: null,
    status: 'PUBLICATION_TIME_UNVERIFIED', eligibleForIngestion: false, shouldRecompute: false, reports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const season = Number(process.argv[2]), week = Number(process.argv[3]);
  if (!Number.isInteger(season) || season < 2026 || !Number.isInteger(week) || week < 1 || week > 18) {
    console.error('Usage: node scripts/audit-nfl-injuries.js SEASON WEEK');
    process.exitCode = 1;
  } else {
    try {
      const response = await fetch(`https://www.nfl.com/injuries/league/${season}/reg${week}`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw Error(`NFL source unavailable (${response.status})`);
      console.log(JSON.stringify(auditNflInjuryReport(await response.text(), { season, week }), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
