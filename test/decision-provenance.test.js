import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionProvenance } from '../scripts/decision-provenance.js';

test('provenance distinguishes field missing, load failed, actual zero and unverified games', () => {
  const row = buildDecisionProvenance({ playerId:'x', position:'WR', week:4, lastCompletedWeek:3, season:'2026', projectionsByWeek:{4:{x:{pts_ppr:0}},5:{}}, statsByWeek:[{week:2,stats:{x:{gp:1}}},{week:3,stats:{}}], fetchedAtByPath:{'/projections/nfl/regular/2026/4':'2026-10-04T09:00:00Z'},rosSource:'RANK_ESTIMATE' });
  assert.equal(row.projections.weeks[0].status,'AVAILABLE');
  assert.equal(row.projections.weeks[0].fetchedAt,'2026-10-04T09:00:00Z');
  assert.equal(row.projections.weeks[1].status,'PLAYER_MISSING');
  assert.equal(row.projections.weeks[2].status,'LOAD_FAILED');
  assert.equal(row.projections.fallbackReason,'INSUFFICIENT_PLAYER_PROJECTIONS');
  assert.equal(row.usage.sampleGames,1);
  assert.equal(row.usage.completionVerified,false);
  assert.equal(row.usage.routes,null);
});
