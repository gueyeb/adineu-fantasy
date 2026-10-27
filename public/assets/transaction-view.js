/** Render existing transaction evidence; never infer ownership from an add/drop alone. */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const statuses = { complete: "Terminé", pending: "En attente", failed: "Échoué", canceled: "Annulé", cancelled: "Annulé" };
const types = { waiver: "Waivers", free_agent: "Mouvement libre", trade: "Trade", commissioner: "Intervention du commissaire" };
export function renderRecentTransactions(transactions = [], { playerFor = () => null, rosterFor = () => null } = {}) {
  if (!transactions.length) return '<p>Aucune transaction dans la fenêtre du rapport.</p>';
  return transactions.map(transaction => {
    const completed = transaction.status === "complete";
    const at = transaction.status_updated ?? transaction.created;
    const timestamp = at !== null && at !== undefined && at !== "" ? Number(at) : NaN;
    const date = Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp)) + " Paris" : "Date non confirmée";
    const movements = Array.isArray(transaction.movements) && transaction.movements.length ? transaction.movements.filter(row => row && typeof row === "object") : ['ADD', 'DROP'].flatMap(action => Object.entries((action === 'ADD' ? transaction.adds : transaction.drops) || {}).map(([playerId, rosterId]) => ({ action, playerId, rosterId })));
    const bid = transaction.settings?.waiver_bid;
    const teamName = id => { const team = rosterFor(id); return team?.teamName || team?.name || null; };
    const rows = movements.map(movement => {
      const playerName = movement.playerName || playerFor(String(movement.playerId))?.name || "Joueur non identifié";
      const team = movement.teamName || teamName(movement.rosterId) || "Équipe non identifiée";
      const action = { ADD: completed ? "Ajout" : "Ajout demandé", DROP: completed ? "Coupe" : "Coupe demandée" }[movement.action] || "Mouvement non identifié";
      const currentTeam = movement.currentOwnerRosterId !== null && movement.currentOwnerRosterId !== undefined ? teamName(movement.currentOwnerRosterId) : null;
      return `<li><strong>${escape(playerName)}</strong> · ${action} · ${escape(team)}${currentTeam ? ` · actuellement chez ${escape(currentTeam)} (roster relu)` : ""}</li>`;
    }).join("");
    return `<article class="card" style="padding:12px;margin:8px 0;"><p><strong>${types[transaction.type] || "Transaction"} · ${statuses[transaction.status] || "Statut non confirmé"}</strong> · ${escape(date)}${transaction.relevant ? " · concerne le roster ou les candidats" : ""}</p>
      ${!completed ? '<p>Cette demande ne prouve pas qu’un mouvement a été exécuté.</p>' : ""}
      ${rows ? `<ul>${rows}</ul>` : '<p>Aucun détail de mouvement de joueur disponible.</p>'}
      ${transaction.type === "waiver" && typeof bid === "number" && Number.isFinite(bid) && bid >= 0 ? `<p>${completed ? "FAAB dépensé" : "Enchère demandée"} : ${escape(bid)} $</p>` : ""}
      <details><summary>Identifiants de la source</summary><p>Transaction : ${escape(transaction.transaction_id || "non disponible")}</p><ul>${movements.map(m => `<li>Joueur : ${escape(m.playerId)} · roster : ${escape(m.rosterId)} · ${escape(m.action)}</li>`).join("")}</ul></details></article>`;
  }).join("") + '<p>Une coupe ne prouve pas une disponibilité immédiate. La propriété actuelle provient d’une lecture séparée des rosters ; les sources ne sont pas atomiques.</p>';
}
