const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = value => new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
const safeSource = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
const labels = { STATUS: 'Statut', INJURY: 'Absence', RETURN: 'Retour', ROLE: 'Rôle' };
const roles = { STARTER: 'Titulaire', STARTING_QB: 'QB titulaire', BACKUP: 'Remplaçant', COMMITTEE: 'Comité' };

function factLabel(fact) {
  if (fact.kind === 'STATUS') return fact.value.injuryStatus;
  if (fact.kind === 'INJURY') return fact.value.seasonEndingConfirmed ? 'Saison terminée' : `Absent jusqu’en semaine ${fact.value.outThroughWeek} incluse`;
  if (fact.kind === 'RETURN') return `Retour autorisé en semaine ${fact.value.clearedForWeek}`;
  return roles[fact.value.announcedRole] || fact.value.announcedRole;
}

export function renderCoachIntelligence(data = {}) {
  const week = data.scope?.targetWeek;
  const rows = data.observations || [];
  return `<p class="war-note">Lis l’article avant de confirmer un fait. Une actualité, un retour espéré ou un entraînement manqué ne suffit pas à confirmer une disponibilité. Les faits validés alimentent le Coach jusqu’à leur expiration et restent limités à la semaine courante.</p>
    <p class="war-note">Semaine ${escapeHtml(week ?? '?')} · ${rows.length} actualité${rows.length > 1 ? 's' : ''} suivie${rows.length > 1 ? 's' : ''}. Les recommandations sont recalculées après validation. Ce panneau n’envoie pas de bulletin Telegram.</p>
    ${rows.length ? `<ol class="journal-list">${rows.map(row => {
      const source = safeSource(row.source);
      const meta = `data-observation-id="${escapeHtml(row.id)}" data-revision="${escapeHtml(row.revision)}"`;
      return `<li class="journal-entry"><h3>${escapeHtml(row.playerName)}</h3><p>${escapeHtml(row.headline)}</p>
        <p class="war-note">Publié le ${escapeHtml(date(row.publishedAt))} · ${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Lire la source officielle ↗</a>` : 'Source indisponible'}</p>
        ${row.facts.map(fact => `<div class="coach-settings-form"><p><b>${escapeHtml(labels[fact.kind])} : ${escapeHtml(factLabel(fact))}</b> · ${fact.revokedAt ? 'Retiré' : fact.active ? `Confirmé jusqu’au ${escapeHtml(date(fact.expiresAt))}` : 'Expiré'}</p>
          ${!fact.revokedAt ? `<form data-review-action="revoke" ${meta} data-kind="${escapeHtml(fact.kind)}"><button type="submit" class="coach-quiet">Retirer cette confirmation</button></form>` : ''}</div>`).join('')}
        ${row.canConfirm && source ? `<details><summary>Confirmer un fait après lecture</summary><form class="coach-settings-form" data-review-action="confirm" ${meta}>
          <label>Fait confirmé<select name="fact" required><option value="">Choisir explicitement…</option>
            ${['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus'].map(status => `<option value="STATUS:${status}">Statut : ${status}</option>`).join('')}
            <option value="INJURY:WINDOW">Absence avec durée confirmée</option><option value="INJURY:SEASON">Saison terminée explicitement</option>
            <option value="RETURN:CLEARED">Retour explicitement autorisé cette semaine</option>
            ${Object.entries(roles).filter(([role]) => role !== 'STARTING_QB' || row.position === 'QB').map(([role, label]) => `<option value="ROLE:${role}">Rôle : ${label}</option>`).join('')}
          </select></label>
          <div data-review-window hidden><label>Absent jusqu’à la semaine incluse<input name="outThroughWeek" type="number" min="${escapeHtml(week)}" max="18" step="1" disabled></label></div>
          <div data-review-role hidden><label>Nombre de semaines confirmé<input name="roleWeeks" type="number" min="1" max="${19 - week}" step="1" value="1" disabled></label></div>
          <label>À revérifier dans<select name="validForHours"><option value="6">6 heures</option><option value="12">12 heures</option><option value="24" selected>24 heures</option><option value="48">48 heures</option><option value="72">72 heures</option></select></label>
          <label><input type="checkbox" name="verified" required> J’ai lu la source et elle confirme explicitement ce fait, sa semaine et sa durée.</label>
          <button type="submit" class="coach-secondary">Confirmer pour le Coach</button>
        </form></details>` : '<p class="coach-empty">Cette actualité a expiré. Une source récente est nécessaire pour confirmer un nouveau fait.</p>'}
      </li>`;
    }).join('')}</ol>` : '<p class="coach-empty">Aucune actualité récente à valider pour l’effectif suivi. La collecte n8n alimente ce panneau.</p>'}`;
}

export function readIntelligenceReview({ action, observationId, expectedRevision, fact, outThroughWeek, roleWeeks, validForHours, verified, week, kind }) {
  if (action === 'revoke') return { payload: { action, observationId, expectedRevision, kind } };
  if (!verified) return { error: 'Lis la source et confirme explicitement le fait avant de valider.' };
  const [type, choice] = (fact || '').split(':');
  let value;
  if (type === 'STATUS' && ['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus'].includes(choice)) value = { injuryStatus: choice };
  else if (type === 'INJURY' && choice === 'SEASON') value = { seasonEndingConfirmed: true };
  else if (type === 'INJURY' && choice === 'WINDOW' && outThroughWeek !== '' && Number.isInteger(Number(outThroughWeek)) && Number(outThroughWeek) >= week && Number(outThroughWeek) <= 18) value = { outThroughWeek: Number(outThroughWeek) };
  else if (type === 'RETURN' && choice === 'CLEARED') value = { clearedForWeek: week };
  else if (type === 'ROLE' && Object.hasOwn(roles, choice) && Number.isInteger(Number(roleWeeks)) && Number(roleWeeks) >= 1 && Number(roleWeeks) <= 19 - week) value = { announcedRole: choice, roleWeeks: Number(roleWeeks) };
  if (!value) return { error: 'Choisis un fait et, si nécessaire, une durée valide.' };
  const hours = Number(validForHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return { error: 'Durée de validité invalide.' };
  return { payload: { action: 'confirm', observationId, expectedRevision, kind: type, value, validForHours: hours, verified: true } };
}
