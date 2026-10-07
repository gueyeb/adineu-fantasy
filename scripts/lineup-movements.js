/** Group slot assignments linked by the same player into one executable rotation. */
export function groupLineupMovements(changes = []) {
  const remaining = new Set(changes.map((_, index) => index));
  const groups = [];
  const idsOf = change => [change.in?.sleeperId, change.out?.sleeperId].filter(id => id != null).map(String);
  while (remaining.size) {
    const indices = [remaining.values().next().value];
    remaining.delete(indices[0]);
    const ids = new Set(idsOf(changes[indices[0]]));
    for (let cursor = 0; cursor < indices.length; cursor++) {
      for (const index of remaining) {
        if (!idsOf(changes[index]).some(id => ids.has(id))) continue;
        remaining.delete(index);
        indices.push(index);
        idsOf(changes[index]).forEach(id => ids.add(id));
      }
    }
    const assignments = indices.sort((a, b) => a - b).map(index => changes[index]);
    const before = new Map(assignments.filter(row => row.out).map((row, index) => [row.out.sleeperId == null ? `before:${index}` : String(row.out.sleeperId), row.out]));
    const after = new Map(assignments.filter(row => row.in).map((row, index) => [row.in.sleeperId == null ? `after:${index}` : String(row.in.sleeperId), row.in]));
    const covered = assignments.every(row => Number.isFinite(row.gain));
    groups.push({ type: assignments.length > 1 ? 'COUPLED_ROTATION' : 'SINGLE_REPLACEMENT',
      assignments, entering: [...after].filter(([id]) => !before.has(id)).map(([, player]) => player),
      leaving: [...before].filter(([id]) => !after.has(id)).map(([, player]) => player),
      gain: covered ? Number(assignments.reduce((sum, row) => sum + row.gain, 0).toFixed(1)) : null,
      covered, fillsEmptySlot: assignments.some(row => !row.out) });
  }
  return groups;
}

export function formatLineupMovements(optimal) {
  // Reconstruct for older snapshots that only captured per-slot assignments.
  return groupLineupMovements(optimal?.changes).map(group => {
    const close = !group.fillsEmptySlot && group.gain !== null && group.gain >= 0 && group.gain < 1;
    const names = players => players.map(player => player.name).join(' + ') || 'aucun joueur';
    const delta = group.gain === null ? 'gain non vérifié' : `${group.gain >= 0 ? '+' : ''}${group.gain} pts projetés au total`;
    const scope = group.assignments.length === 1 ? group.assignments[0].slot : 'la lineup';
    const label = group.fillsEmptySlot ? `Compléter ${scope}` : close ? `Choix proche — ${scope}` : `Optimiser ${scope}`;
    const assignment = group.assignments.map(row => `${row.slot}: ${row.in?.name || 'slot vide'}`).join(' ; ');
    return `${label} — ${names(group.entering)}${group.leaving.length ? ` à la place de ${names(group.leaving)}` : ''} (${delta}) ; ${group.type === 'COUPLED_ROTATION' ? 'rotation couplée : ' : ''}${assignment}${close ? ' · santé/rôle à confirmer ; conserver le titulaire comme repli si disponible' : ' · vérifier disponibilité et verrouillage avant changement'}`;
  });
}
