import { sosDifficultyFields } from './sos-insights.js?v=c553d8c0f3';
/** Compact explanatory view. Never sorts or changes Coach decisions. */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { FAVORABLE: 'Favorable', NEUTRAL: 'Neutre', DIFFICULT: 'Difficile' };
const reasons = { SOS_UNAVAILABLE: 'Calendrier indisponible', SOS_STALE: 'À actualiser', NFL_TEAM_UNAVAILABLE: 'Équipe NFL inconnue',
  NO_REMAINING_GAMES: 'Saison régulière terminée', DVP_UNAVAILABLE: 'Données défensives manquantes', DVP_PARTIAL: 'Couverture partielle', SCHEDULE_INCOMPLETE: 'Calendrier incomplet' };
const number = value => Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—';

function playerRows(players, caption) {
  if (!players.length) return '<p class="coach-empty">Aucun WR ou RB dans le roster.</p>';
  return `<div class="coach-sos-table-wrap"><table class="coach-sos-table"><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Joueur</th><th scope="col">Rang ROS</th><th scope="col">Prochains adversaires</th></tr></thead><tbody>${players.map(row => {
    const horizon = row.sos ?? row.horizons?.FANTASY_ROS;
    const games = horizon?.opponents?.slice(0, 3) ?? [];
    const categories = sosDifficultyFields(row.sos ?? {});
    const label = row.sos ? (categories.relativeDifficulty === 'NEUTRAL' ? 'Intermédiaire' : labels[categories.relativeDifficulty]) ?? 'Non classé' : reasons[row.reason] ?? 'Non classé';
    return `<tr><td><details class="coach-sos-player"><summary><strong>${escapeHtml(row.name)} · ${escapeHtml(row.position ?? 'WR')}</strong><span>${escapeHtml(row.nflTeam || 'Équipe inconnue')}</span></summary><div class="coach-sos-player-data"><p>Difficulté absolue : ${escapeHtml(labels[categories.absoluteDifficulty] ?? 'Non classé')} (±12 % de la moyenne NFL).</p><p><b>${number(horizon?.sosScore)}</b> ${escapeHtml(row.position ?? 'WR')} PPR concédés par match, ajustés</p><p>${horizon ? `Couverture : ${horizon.coveredGames}/${horizon.gamesInWindow} matchs${horizon.coverageStatus === 'PARTIAL' ? ' · score indicatif, sans rang officiel' : ''}.` : 'Couverture indisponible.'}</p>${row.reason ? `<p>${escapeHtml(reasons[row.reason] ?? 'Données insuffisantes')}</p>` : ''}</div></details></td><td><strong class="coach-sos-rank">${row.sos?.rank ? `${row.sos.rank}<small>/32</small>` : '—'}</strong><span class="coach-sos-label ${escapeHtml(categories.relativeDifficulty || '')}">${escapeHtml(label)}</span></td><td><div class="coach-sos-games">${games.map(game => `<span><small>S${game.week}</small><b>${escapeHtml(game.opponent)}</b></span>`).join('') || '<span class="coach-empty">—</span>'}</div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function renderCoachSos(sos) {
  const roster = (sos?.players ?? []).filter(row => row.scope === 'ROSTER');
  const candidates = (sos?.players ?? []).filter(row => row.scope === 'WAIVER');
  const timestamp = sos?.asOf && Number.isFinite(Date.parse(sos.asOf)) ? new Date(sos.asOf).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : null;
  return `<header class="coach-sos-header"><div><p>WR et RB · fin de saison régulière</p><h2>CALENDRIER ROS</h2></div><a href="/sos/">Explorer →</a></header>
    <p class="coach-sos-intro">Rang 1 = calendrier le plus favorable à la position du joueur. Étiquette relative au rang ; seuil absolu dans le détail. Ce contexte ne suffit pas à décider d’un ajout ou d’une titularisation.</p>
    ${!sos || sos.reason ? `<p class="coach-empty">${escapeHtml(reasons[sos?.reason] ?? 'Calendrier indisponible')} · décisions habituelles conservées.</p>` : ''}
    ${sos ? playerRows(roster, 'WR et RB du roster') : ''}
    ${candidates.length ? `<details class="coach-sos-candidates"><summary>Voir les candidats waivers <span>${candidates.length} WR / RB</span></summary>${playerRows(candidates, 'WR et RB disponibles — contexte calendrier uniquement')}</details>` : ''}
    <details class="method-note coach-sos-method"><summary>Méthode et données${timestamp ? ` · ${escapeHtml(timestamp)}` : ''}</summary><div><p>Les points mesurent la production concédée à tous les adversaires de la même position, pas une projection pour ce joueur. Les byes sont exclus ; une couverture incomplète ne donne pas de rang officiel.</p><p>${escapeHtml(sos?.explanation || 'Projections et décisions inchangées.')}</p><p>Ouvrir le nom d’un joueur pour consulter son score et sa couverture.</p>${sos?.positions ? Object.entries(sos.positions).map(([position, capture]) => `<p class="method-provenance">${escapeHtml(position)} · Snapshot : ${escapeHtml(capture.snapshotId ?? 'indisponible')}<br>Capture : ${escapeHtml(capture.asOf ?? reasons[capture.reason] ?? 'indisponible')} (heure affichée : Paris).</p>`).join('') : sos?.snapshotId ? `<p class="method-provenance">Snapshot : ${escapeHtml(sos.snapshotId)}<br>Capture : ${escapeHtml(sos.asOf)} (heure affichée : Paris).</p>` : ''}</div></details>`;
}
