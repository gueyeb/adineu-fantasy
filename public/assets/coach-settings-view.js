/**
 * Adineu Fantasy — rendu du panneau Réglages du Coach privé (docs/prd-coach-settings.md).
 * Pur : prend la réponse de GET /api/coach/settings et rend du HTML échappé, sans DOM ni réseau.
 */
export const OWNER_NAME_MAX = 40;
export const NEAR_KICKOFF_HOURS = { min: 0.5, max: 24, step: 0.5 };

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const SOURCE = {
  SAVED: "Réglages enregistrés",
  DEFAULT: "Aucun réglage enregistré : valeurs par défaut",
  UNAVAILABLE: "Stockage des réglages indisponible : valeurs par défaut, enregistrement impossible"
};
const TEAM_SOURCE = { PARAM: "paramètre de l’appel", SETTINGS: "réglage enregistré", ENV: "variable COACH_TEAM", DEFAULT: "défaut t0z" };
const PLATFORM = { sleeper: "Sleeper", yahoo: "Yahoo", nfl: "NFL" };

function teamField(data) {
  const selected = data.settings?.teamRosterId ?? null;
  const resolved = data.resolvedTeam ? `Équipe utilisée maintenant : ${escapeHtml(data.resolvedTeam.team)} (${TEAM_SOURCE[data.resolvedTeam.source] || escapeHtml(data.resolvedTeam.source)}).` : "";
  if (!Array.isArray(data.teams)) {
    return `<p class="coach-empty">Liste des équipes Sleeper indisponible.${selected ? ` Roster enregistré : #${selected}.` : ""}</p><p class="war-note">${resolved}</p>`;
  }
  const options = [`<option value=""${selected === null ? " selected" : ""}>Par défaut (COACH_TEAM ou t0z)</option>`,
    ...data.teams.map(team => `<option value="${team.rosterId}"${team.rosterId === selected ? " selected" : ""}>${escapeHtml(team.label)}</option>`)];
  const missing = selected !== null && !data.teams.some(team => team.rosterId === selected)
    ? `<p class="coach-empty">Le roster enregistré #${selected} n’existe plus dans la ligue : le Coach refusera de le suivre.</p>` : "";
  return `<label>Équipe suivie<select name="teamRosterId">${options.join("")}</select></label>${missing}
    <p class="war-note">${resolved} Un appel n8n qui précise <code>team=</code> reste prioritaire.</p>`;
}

function bulletinFields(settings = {}) {
  const { min, max, step } = NEAR_KICKOFF_HOURS;
  return `<label><input type="checkbox" name="deltaByDefault"${settings.deltaByDefault ? " checked" : ""}> Bulletins « changements seulement » par défaut</label>
    <p class="war-note">S’applique aux appels n8n sans <code>delta</code> ; <code>delta=1</code> ou <code>delta=0</code> dans l’URL restent prioritaires.</p>
    <label>Alerte avant coup d’envoi (heures)<input type="number" name="nearKickoffHours" min="${min}" max="${max}" step="${step}" value="${escapeHtml(settings.nearKickoffHours ?? 3)}"></label>`;
}

function ownerRows(owners) {
  if (!Array.isArray(owners)) return `<p class="coach-empty">Liste des managers indisponible.</p>`;
  if (!owners.length) return `<p class="coach-empty">Aucun manager enregistré.</p>`;
  return `<ol class="journal-list">${owners.map(owner => `<li class="journal-entry">
    <div><b>${escapeHtml(owner.displayName)}</b>${owner.accounts.length ? ` · ${owner.accounts.map(account => `${PLATFORM[account.platform] || escapeHtml(account.platform)} @${escapeHtml(account.name ?? "?")}`).join(" · ")}` : ""}</div>
    <small>Alias confirmés : ${owner.confirmedAliases.length ? owner.confirmedAliases.map(alias => `@${escapeHtml(alias)}`).join(", ") : "aucun"}</small>
    <form class="journal-reason" data-owner-id="${escapeHtml(owner.id)}" data-owner-name="${escapeHtml(owner.displayName)}"><input type="text" maxlength="${OWNER_NAME_MAX}" value="${escapeHtml(owner.displayName)}" aria-label="Nom affiché de ${escapeHtml(owner.displayName)}" required><button class="coach-secondary" type="submit">Renommer</button></form>
  </li>`).join("")}</ol>`;
}

export function renderCoachSettings(data = {}) {
  const writable = data.source !== "UNAVAILABLE";
  return `<p class="war-note">${SOURCE[data.source] || escapeHtml(data.source)}${data.updatedAt ? ` · mis à jour ${escapeHtml(new Date(data.updatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}` : ""}.</p>
    <form id="coach-settings-form" class="coach-settings-form">
      <h3>Équipe et bulletins</h3>
      ${teamField(data)}
      ${bulletinFields(data.settings)}
      <button class="coach-secondary" type="submit"${writable ? "" : " disabled"}>Enregistrer les réglages</button>
    </form>
    <h3>Managers</h3>
    <p class="war-note">Nom affiché partout sur le site (classements, Power Rankings, historique). Chaque renommage est journalisé avec l’ancien nom. Les alias rattachent un compte à une identité confirmée : en ajouter un reste un changement de code relu, jamais une saisie libre.</p>
    ${ownerRows(data.owners)}`;
}

/** Form → PUT payload; returns { error } instead of sending an invalid value. */
export function readSettingsForm({ teamRosterId, deltaByDefault, nearKickoffHours }) {
  const hours = Number(nearKickoffHours);
  const { min, max, step } = NEAR_KICKOFF_HOURS;
  if (!Number.isFinite(hours) || hours < min || hours > max || Math.abs(hours / step - Math.round(hours / step)) > 1e-9) {
    return { error: `Alerte avant coup d’envoi : ${min} à ${max} h, par pas de ${step} h.` };
  }
  return { payload: { teamRosterId: teamRosterId === "" || teamRosterId == null ? null : Number(teamRosterId), deltaByDefault: Boolean(deltaByDefault), nearKickoffHours: hours } };
}

const RENAME_MESSAGES = {
  NOM_INVALIDE: "Nom invalide (1 à 40 caractères).",
  NOM_DEJA_UTILISE: "Ce nom est déjà utilisé par un autre manager.",
  NOM_MODIFIE_ENTRE_TEMPS: "Le nom a changé entre-temps : recharge les réglages.",
  NOM_INCHANGE: "Nom inchangé.",
  PROPRIETAIRE_INCONNU: "Manager introuvable.",
  OWNER_RENAME_UNAVAILABLE: "Renommage indisponible (migration non appliquée ?)."
};
export const renameMessage = code => RENAME_MESSAGES[code] || "Échec du renommage.";
