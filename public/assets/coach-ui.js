import { addToWatchlist, buildWarRoom, formatClaimOrder, recordBids, removeFromWatchlist, watchIdsHeader, REASON_MAX } from "./war-room.js?v=e9eae48675";
import { loadBidHistory, loadWatchlist, saveBidHistory, saveWatchlist, syncWarRoom } from "./war-room-store.js?v=7fbca3341a";
import { renderWeeklyRoster, renderWeeklyMoves } from "./coach-week-view.js?v=cc2b0d0bd8";
import { LEAGUE_METADATA_2026 } from "./league-settings.js?v=f6d1bf5212";
import { formatAuction } from "./faab-auction.js?v=1eea51c520";
import { REASON_MAX as JOURNAL_REASON_MAX } from "./decision-log.js?v=a0e3f31155";

const login = document.getElementById("coach-login");
const gate = document.getElementById("coach-gate");
const report = document.getElementById("coach-report");
const status = document.getElementById("coach-status");
const message = document.getElementById("coach-message");
let currentPlan = null;
let currentWarRoom = null;
const ROSTER_HINT_KEY = "adineu:coach-roster";

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const signed = value => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value}` : "n/d";

function savedPreferences(rosterId) {
  if (!rosterId) return {};
  try {
    const key = `adineu:trade-preferences:${LEAGUE_METADATA_2026.season}:${LEAGUE_METADATA_2026.leagueId}:${rosterId}`;
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const playerIdOf = player => String(player.playerId ?? player.sleeperId ?? "");
const day = value => new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dollars = value => Number.isFinite(value) ? `${value} $` : "n/d";

/** Follow / unfollow control; the reason is asked inline (see the click handler on the grid). */
function followButton(player, followedIds) {
  const id = playerIdOf(player);
  if (!id) return "";
  return followedIds.has(id) ? `<span class="war-followed">Suivi</span>`
    : `<button class="war-follow" type="button" data-follow="${escapeHtml(id)}" data-name="${escapeHtml(player.name)}" data-position="${escapeHtml(player.position)}">+ Suivre</button>`;
}

const weeklyChips = line => line.weeklyDeltas.length ? `<p class="war-weeks">${line.weeklyDeltas.map(row =>
  `<span>S${row.week} <b>${Number.isFinite(row.delta) ? signed(row.delta) : "n/d"}</b></span>`).join("")}</p>` : "";
const revisionText = line => !line.revision ? "Pas de relevé antérieur."
  : `${line.revision.basis === "BEFORE_LAST_GAMES" ? "Avant les derniers matchs" : "Premier relevé"} (${day(line.revision.at)}) : ` +
    (line.revision.changed ? `enchère ${dollars(line.revision.bidBefore)} → ${dollars(line.bid)} · plafond ${dollars(line.revision.maxBefore)} → ${dollars(line.maxBid)}` : "inchangée");
const lineSummary = line => `Enchère ${dollars(line.bid)} · plafond ${dollars(line.maxBid)} · coupe ${escapeHtml(line.drop?.name || "aucune")} · gain net ${signed(line.netGainTotal)} pts / ${line.horizonWeeks ?? "n/d"} sem`;
const WATCH_STATES = { IN_PLAN: "Dans le plan", FALLBACK: "Repli du plan", EVALUATED: "Évalué", ROSTERED: "Déjà pris", NOT_IN_POOL: "Hors pool", NOT_EVALUATED: "À actualiser" };

function warRoomPanel(warRoom, followedIds) {
  const watch = warRoom.watch.map(entry => `<article class="war-watch war-${entry.state.toLowerCase()}">
    <div class="war-watch-head"><b>${escapeHtml(entry.name)}</b><small>${escapeHtml([entry.position, entry.line?.nflTeam].filter(Boolean).join(" · "))}</small><span>${WATCH_STATES[entry.state]}${entry.state === "ROSTERED" && entry.rosteredBy ? ` · ${escapeHtml(entry.rosteredBy)}` : ""}</span></div>
    <p class="war-reason">« ${escapeHtml(entry.reason)} » — suivi depuis le ${day(entry.addedAt)}${entry.week ? ` (S${entry.week})` : ""}</p>
    ${entry.line ? `<p>${lineSummary(entry.line)}${entry.line.action ? ` · ${escapeHtml(entry.line.action.replaceAll("_", " "))}` : ""}</p>${entry.line.note ? `<p>${escapeHtml(entry.line.note)}</p>` : ""}${weeklyChips(entry.line)}<p class="war-revision">${revisionText(entry.line)}</p>` : ""}
    <button class="coach-quiet" type="button" data-unfollow="${escapeHtml(entry.playerId)}">Retirer</button>
  </article>`).join("");
  const groups = warRoom.cutGroups.map(group => `<article class="war-group${group.competing ? " war-competing" : ""}">
    <h4>Coupe ${escapeHtml(group.dropName)} <small>${group.competing ? `${group.lines.length} claims concurrents · un seul peut aboutir · enchère max ${dollars(group.maximumBid)}` : "un seul claim"}</small></h4>
    <ol>${group.lines.map(line => `<li><span><b>${escapeHtml(line.name)}</b> <small>${escapeHtml(line.position)} · ${({ PLAN: "plan", FALLBACK: "repli", OUT_OF_PLAN: "hors plan" })[line.role]}</small>${weeklyChips(line)}</span><strong>${dollars(line.bid)}<small>net ${signed(line.netGainTotal)} pts</small></strong>${followButton(line, followedIds)}</li>`).join("")}</ol>
  </article>`).join("");
  const revisions = warRoom.revisions.map(line => `<li><b>${escapeHtml(line.name)}</b><span>${revisionText(line)}</span><strong>${Number.isFinite(line.revision.bidDelta) ? `${signed(line.revision.bidDelta)} $` : "n/d"}</strong></li>`).join("");
  return `<section class="coach-panel coach-war-room"><header><span>06</span><div><p>Du repérage à la saisie · lecture seule</p><h2>WAR ROOM</h2></div><strong>${warRoom.watch.length} suivi${warRoom.watch.length > 1 ? "s" : ""}</strong></header>
    <div class="war-grid">
      <div><h3>Watchlist</h3>${watch || `<p class="coach-empty">Aucun joueur suivi. Utilise « + Suivre » sur une carte pour le garder à l’œil avec un motif daté.</p>`}</div>
      <div><h3>Claims par joueur à couper</h3>${groups || `<p class="coach-empty">Aucun claim ne désigne de coupe.</p>`}
        <h3>Révision des enchères</h3>${revisions ? `<ul class="war-revisions">${revisions}</ul><p class="war-note">Entre deux relevés la semaine cible avance : l’écart mêle nouvelles données et horizon plus court d’une semaine.</p>` : `<p class="coach-empty">Aucune enchère modifiée depuis le relevé de référence (données jusqu’à S${warRoom.dataThroughWeek ?? "—"}).</p>`}</div>
      <div class="war-order"><h3>Ordre à saisir dans Sleeper</h3><pre id="war-order-text">${escapeHtml(formatClaimOrder(warRoom))}</pre><button id="war-copy" class="coach-secondary" type="button">Copier l’ordre</button></div>
    </div></section>`;
}

function waiverCard(player, followedIds = new Set()) {
  return `<article class="coach-waiver">
    <div class="coach-waiver-head"><span>${escapeHtml(player.decisionClass?.replaceAll("_", " "))}</span><strong>${escapeHtml(player.position)}</strong></div>
    <h3>${escapeHtml(player.name)}</h3>
    <p>${escapeHtml(player.nflTeam || "FA")} · delta semaine <b>${signed(player.targetWeekDelta)} pts</b><br>Gain net total ${signed(player.netGainTotal)} pts sur ${player.horizonWeeks ?? "n/d"} sem</p>
    <dl><div><dt>Coupe</dt><dd>${escapeHtml(player.dropCandidate?.name || "Aucune")}</dd></div><div><dt>Enchère proposée</dt><dd>${Number.isFinite(player.suggestedBid) ? `${player.suggestedBid} $` : "non déterminée"}</dd></div><div><dt>Plafond Boukki</dt><dd>${Number.isFinite(player.maxForTeam) ? `${player.maxForTeam} $` : "non déterminé"}</dd></div></dl>
    ${player.auction ? `<small>Rivaux : ${escapeHtml(formatAuction(player.auction))} (estimation non calibrée).</small><br>` : ""}
    ${player.preferenceOverridden ? `<small>Préférence temporaire dépassée : ${escapeHtml(player.appliedPreference?.reason)} (${player.preferencePenaltyTotal} points d’utilité).</small><br>` : ""}
    <small>${escapeHtml(player.availability?.availability || "UNKNOWN")}${player.availability?.availabilitySource === "LEAGUE_RULES_INFERRED" ? " (déduite — à confirmer dans Sleeper)" : ""} · ${escapeHtml(player.roleConfirmation || "UNCONFIRMED")}</small><br><small>${escapeHtml(player.interpretation)}</small><br>${followButton(player, followedIds)}
  </article>`;
}

function renderPlan(plan) {
  currentPlan = plan;
  document.getElementById("coach-week-roster").innerHTML = renderWeeklyRoster(plan);
  document.getElementById("coach-week-moves").innerHTML = renderWeeklyMoves(plan);
  for (const button of document.querySelectorAll("[data-coach-lineup]")) button.setAttribute("aria-pressed", String(button.dataset.coachLineup === "current"));
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
  const lineupBody = changes || (plan.lineup.alerts.length ? plan.lineup.alerts.map(alert => `<li><b>${escapeHtml(alert.slot)}</b><span>${escapeHtml(alert.reason)}${alert.advice ? ` — ${escapeHtml(alert.advice)}` : ""}</span></li>`).join("") : `<p class="coach-empty">Lineup déjà optimale. Aucun point facile laissé sur le banc.</p>`);
  const actionable = plan.acquisitionPlan ? plan.acquisitionPlan.steps.map(step => ({ ...step, maxForTeam: step.personalMaxBid, decisionClass: "PLAN_CONDITIONNEL" })) : [...plan.waiverActions.ADD_NOW, ...plan.waiverActions.CLAIM_IF_CHEAP];
  const watchlist = plan.watchlist || [];
  const followed = loadWatchlist(plan.rosterId);
  const followedIds = new Set(followed.map(entry => entry.playerId));
  const history = recordBids(loadBidHistory(plan.rosterId), buildWarRoom({ rows: plan.warRoom?.rows, acquisitionPlan: plan.acquisitionPlan }).lines,
    { now: plan.generatedAt, dataThroughWeek: plan.dataThroughWeek ?? null });
  saveBidHistory(plan.rosterId, history);
  currentWarRoom = buildWarRoom({ watchlist: followed, rows: plan.warRoom?.rows, missing: plan.warRoom?.missing, acquisitionPlan: plan.acquisitionPlan,
    history, week: plan.week, dataThroughWeek: plan.dataThroughWeek ?? null });
  const cuts = (plan.cutCandidates || []).map(player => `<li><span><b>${escapeHtml(player.name)}</b><small>Usage ${player.usageScore ?? "—"} · bye S${player.byeWeek ?? "—"}</small></span><strong>${player.ranked === false || player.dropCostComponents?.optionCoverage === "NONE" ? "coût inconnu" : `${player.totalCostPerWeek ?? "—"}<small> pt/sem</small>`}</strong><em class="risk-${String(player.regretRisk).toLowerCase()}">${escapeHtml(player.regretRisk)}</em></li>`).join("");
  const trade = plan.tradeTarget;

  document.getElementById("coach-grid").innerHTML = `
    <section class="coach-panel coach-lineup"><header><span>01</span><div><p>Décision immédiate</p><h2>LINEUP</h2></div><strong>${optimal?.gain ? `+${optimal.gain} pts` : "OK"}</strong></header><ul>${lineupBody}</ul></section>
    <section class="coach-panel coach-waivers"><header><span>02</span><div><p>Coût de coupe inclus</p><h2>WAIVERS</h2></div><strong>${actionable.length} action${actionable.length > 1 ? "s" : ""}</strong></header><p>Plan conditionnel : suppose les ajouts précédents, avec roster et budget recalculés. Vérifier après chaque résultat.</p><div class="coach-waiver-grid">${actionable.length ? actionable.map(player => waiverCard(player, followedIds)).join("") : `<p class="coach-empty">Aucune acquisition exécutable confirmée aujourd’hui. Consulte les scénarios conditionnels.</p>`}</div></section>
    <section class="coach-panel"><header><span>03</span><div><p>Potentiel sans urgence</p><h2>WATCHLIST</h2></div><strong>${watchlist.length}</strong></header><div class="coach-watch">${watchlist.length ? watchlist.map(player => `<div><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.decisionClass?.replaceAll("_", " "))}</span><p>${escapeHtml(player.interpretation)}</p>${followButton(player, followedIds)}</div>`).join("") : `<p class="coach-empty">Aucun profil asymétrique détecté.</p>`}</div></section>
    <section class="coach-panel"><header><span>04</span><div><p>Valeur du banc protégée</p><h2>COUPES</h2></div><strong>${plan.cutCandidates.length}</strong></header><ol class="coach-cuts">${cuts || `<p class="coach-empty">Aucune coupe calculable.</p>`}</ol></section>
    <section class="coach-panel coach-trade"><header><span>05</span><div><p>Négociation optionnelle</p><h2>TRADE</h2></div><strong>${trade ? "À explorer" : "HOLD"}</strong></header>${trade ? `<div class="coach-trade-body"><p>Partenaire</p><h3>${escapeHtml(trade.partnerName)}</h3><strong>${escapeHtml(trade.title)}</strong><a href="/trades/">Ouvrir dans le Trade Finder →</a></div>` : `<p class="coach-empty">Aucun échange prioritaire ne surpasse les options internes.</p>`}</section>
    ${warRoomPanel(currentWarRoom, followedIds)}`;

  const sosPanel = document.getElementById("coach-sos");
  if (sosPanel) sosPanel.innerHTML = `<header><div><p>Contexte WR · projections inchangées</p><h2>CALENDRIER ROS</h2></div><a href="/sos/">Explorer →</a></header><p>${escapeHtml(plan.sos?.explanation || "SOS indisponible ; décisions habituelles conservées.")}</p><small>${escapeHtml(plan.sos?.asOf || plan.sos?.reason || "SOS_UNAVAILABLE")} · ${escapeHtml(plan.sos?.snapshotId?.slice(0, 12) || "—")}</small><ul>${(plan.sos?.players || []).map(row => `<li><b>${escapeHtml(row.name)} · ${escapeHtml(row.nflTeam)}</b><span>${row.sos ? `Rang ${row.sos.rank} · ${row.sos.sosScore} WR PPR concédés/match ajustés · ${row.sos.coveredGames}/${row.sos.gamesInWindow} couverts · ${escapeHtml(row.sos.difficulty || "signal indisponible")}<br>Prochains : ${row.sos.opponents.slice(0, 3).map(game => `S${game.week} ${escapeHtml(game.opponent)}`).join(" · ")}` : escapeHtml(row.reason)}</span><small>${row.scope === "ROSTER" ? "Roster" : "Waivers"}</small></li>`).join("")}</ul>`;
  message.textContent = plan.message;
  gate.hidden = true;
  report.hidden = false;
  status.textContent = `Données jusqu’à S${plan.dataThroughWeek ?? "—"} · actualisé ${new Date(plan.generatedAt).toLocaleString("fr-FR")}${Object.keys(plan.preferences || {}).length ? " · préférences Trade Finder appliquées" : ""}`;
}

const JOURNAL_KIND = { CLAIM_WON: "Claim gagné", CLAIM_LOST: "Claim perdu", FREE_ADD: "Ajout libre", DROP: "Coupe", TRADE: "Trade", LINEUP: "Lineup" };
const JOURNAL_MODEL = { RECOMMENDED: "recommandé par le modèle", NOT_RECOMMENDED: "évalué, non recommandé", NOT_ON_BOARD: "hors du tableau du modèle", NO_MODEL_RECORD: "pas de plan enregistré" };
const names = players => players.map(player => escapeHtml(player.name)).join(" + ");

function journalOutcome(entry) {
  const outcome = entry.outcome;
  if (!outcome || outcome.status === "PENDING") return "en attente du match";
  if (entry.kind === "LINEUP") return `${outcome.actualPoints} pts sur ${outcome.optimalPoints} possibles · <b>${outcome.pointsLeft} laissés au banc</b>`;
  const window = `S${outcome.fromWeek}–S${outcome.throughWeek}${outcome.status === "PARTIAL" ? " (partiel)" : ""}`;
  if (entry.kind === "CLAIM_LOST") return `${window} : il a marqué ${outcome.addedPoints} pts${entry.lostTo ? ` · parti à ${entry.lostTo.bid} $` : ""}${entry.note === "INVALID_CLAIM" ? " · claim invalide (roster plein)" : ""}`;
  return `${window} : ajouté ${outcome.addedPoints} pts (${outcome.startedPoints ?? 0} titularisés) contre coupé ${outcome.droppedPoints} pts · <b>net ${signed(outcome.net)}</b>`;
}

function renderJournal(data) {
  const summary = data.summary || {};
  const rows = (data.entries || []).map(entry => `<li class="journal-entry">
    <div><b>S${entry.week ?? "?"} · ${JOURNAL_KIND[entry.kind] || escapeHtml(entry.kind)}</b>${entry.added.length ? ` ${names(entry.added)}` : ""}${entry.dropped.length ? ` <i>coupe</i> ${names(entry.dropped)}` : ""}${Number.isFinite(entry.bid) ? ` · ${entry.bid} $` : ""}</div>
    <small>${journalOutcome(entry)}${entry.model ? ` · ${JOURNAL_MODEL[entry.model.verdict] || escapeHtml(entry.model.verdict)}${Number.isFinite(entry.model.suggestedBid) ? ` (${entry.model.suggestedBid} $)` : ""}` : ""}</small>
    <form class="journal-reason" data-journal-id="${escapeHtml(entry.id)}"><input type="text" maxlength="${JOURNAL_REASON_MAX}" value="${escapeHtml(entry.reason || "")}" placeholder="Pourquoi ? (motif libre)" aria-label="Motif"><button class="coach-secondary" type="submit">Enregistrer</button></form>
  </li>`).join("");
  return `<p>${summary.moves ?? 0} mouvements · ${summary.claimsWon ?? 0} claims gagnés / ${summary.claimsLost ?? 0} perdus · ${summary.faabSpent ?? 0} $ dépensés · net des mouvements évalués ${signed(summary.netPointsFromMoves ?? 0)} pts (${summary.evaluatedMoves ?? 0}) · ${summary.lineupPointsLeft ?? "—"} pts laissés au banc sur ${summary.lineupWeeks ?? 0} semaines.</p>
    <p class="war-note">Net = points des joueurs ajoutés moins ceux des joueurs coupés, au barème de la ligue, sur 4 semaines à partir de la semaine du mouvement. Mis à jour chaque mardi.</p>
    <ol class="journal-list">${rows || `<p class="coach-empty">Journal vide : la synchronisation du mardi le remplit.</p>`}</ol>`;
}

async function loadJournal() {
  const target = document.getElementById("coach-journal");
  if (!currentPlan || !target) return;
  target.innerHTML = `<p class="coach-empty">Chargement…</p>`;
  try {
    const response = await fetch(`/api/coach/decisions?roster=${encodeURIComponent(currentPlan.rosterId)}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    target.innerHTML = renderJournal(await response.json());
  } catch { target.innerHTML = `<p class="coach-empty">Journal indisponible pour le moment.</p>`; }
}

