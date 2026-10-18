import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTiers } from '../public/assets/value-tiers.js';
import { buildWaiverDisplayTiers } from '../public/assets/waiver-board.js';

const tiers = (values, options = {}) => buildTiers(values.map((score, id) => ({ id, score })), { value: row => row.score, ...options });
test('largest natural gaps split descending values without mutating input', () => {
  const rows = Object.freeze([Object.freeze({ score: 10 }), Object.freeze({ score: 30 }), Object.freeze({ score: 29 }), Object.freeze({ score: 9 })]);
  assert.deepEqual(buildTiers(rows, { value: row => row.score }).map(row => [row.score, row.tier]), [[30, 1], [29, 1], [10, 2], [9, 2]]);
  assert.equal(rows[0].tier, undefined);
  assert.deepEqual(tiers([30, 29, 10, 9], { minGap: 21 }).map(row => row.tier), [1, 1, 1, 1]);
});
test('ties stay together in stable order', () => {
  assert.deepEqual(tiers([20, 20, 5, 5]).map(row => [row.id, row.tier]), [[0, 1], [1, 1], [2, 2], [3, 2]]);
});
test('null, undefined and non-finite values stay last and unpriced; zero is real', () => {
  assert.deepEqual(tiers([null, -2, NaN, 0, Infinity, undefined]).map(row => [row.id, row.tier]), [[3, 1], [1, 1], [0, null], [2, null], [4, null], [5, null]]);
  assert.deepEqual(tiers([null, NaN]).map(row => row.tier), [null, null]);
});
test('empty, single row and all equal', () => {
  assert.deepEqual(tiers([]), []);
  assert.equal(tiers([12])[0].tier, 1);
  assert.deepEqual(tiers([4, 4, 4]).map(row => row.tier), [1, 1, 1]);
});
test('cap retains largest gaps, breaking equal-gap ties by sorted position', () => {
  const rows = tiers([30, 30, 30, 25, 25, 25, 15, 15, 15, 5, 5, 5], { maxTiers: 2 });
  assert.deepEqual(rows.map(row => row.tier), [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.ok(tiers([20, 20, 5, 5], { maxTiers: 1 }).every(row => row.tier === 1));
});
test('waiver tiers follow the board sort key, keep board order and leave uncovered rows unpriced', () => {
  const rows = [{ id: 'a', position: 'RB', marketScore: 58, effectivePpg: 6.7 }, { id: 'b', position: 'RB', marketScore: 41, effectivePpg: 9 },
    { id: 'c', position: 'RB', marketScore: 0, effectivePpg: 4.5 }, { id: 'd', position: 'RB', marketScore: 0, effectivePpg: 8 },
    { id: 'e', position: 'RB', marketScore: 70, valuationCovered: false }];
  const tiered = buildWaiverDisplayTiers(rows);
  assert.deepEqual(tiered.map(row => row.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(tiered.at(-1).tier, null);
  assert.equal(tiered[2].tier, tiered[3].tier);
  assert.equal(rows[0].tier, undefined);
  const streaming = buildWaiverDisplayTiers([{ id: 'k1', position: 'K', weekProjection: 9, marketScore: 0 }, { id: 'k2', position: 'K', weekProjection: 4, marketScore: 50 }]);
  assert.deepEqual(streaming.map(row => row.id), ['k1', 'k2']);
});
