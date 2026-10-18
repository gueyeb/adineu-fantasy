export function tierChip(tier) {
  return tier === null ? "" : `<span class="value-tier-chip" title="Groupe de valeur ${tier}">T${tier}</span>`;
}

export function tierSeparator(row, previous, columns) {
  if (previous && row.position === previous.position && row.tier === previous.tier) return "";
  return `<tr class="value-tier-separator"><th colspan="${columns}" scope="colgroup">${escapeHtml(row.position || "?")} · ${row.tier === null ? "Valeur indisponible" : `Tier ${row.tier}`}</th></tr>`;
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
