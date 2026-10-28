import { classifyCompactWaiverPresentation, compactWaiverCandidate, waiverAvailabilityLabel, waiverBlockerLabel } from "./waiver-decision-view.js?v=d71dc49b36";
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const number = value => Number.isFinite(value) ? value.toFixed(1) : 'n/d';
const money = value => Number.isFinite(value) ? `${value} $` : 'non déterminé';

function rosterRow(player, slot) {
  return `<tr><td>${escapeHtml(slot)}</td><td><strong>${escapeHtml(player?.name || 'Slot vide')}</strong><small>${escapeHtml(player?.nflTeam || '')}${player?.status ? ` · ${escapeHtml(player.status)}` : ''}</small></td><td>${number(player?.weekProjection)}</td><td>${number(player?.rosPpg)}</td><td>${number(player?.usageScore)}</td></tr>`;
}

export function renderWeeklyRoster(plan, suggested = false) {
  const roster = plan.roster || {};
  const changes = plan.lineup?.optimal?.changes || [];
  const movedIds = new Set(changes.filter(change => change.in?.sleeperId).map(change => String(change.in.sleeperId)));
  const byId = new Map(['starters', 'bench', 'ir'].flatMap(group => roster[group] || []).map(entry => entry.player || entry)
    .filter(Boolean).map(player => [String(player.sleeperId), player]));
  const occurrences = {};
  const starterEntries = (roster.starters || []).map(entry => {
    occurrences[entry.slot] = (occurrences[entry.slot] || 0) + 1;
    const repeated = (roster.starters || []).filter(row => row.slot === entry.slot).length > 1;
    return { ...entry, slot: repeated ? `${entry.slot}${occurrences[entry.slot]}` : entry.slot };
  });
  const starters = starterEntries.map(entry => {
    const change = suggested && changes.find(change => change.slot === entry.slot);
    const replacement = change ? byId.get(String(change.in?.sleeperId)) || change.in : entry.player;
    return rosterRow(replacement, entry.slot);
  });
  const bench = suggested ? [...byId.values()].filter(player => !movedIds.has(String(player.sleeperId)) &&
    !(roster.ir || []).some(row => String(row.sleeperId) === String(player.sleeperId)) &&
    !starterEntries.some(entry => entry.player?.sleeperId === player.sleeperId && !changes.some(change => change.slot === entry.slot))) : roster.bench || [];
  return `<div class="coach-table-scroll"><table class="coach-week-table"><caption>${suggested ? 'Lineup proposée — à appliquer dans Sleeper' : 'Lineup actuelle'} · S${escapeHtml(plan.week)}</caption><thead><tr><th>Slot</th><th>Joueur</th><th>S${escapeHtml(plan.week)} pts</th><th>ROS pts/sem</th><th>Usage /100</th></tr></thead><tbody>${starters.join('')}<tr class="coach-group-row"><th colspan="5">Banc</th></tr>${bench.map(player => rosterRow(player, player.position)).join('')}${roster.ir?.length ? `<tr class="coach-group-row"><th colspan="5">IR · hors lineup</th></tr>${roster.ir.map(player => rosterRow(player, 'IR')).join('')}` : ''}</tbody></table></div>`;
}

/** One line per player and cause: weeks collapsed into ranges, roster first. */
function groupProjectionGaps(rows = []) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = `${row.scope || 'candidates'}|${row.playerId || row.name}|${row.cause}`;
    if (!groups.has(key)) groups.set(key, { scope: row.scope || 'candidates', name: row.name, cause: row.cause, weeks: [] });
    groups.get(key).weeks.push(Number(row.week));
  }
  return [...groups.values()].sort((a, b) => (a.scope === 'roster' ? 0 : 1) - (b.scope === 'roster' ? 0 : 1) || String(a.name).localeCompare(String(b.name), 'fr'));
}

const weekRanges = weeks => {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const ranges = [];
  for (const week of sorted) {
    const last = ranges.at(-1);
    if (last && week === last[1] + 1) last[1] = week; else ranges.push([week, week]);
  }
  return ranges.map(([from, to]) => from === to ? `S${from}` : `S${from}–S${to}`).join(', ');
};

