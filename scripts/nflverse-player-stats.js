/** Shared nflverse player-stat endpoint and RFC-style CSV reader. */
export const NFLVERSE_PLAYER_STATS_URL = season => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

export function parseNflverseCsv(text) {
  const records = []; let record = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { record.push(field.replace(/\r$/, '')); field = ''; if (c === '\n') { records.push(record); record = []; } }
    else field += c;
  }
  if (quoted) throw Error('Invalid CSV quotes');
  if (field || record.length) { record.push(field.replace(/\r$/, '')); records.push(record); }
  const header = records.shift();
  if (!header || new Set(header).size !== header.length) throw Error('Invalid CSV header');
  return records.filter(row => row.some(Boolean)).map(row => {
    if (row.length !== header.length) throw Error('Invalid CSV row');
    return Object.fromEntries(header.map((key, index) => [key, row[index]]));
  });
}
