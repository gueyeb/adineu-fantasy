/**
 * Return copied rows sorted by descending finite value (unknowns last, tier null).
 * Split positive adjacent gaps >= max(minGap, 2 × median of all adjacent gaps),
 * keeping the largest maxTiers - 1 breaks; equal gaps prefer the earlier break.
 * Ties never split; input rows are not mutated. Defaults: minGap 1, maxTiers 6.
 */
export function buildTiers(rows, { value, maxTiers = 6, minGap = 1 } = {}) {
  const sorted = rows.map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => Number(Number.isFinite(b.value)) - Number(Number.isFinite(a.value)) ||
      (Number.isFinite(a.value) && Number.isFinite(b.value) ? b.value - a.value : 0) || a.index - b.index);
  const priced = sorted.filter(row => Number.isFinite(row.value));
  const gaps = priced.slice(1).map((row, index) => ({ index, gap: priced[index].value - row.value }));
  const orderedGaps = gaps.map(row => row.gap).sort((a, b) => a - b);
  const middle = Math.floor(orderedGaps.length / 2);
  const median = orderedGaps.length ? (orderedGaps[middle] + orderedGaps[Math.floor((orderedGaps.length - 1) / 2)]) / 2 : 0;
  const threshold = Math.max(Number.isFinite(minGap) ? minGap : 1, 2 * median);
  const cap = Number.isFinite(maxTiers) ? Math.max(1, Math.floor(maxTiers)) : 6;
  const breaks = new Set(gaps.filter(row => row.gap > 0 && row.gap >= threshold)
    .sort((a, b) => b.gap - a.gap || a.index - b.index).slice(0, cap - 1).map(row => row.index));
  let tier = 1;
  return sorted.map(({ row, value: score }, index) => {
    if (breaks.has(index - 1)) tier++;
    return { ...row, tier: Number.isFinite(score) ? tier : null };
  });
}
