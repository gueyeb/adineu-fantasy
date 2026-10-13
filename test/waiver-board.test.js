import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWaiverBoard } from '../public/assets/waiver-board.js';
import { selectPlanCandidates } from '../public/assets/waiver-plan.js';

test('weekly streamers survive a low ROS market score and missing values stay last', () => {
  const rows = [{ sleeperId:'ros', position:'DEF', weekProjection:5, marketScore:90 },
    { sleeperId:'missing', position:'DEF', weekProjection:null, marketScore:80 },
    { sleeperId:'weekly', position:'DEF', weekProjection:8.1, marketScore:0 }];
  assert.equal(selectWaiverBoard(rows, {limitPerPosition:1})[0].sleeperId, 'weekly');
  assert.equal(selectPlanCandidates(rows,1).length,3);
});
test('board keeps market order outside streaming and pinned alternatives remain visible', () => {
  const rows = [{sleeperId:'market',position:'WR',weekProjection:5}, {sleeperId:'week',position:'WR',weekProjection:10},
    {sleeperId:'event',position:'WR',weekProjection:null,poolEntry:{pinned:true}}];
  assert.deepEqual(selectWaiverBoard(rows,{limitPerPosition:1}).map(row=>row.sleeperId),['market','event']);
});