export function renderWeeklyMoves(plan, { now = Date.now() } = {}) {
  const steps = plan.acquisitionPlan?.steps || [];
  const alternatives = (plan.acquisitionPlan?.alternativeClaimGroups || plan.acquisitionPlan?.claimPortfolio?.alternativeClaimGroups || []).flatMap(group => group.claims || []);
  const seen = new Set();
  const actions = (plan.acquisitionPlan ? [...steps, ...alternatives] : [...(plan.waiverActions?.ADD_NOW || []), ...(plan.waiverActions?.CLAIM_IF_CHEAP || [])]).filter(row => {
    const key = `${row.playerId || row.sleeperId || row.name}:${row.dropCandidate?.sleeperId || 'open'}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const groups = new Map();
  for (const row of actions) {
    const key = row.dropCandidate?.sleeperId || 'open';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const cards = [...groups.values()].map(rows => `<article class="coach-move-group"><h3>${rows[0].dropCandidate ? `Coupe envisagée : ${escapeHtml(rows[0].dropCandidate.name)}` : 'Utiliser une place libre'}</h3>${rows.length > 1 ? '<p>Alternatives sur la même coupe : choisir un seul ajout.</p>' : ''}${rows.map(row => {
    const presentation = classifyCompactWaiverPresentation(row, { asOf: plan.availabilityAsOf, now, publishable: plan.publishable });
    const unpriced = row.dropCostComponents?.unpricedCutPotential || row.modelMetrics?.dropCostComponents?.unpricedCutPotential;
    return `<details class="coach-move" data-decision-bucket="${presentation.bucket}"><summary><strong>${escapeHtml(row.name)}</strong><span>${row.recommendedAction === 'ADD_NOW' ? 'Ajout libre · 0 $' : `Claim · ${money(row.suggestedBid)}`}</span></summary><p><strong data-coach-decision-status>${escapeHtml(presentation.label)}</strong></p>${presentation.blockers.length ? `<ul>${[...new Set(presentation.blockers.map(waiverBlockerLabel))].map(label => `<li>${escapeHtml(label)}</li>`).join("")}</ul>` : ""}<dl><div><dt>Gain net</dt><dd>${number(row.netGainTotal)} pts / ${escapeHtml(row.horizonWeeks ?? 'n/d')} sem</dd></div><div><dt>Plafond personnel</dt><dd>${money(row.personalMaxBid ?? row.maxForTeam)}</dd></div><div><dt>Disponibilité</dt><dd>${escapeHtml(waiverAvailabilityLabel(compactWaiverCandidate(row)))}</dd></div></dl><p>${escapeHtml(row.interpretation || 'Scénario conditionnel, roster et budget recalculés après chaque résultat.')}</p><p>Réévaluer après le résultat de l’ajout ou une nouvelle information de santé/rôle.${unpriced ? ' Potentiel de la coupe non chiffré : coût estimé incomplet.' : ''}</p></details>`;
  }).join('')}</article>`).join('');
  const warnings = plan.coherence?.warnings || [];
  const gaps = groupProjectionGaps(plan.projectionDiagnostics);
  const status = plan.publishable === false ? 'NON PUBLIABLE — corriger avant action' : plan.coherence?.decisionStatus?.status === 'TO_CONFIRM' ? 'Disponibilités déduites — à confirmer dans Sleeper' : plan.coherence?.decisionStatus?.status === 'DEGRADED' ? 'Décision dégradée — données à vérifier' : 'Recommandations à vérifier avant action';
  const alerts = (plan.lineup?.alerts || []).map(alert => `<p class="coach-review-status"><strong>${escapeHtml(alert.slot)} : ${escapeHtml(alert.reason)}</strong>${alert.advice ? ` — ${escapeHtml(alert.advice)}` : ''}</p>`).join('');
  return `${alerts}<p class="coach-review-status">${escapeHtml(status)}</p>${cards || '<p class="coach-empty">Aucune acquisition prioritaire. Conserver le roster et surveiller les alertes.</p>'}<details class="coach-review-details"><summary>Données à vérifier (${warnings.length} alerte${warnings.length > 1 ? 's' : ''}${gaps.length ? ` · ${gaps.length} joueur${gaps.length > 1 ? 's' : ''} sans projection` : ''})</summary>${warnings.map(row => `<p>${escapeHtml(row.message || row.code)}</p>`).join('')}${gaps.length ? `<p><strong>Semaines sans projection publiée</strong> (aucune valeur zéro substituée) :</p>${gaps.map(row => `<p>${row.scope === 'roster' ? 'Ton roster' : 'Candidat'} · ${escapeHtml(row.name)} · ${weekRanges(row.weeks)} : ${row.cause === 'LOAD_FAILED' ? 'chargement de la source échoué' : 'joueur absent des projections publiées'}.</p>`).join('')}` : ''}</details>`;
}
