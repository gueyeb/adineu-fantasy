import test from 'node:test';
import assert from 'node:assert/strict';
import { auditNflInjuryReport } from '../scripts/audit-nfl-injuries.js';

const page = `<title>Official NFL Injury Report for Players - Week 11 of the 2026 Season | NFL.com</title>
<div class="nfl-t-stats__title"><span>Colts</span></div><table>
<tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr>
<tr><td><a>Example Player</a></td><td>RB</td><td>Knee</td><td>Did Not Participate In Practice</td><td></td></tr></table>`;

test('audit preserves unknown designation and refuses automatic ingestion without publication time', () => {
  const result = auditNflInjuryReport(page, { season: 2026, week: 11, now: Date.parse('2026-11-20T12:00:00Z') });
  assert.equal(result.reports[0].gameStatus, null);
  assert.equal(result.reports[0].practiceParticipation, 'Did Not Participate In Practice');
  assert.equal(result.publishedAt, null);
  assert.equal(result.eligibleForIngestion, false);
  assert.equal(result.shouldRecompute, false);
});

test('audit rejects wrong scope, empty pages and changed table contracts', () => {
  assert.throws(() => auditNflInjuryReport(page, { season: 2026, week: 12 }), /mismatch/);
  assert.throws(() => auditNflInjuryReport(page.split('<div')[0], { season: 2026, week: 11 }), /empty/);
  assert.throws(() => auditNflInjuryReport(page.replace('Game Status', 'Status'), { season: 2026, week: 11 }), /structure/);
});