async function fetchCoach(preferences = {}, watchIds = "") {
  const headers = { ...(Object.keys(preferences).length ? { "x-coach-preferences": JSON.stringify(preferences) } : {}), ...(watchIds ? { "x-coach-watchlist": watchIds } : {}) };
  const response = await fetch("/api/coach", { cache: "no-store", credentials: "same-origin", headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Le coaching est temporairement indisponible. Réessaie dans un instant.");
  return response.json();
}

async function loadCoach() {
  status.textContent = "Analyse de la lineup, du marché et des trades…";
  try {
    // The roster is only known from a first answer: remember it so the next load is a single request.
    let hint = null;
    try { hint = localStorage.getItem(ROSTER_HINT_KEY); } catch {}
    const sent = { preferences: savedPreferences(hint), watchIds: hint ? watchIdsHeader(loadWatchlist(hint)) : "" };
    let plan = await fetchCoach(sent.preferences, sent.watchIds);
    if (!plan) {
      gate.hidden = false; login.hidden = false; report.hidden = true; message.textContent = "";
      status.textContent = "Identifie-toi pour consulter ton coaching.";
      return;
    }
    try { localStorage.setItem(ROSTER_HINT_KEY, String(plan.rosterId)); } catch {}
    // Signed in: bring this browser in line with the watchlist kept on the server (other devices).
    await syncWarRoom(plan.rosterId);
    const preferences = savedPreferences(plan.rosterId);
    const watchIds = watchIdsHeader(loadWatchlist(plan.rosterId));
    if (JSON.stringify(preferences) !== JSON.stringify(sent.preferences) || watchIds !== sent.watchIds) plan = await fetchCoach(preferences, watchIds);
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
// War Room: follow asks for a dated reason inline, then re-evaluates; nothing is sent to Sleeper.
document.getElementById("coach-grid").addEventListener("click", async event => {
  const target = event.target.closest("button");
  if (!target || !currentPlan) return;
  if (target.dataset.follow) {
    const form = document.createElement("form");
    form.className = "war-follow-form";
    form.dataset.followForm = target.dataset.follow;
    form.dataset.name = target.dataset.name;
    form.dataset.position = target.dataset.position;
    form.innerHTML = `<input type="text" required maxlength="${REASON_MAX}" placeholder="Motif (ex. 9 cibles en S6)" aria-label="Motif du suivi"><button class="coach-secondary" type="submit">Suivre</button>`;
    target.replaceWith(form);
    form.querySelector("input").focus();
  } else if (target.dataset.unfollow) {
    saveWatchlist(currentPlan.rosterId, removeFromWatchlist(loadWatchlist(currentPlan.rosterId), target.dataset.unfollow));
    renderPlan(currentPlan);
  } else if (target.id === "war-copy") {
    await navigator.clipboard.writeText(formatClaimOrder(currentWarRoom));
    target.textContent = "Ordre copié"; setTimeout(() => { target.textContent = "Copier l’ordre"; }, 1800);
  }
});
document.getElementById("coach-grid").addEventListener("submit", event => {
  const form = event.target.closest("form[data-follow-form]");
  if (!form || !currentPlan) return;
  event.preventDefault();
  const reason = form.querySelector("input").value.trim();
  if (!reason) return;
  const saved = saveWatchlist(currentPlan.rosterId, addToWatchlist(loadWatchlist(currentPlan.rosterId),
    { playerId: form.dataset.followForm, name: form.dataset.name, position: form.dataset.position },
    { reason, now: new Date().toISOString(), week: currentPlan.week }));
  if (!saved) { status.textContent = "Stockage local indisponible : la watchlist ne peut pas être enregistrée."; return; }
  // A followed player outside the displayed top needs a server evaluation.
  if ((currentPlan.warRoom?.rows ?? []).some(row => String(row.sleeperId) === form.dataset.followForm) || currentWarRoom.lines.some(line => line.playerId === form.dataset.followForm)) renderPlan(currentPlan);
  else loadCoach();
});
document.getElementById("coach-logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/coach-session?logout=1", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    currentPlan = null; message.textContent = ""; report.hidden = true; gate.hidden = false; login.hidden = false; status.textContent = "Déconnecté.";
  } catch { status.textContent = "Déconnexion impossible. Réessaie."; }
});
document.getElementById("coach-journal-details")?.addEventListener("toggle", event => { if (event.currentTarget.open) loadJournal(); });
document.getElementById("coach-journal")?.addEventListener("submit", async event => {
  const form = event.target.closest("form[data-journal-id]");
  if (!form || !currentPlan) return;
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/coach/decisions", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rosterId: currentPlan.rosterId, id: form.dataset.journalId, reason: form.querySelector("input").value }) });
    button.textContent = response.ok ? "Enregistré" : "Échec";
  } catch { button.textContent = "Échec"; }
  setTimeout(() => { button.textContent = "Enregistrer"; button.disabled = false; }, 1500);
});
loadCoach();

for (const button of document.querySelectorAll("[data-coach-lineup]")) button.addEventListener("click", () => {
  if (!currentPlan) return;
  for (const other of document.querySelectorAll("[data-coach-lineup]")) other.setAttribute("aria-pressed", String(other === button));
  document.getElementById("coach-week-roster").innerHTML = renderWeeklyRoster(currentPlan, button.dataset.coachLineup === "suggested");
});
