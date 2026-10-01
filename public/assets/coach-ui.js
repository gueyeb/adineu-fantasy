import { LEAGUE_METADATA_2026 } from "./league-settings.js";

const login = document.getElementById("coach-login");
const gate = document.getElementById("coach-gate");
const report = document.getElementById("coach-report");
const status = document.getElementById("coach-status");
const message = document.getElementById("coach-message");
let currentPlan = null;

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const signed = value => `${Number(value) >= 0 ? "+" : ""}${value ?? "n/d"}`;

function savedPreferences(rosterId) {
  if (!rosterId) return {};
  try {
    const key = `adineu:trade-preferences:${LEAGUE_METADATA_2026.season}:${LEAGUE_METADATA_2026.leagueId}:${rosterId}`;
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function waiverCard(player) {
  return `<article class="coach-waiver">
    <div class="coach-waiver-head"><span>${escapeHtml(player.decisionClass?.replaceAll("_", " "))}</span><strong>${escapeHtml(player.position)}</strong></div>
    <h3>${escapeHtml(player.name)}</h3>
    <p>${escapeHtml(player.nflTeam || "FA")} · gain net <b>${signed(player.netGain)} pt/sem</b></p>
    <dl><div><dt>Coupe</dt><dd>${escapeHtml(player.dropCandidate?.name || "Aucune")}</dd></div><div><dt>Max Boukki</dt><dd>${player.maxForTeam ?? 0} $</dd></div></dl>
    <small>${escapeHtml(player.interpretation)}</small>
  </article>`;
}

function renderPlan(plan) {
  currentPlan = plan;
  const record = plan.teamState.record || { wins: 0, losses: 0, ties: 0 };
  const opponent = plan.nextMatchup?.opponent;
  document.getElementById("coach-week").textContent = `Semaine ${plan.week}`;
  document.getElementById("coach-title").textContent = plan.team;
  document.getElementById("coach-scoreboard").innerHTML = `
    <div><span>Bilan</span><strong>${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}</strong><small>Seed ${plan.teamState.rank}/${plan.teamState.leagueTeams}</small></div>
    <div><span>FAAB restant</span><strong>${plan.teamState.faab?.remaining ?? "—"} $</strong><small>sur ${plan.teamState.faab?.budget ?? "—"} $ · ${escapeHtml(plan.teamState.faabPosture)}</small></div>
    <div><span>Urgence playoffs</span><strong>${escapeHtml(plan.teamState.playoffUrgency)}</strong><small>8 places · estimation par règles</small></div>
    <div><span>Prochain duel</span><strong>${escapeHtml(opponent?.teamName || "À venir")}</strong><small>${opponent?.record ? `${opponent.record.wins}-${opponent.record.losses}` : "Données Sleeper"}</small></div>`;

  document.getElementById("coach-priorities").innerHTML = plan.priorities.map((priority, index) => `<article class="coach-priority coach-${priority.level.toLowerCase()}">
    <span>0${index + 1} / ${escapeHtml(priority.type)}</span><h2>${escapeHtml(priority.title)}</h2><p>${escapeHtml(priority.detail)}</p>
  </article>`).join("");

  const optimal = plan.lineup.optimal;
  const changes = (optimal?.changes || []).map(change => `<li><b>${escapeHtml(change.slot)}</b><span>${escapeHtml(change.in?.name || "Slot vide")} <i>à la place de</i> ${escapeHtml(change.out?.name || "Slot vide")}</span><strong>${signed(change.gain)}</strong></li>`).join("");
  const lineupBody = changes || (plan.lineup.alerts.length ? plan.lineup.alerts.map(alert => `<li><b>${escapeHtml(alert.slot)}</b><span>${escapeHtml(alert.reason)}</span></li>`).join("") : `<p class="coach-empty">Lineup déjà optimale. Aucun point facile laissé sur le banc.</p>`);
  const actionable = [...plan.waiverActions.ADD_NOW, ...plan.waiverActions.CLAIM_IF_CHEAP];
  const watchlist = plan.watchlist || [];
  const cuts = (plan.cutCandidates || []).map(player => `<li><span><b>${escapeHtml(player.name)}</b><small>Usage ${player.usageScore ?? "—"} · bye S${player.byeWeek ?? "—"}</small></span><strong>${player.totalCostPerWeek ?? "—"}<small> pt/sem</small></strong><em class="risk-${String(player.regretRisk).toLowerCase()}">${escapeHtml(player.regretRisk)}</em></li>`).join("");
  const trade = plan.tradeTarget;

  document.getElementById("coach-grid").innerHTML = `
    <section class="coach-panel coach-lineup"><header><span>01</span><div><p>Décision immédiate</p><h2>LINEUP</h2></div><strong>${optimal?.gain ? `+${optimal.gain} pts` : "OK"}</strong></header><ul>${lineupBody}</ul></section>
    <section class="coach-panel coach-waivers"><header><span>02</span><div><p>Coût de coupe inclus</p><h2>WAIVERS</h2></div><strong>${actionable.length} action${actionable.length > 1 ? "s" : ""}</strong></header><div class="coach-waiver-grid">${actionable.length ? actionable.map(waiverCard).join("") : `<p class="coach-empty">Aucun ajout ne justifie une coupe aujourd’hui.</p>`}</div></section>
    <section class="coach-panel"><header><span>03</span><div><p>Potentiel sans urgence</p><h2>WATCHLIST</h2></div><strong>${watchlist.length}</strong></header><div class="coach-watch">${watchlist.length ? watchlist.map(player => `<div><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.decisionClass?.replaceAll("_", " "))}</span><p>${escapeHtml(player.interpretation)}</p></div>`).join("") : `<p class="coach-empty">Aucun profil asymétrique détecté.</p>`}</div></section>
    <section class="coach-panel"><header><span>04</span><div><p>Valeur du banc protégée</p><h2>COUPES</h2></div><strong>${plan.cutCandidates.length}</strong></header><ol class="coach-cuts">${cuts || `<p class="coach-empty">Aucune coupe calculable.</p>`}</ol></section>
    <section class="coach-panel coach-trade"><header><span>05</span><div><p>Négociation optionnelle</p><h2>TRADE</h2></div><strong>${trade ? "À explorer" : "HOLD"}</strong></header>${trade ? `<div class="coach-trade-body"><p>Partenaire</p><h3>${escapeHtml(trade.partnerName)}</h3><strong>${escapeHtml(trade.title)}</strong><a href="/trades/">Ouvrir dans le Trade Finder →</a></div>` : `<p class="coach-empty">Aucun échange prioritaire ne surpasse les options internes.</p>`}</section>`;

  message.textContent = plan.message;
  gate.hidden = true;
  report.hidden = false;
  status.textContent = `Données jusqu’à S${plan.dataThroughWeek ?? "—"} · actualisé ${new Date(plan.generatedAt).toLocaleString("fr-FR")}${Object.keys(plan.preferences || {}).length ? " · préférences Trade Finder appliquées" : ""}`;
}

