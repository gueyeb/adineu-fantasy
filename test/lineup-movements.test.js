import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLineupMovements, formatLineupMovements } from '../scripts/lineup-movements.js';
const player = name => ({ sleeperId: name, name });
const rotation = [
  { slot: 'WR', in: player('Puka'), out: player('Moore'), gain: 12.7 },
  { slot: 'FLEX', in: player('Moore'), out: player('Wicks'), gain: -11 }
];
test('a coupled rotation reports one net replacement and no isolated negative decision', () => {
  const [group] = groupLineupMovements(rotation);
  assert.equal(group.type, 'COUPLED_ROTATION');
  assert.equal(group.gain, 1.7);
  assert.deepEqual(group.entering.map(row => row.name), ['Puka']);
  assert.deepEqual(group.leaving.map(row => row.name), ['Wicks']);
  const [text] = formatLineupMovements({ changes: rotation });
  assert.match(text, /Puka à la place de Wicks \(\+1.7 pts projetés au total\)/);
  assert.match(text, /WR: Puka ; FLEX: Moore/);
  assert.doesNotMatch(text, /12.7|-11/);
});
test('independent changes remain separate and an empty slot does not connect unrelated moves', () => {
  const groups = groupLineupMovements([...rotation,
    { slot: 'QB', in: player('QB'), out: null, gain: 12 },
    { slot: 'K', in: player('K'), out: null, gain: 8 }]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(row => row.gain), [1.7, 12, 8]);
  assert.equal(groups[1].fillsEmptySlot, true);
});
test('transitive links merge even when assignments are out of chain order', () => {
  const groups = groupLineupMovements([
    { slot: 'WR', in: player('A'), out: player('B'), gain: 3 },
    { slot: 'FLEX', in: player('C'), out: player('D'), gain: 1 },
    { slot: 'WR', in: player('B'), out: player('C'), gain: -2 }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].gain, 2);
  assert.deepEqual(groups[0].entering.map(row => row.name), ['A']);
  assert.deepEqual(groups[0].leaving.map(row => row.name), ['D']);
});
test('missing deltas stay unknown and close calls use the group gain', () => {
  assert.equal(groupLineupMovements([{ ...rotation[0], gain: null }])[0].gain, null);
  assert.match(formatLineupMovements({ changes: [{ ...rotation[0], gain: null }] })[0], /gain non vérifié/);
  assert.match(formatLineupMovements({ changes: [{ ...rotation[0], gain: 11.6 }, rotation[1]] })[0], /Choix proche/);
  assert.deepEqual(groupLineupMovements(), []);
});
test('the real optimizer exposes rotations without changing its total or promoted players', async () => {
  const { compareWithOptimalLineup } = await import('../scripts/lineup-advisor.js');
  const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  const values = [20, 15, 14, 10, 24, 9, 21, 8, 7];
  const starters = slots.map((slot, index) => ({ slot, player: { ...player(`starter${index}`), position: slot === 'FLEX' ? 'WR' : slot } }));
  const newcomer = { ...player('newWR'), position: 'WR' };
  const projections = Object.fromEntries([...starters.map((row, index) => [row.player.sleeperId, { pts_ppr: values[index] }]), ['newWR', { pts_ppr: 22.7 }]]);
  const result = compareWithOptimalLineup({ myTeam: { starters, bench: [newcomer] }, projections });
  assert.equal(result.gain, 12.7);
  assert.deepEqual(result.promote.map(row => row.sleeperId), ['newWR']);
  assert.equal(result.movementGroups.length, 1);
  assert.equal(result.movementGroups[0].gain, result.gain);
  assert.deepEqual(result.movementGroups[0].leaving.map(row => row.sleeperId), ['starter3']);
  assert.deepEqual(result.movementGroups[0].entering.map(row => row.sleeperId), ['newWR']);
});
test('old rows without identifiers preserve names without guessing a rotation', () => {
  const text = formatLineupMovements({ changes: [{ slot: 'RB', in: { name: 'Bench' }, out: { name: 'Starter' }, gain: 2 }] });
  assert.match(text[0], /Bench à la place de Starter/);
});