async function fetchCoach(preferences = {}) {
  const headers = Object.keys(preferences).length ? { "x-coach-preferences": JSON.stringify(preferences) } : {};
  const response = await fetch("/api/coach", { cache: "no-store", credentials: "same-origin", headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Le coaching est temporairement indisponible. Réessaie dans un instant.");
  return response.json();
}

async function loadCoach() {
  status.textContent = "Analyse de la lineup, du marché et des trades…";
  try {
    let plan = await fetchCoach();
    if (!plan) {
      gate.hidden = false; login.hidden = false; report.hidden = true; message.textContent = "";
      status.textContent = "Identifie-toi pour consulter ton coaching.";
      return;
    }
    const preferences = savedPreferences(plan.rosterId);
    if (Object.keys(preferences).length) plan = await fetchCoach(preferences);
    renderPlan(plan);
  } catch (error) { status.textContent = error.message; }
}

login.addEventListener("submit", async event => {
  event.preventDefault();
  const field = document.getElementById("coach-password");
  const button = login.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/coach-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: field.value }), credentials: "same-origin" });
    field.value = "";
    if (!response.ok) { status.textContent = response.status === 429 ? "Trop de tentatives. Réessaie dans 15 minutes." : response.status === 503 ? "Accès privé non configuré." : "Mot de passe incorrect."; return; }
    await loadCoach();
  } catch { status.textContent = "Connexion impossible. Réessaie."; } finally { button.disabled = false; }
});
document.getElementById("coach-refresh").addEventListener("click", loadCoach);
document.getElementById("coach-copy").addEventListener("click", async event => {
  if (!currentPlan) return;
  await navigator.clipboard.writeText(currentPlan.message);
  const button = event.currentTarget; button.textContent = "Plan copié"; setTimeout(() => { button.textContent = "Copier le plan"; }, 1800);
});
document.getElementById("coach-logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/coach-session?logout=1", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    currentPlan = null; message.textContent = ""; report.hidden = true; gate.hidden = false; login.hidden = false; status.textContent = "Déconnecté.";
  } catch { status.textContent = "Déconnexion impossible. Réessaie."; }
});
loadCoach();
