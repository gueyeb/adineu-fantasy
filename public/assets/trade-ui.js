/**
 * Adineu Fantasy — Interface Utilisateur Trade Hub
 *
 * Gère le Calculateur de Trade interactif et le Moteur de Recommandations.
 */

import { calculatePlayerTradeValue, calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=3";
import { diagnoseRoster, findTradeProposals, findCounterOffers } from "./trade-recommender.js?v=6";
import { PLAYER_STATUSES, playerKey, playerStatus } from "./trade-preferences.js?v=1";
import {
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026
} from "./league-settings.js";
import { resolveOperationalWeek } from "./nfl-week.js?v=1";
import { listRosterIdentities } from "./roster-view.js?v=1";
import { calculateFaabRemaining } from "./team-metrics.js?v=2";
import { buildProjectedLineup, restOfSeasonEstimate } from "./trade-score.js?v=3";

const SLEEPER_LEAGUE_ID = "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export async function renderTradesPage(container) {
  container.innerHTML = `
    <section class="hero">
      <div class="shell">
        <p class="eyebrow">Adineu NFL · In-Season Market & Rules</p>
        <h1>Trade Hub</h1>
        <p class="lede">Calculateur de valeur déterministe, opportunités bilatérales et règles officielles de la saison 2026.</p>

        <div class="tabs-nav" role="tablist" aria-label="Outils de trade">
          <button id="tab-finder-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Trade Finder</button>
          <button id="tab-calc-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Trade Calculator</button>
          <button id="tab-waivers-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Waiver Wire</button>
          <button id="tab-advisor-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Start/Sit Advisor</button>
          <button id="tab-usage-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Usage & Buy-Low</button>
          <button id="tab-rules-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Règles & Scoring 2026</button>
        </div>
      </div>
    </section>

    <section class="section" id="trade-content">
      <div class="shell state">Chargement des rosters et du marché…</div>
    </section>
  `;

  // 1. Charger le catalogue, les données Sleeper, les projections et scores hebdomadaires
  let catalog = { players: [] };
  try {
    const catRes = await fetch("/data/players-catalog.json");
    if (catRes.ok) catalog = await catRes.json();
  } catch (e) {
    console.warn("Impossible de charger le catalogue local", e);
  }

  const playerMap = new Map();
  for (const p of catalog.players || []) {
    playerMap.set(p.sleeperId, p);
    playerMap.set(p.name, p);
  }

  let rosters = [];
  let users = [];
  let weeklyProjections = {};
  let currentWeek = null;
  let season = "2026";
  const playerWeeklyScores = new Map();
  // Statuts blessure Sleeper (Out/IR…), servis par notre API (le dump Sleeper fait ~15 Mo).
  const injuryStatuses = await fetch("/api/player-status")
    .then(res => res.ok ? res.json() : { statuses: {} })
    .then(body => body.statuses || {})
    .catch(() => ({}));

  try {
    const [rRes, uRes, stateRes] = await Promise.all([
      fetch(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/rosters`),
      fetch(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/users`),
      fetch(`${SLEEPER_API}/state/nfl`)
    ]);
    if (rRes.ok && uRes.ok) {
      rosters = await rRes.json();
      users = await uRes.json();
    }

    if (stateRes.ok) {
      const nflState = await stateRes.json();
      currentWeek = resolveOperationalWeek(nflState);
      season = nflState.season || "2026";

      try {
        const projRes = await fetch(`${SLEEPER_API}/projections/nfl/regular/${season}/${currentWeek}`);
        if (projRes.ok) weeklyProjections = await projRes.json();
      } catch {}

      // Matchups hebdomadaires
      for (let w = 1; w <= currentWeek; w++) {
        try {
          const mRes = await fetch(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/matchups/${w}`);
          if (mRes.ok) {
            const matchups = await mRes.json();
            const hasRealScores = matchups.some(m => (m.points || 0) > 0);
            if (hasRealScores) {
              for (const m of matchups) {
                for (const [pid, pts] of Object.entries(m.players_points || {})) {
                  if (typeof pts === "number") {
                    if (!playerWeeklyScores.has(pid)) playerWeeklyScores.set(pid, []);
                    playerWeeklyScores.get(pid).push(pts);
                  }
                }
              }
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.warn("Erreur chargement Sleeper API", e);
  }

  // Enrichir les joueurs du catalogue avec projections
  for (const p of catalog.players || []) {
    const proj = weeklyProjections[p.sleeperId];
    if (proj && typeof proj.pts_ppr === "number") {
      p.projectedPpg = Number(proj.pts_ppr.toFixed(1));
    }
    const scores = playerWeeklyScores.get(p.sleeperId) || [];
    if (scores.length > 0) {
      p.weeklyScores = scores;
      p.gamesPlayed = scores.length;
      p.actualPpg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
    }
  }

  const formattedRosters = listRosterIdentities(rosters, users).map(({ roster: r, ownerName, teamName }) => {
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      ownerName,
      name: teamName,
      players: (r.players || []).map(pid => {
        const found = playerMap.get(pid);
        const player = found ? { ...found } : { sleeperId: pid, name: `Player #${pid}`, position: "FLEX" };
        if (injuryStatuses[pid]) player.injuryStatus = injuryStatuses[pid];
        const proj = weeklyProjections[pid];
        if (proj && typeof proj.pts_ppr === "number") {
          player.projectedPpg = Number(proj.pts_ppr.toFixed(1));
        }
        const scores = playerWeeklyScores.get(pid) || [];
        if (scores.length > 0) {
          player.weeklyScores = scores;
          player.gamesPlayed = scores.length;
          player.actualPpg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
        }
        return player;
      })
    };
  });

  const content = document.getElementById("trade-content");
  let currentTab = window.location.hash === "#calculator" ? "calc" :
    window.location.hash === "#waivers" ? "waivers" :
    window.location.hash === "#advisor" ? "advisor" :
    window.location.hash === "#usage" ? "usage" :
    window.location.hash === "#rules" ? "rules" : "finder";
  const requestedTeam = new URLSearchParams(window.location.search).get("team");
  const requestedRoster = requestedTeam
    ? formattedRosters.find(r => r.ownerName.toLowerCase() === requestedTeam.toLowerCase() || String(r.roster_id) === requestedTeam)
    : null;
  let selectedRosterId = requestedRoster?.roster_id
    || formattedRosters.find(r => r.ownerName.toLowerCase() === "t0z")?.roster_id
    || formattedRosters[0]?.roster_id
    || 1;

  function renderCurrentTab() {
    if (currentTab === "finder") renderFinderView();
    else if (currentTab === "calc") renderCalculatorView();
    else if (currentTab === "waivers") renderWaiverView();
    else if (currentTab === "advisor") renderAdvisorView();
    else if (currentTab === "usage") renderUsageView();
    else renderRulesView();
  }

  function renderFinderView() {
    const currentRoster = formattedRosters.find(r => String(r.roster_id) === String(selectedRosterId));
    if (!currentRoster) {
      content.innerHTML = `<div class="shell state">Aucun roster trouvé.</div>`;
      return;
    }

    const diag = diagnoseRoster(currentRoster.players);
    const storageKey = `adineu:trade-preferences:2026:${SLEEPER_LEAGUE_ID}:${selectedRosterId}`;
    let preferences = {};
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) preferences = saved;
    } catch { /* Defaults remain usable when storage is unavailable. */ }
    const proposals = findTradeProposals({
      targetRosterId: selectedRosterId,
      rosters: formattedRosters,
      playerCatalog: playerMap,
      playerPreferences: preferences,
      currentWeek
    });
    const myLineup = buildProjectedLineup(currentRoster.players, { estimate: restOfSeasonEstimate(currentWeek) });

    content.innerHTML = `
      <div class="shell">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:28px;">
          <div>
            <label for="roster-select" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:700; display:block; margin-bottom:6px;">Équipe analysée :</label>
            <select id="roster-select" style="padding:10px 14px; background:var(--panel); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
              ${formattedRosters.map(r => `
                <option value="${r.roster_id}" ${String(r.roster_id) === String(selectedRosterId) ? "selected" : ""}>
                  ${escapeHtml(r.name)} (@${escapeHtml(r.ownerName)})
                </option>
              `).join("")}
            </select>
          </div>

          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <div style="background:var(--paper-soft); border:1px solid var(--line); padding:10px 14px; border-radius:4px;">
              <span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase; display:block;">Surplus</span>
              <strong style="color:var(--grass); font-size:0.95rem;">${diag.surpluses.length > 0 ? diag.surpluses.join(", ") : "Équilibré"}</strong>
            </div>
            <div style="background:var(--paper-soft); border:1px solid var(--line); padding:10px 14px; border-radius:4px;">
              <span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase; display:block;">Besoins / Déficits</span>
              <strong style="color:var(--gold); font-size:0.95rem;">${diag.deficits.length > 0 ? diag.deficits.join(", ") : "Complet"}</strong>
            </div>
          </div>
        </div>

        <details class="trade-lineup-detail"><summary>Mes préférences de joueurs</summary>
          <p class="note">Sur ce navigateur uniquement, sans synchronisation Coach/n8n. Shop favorise les propositions, Keep les réduit, Untouchable les exclut. Tous restent dans le calcul de lineup.</p>
          <div class="table-wrap"><table><thead><tr><th>Joueur</th><th>Préférence</th></tr></thead><tbody>
          ${currentRoster.players.map(player => `<tr><td>${escapeHtml(player.name)}</td><td><select class="player-preference" data-player="${escapeHtml(playerKey(player))}" aria-label="Préférence pour ${escapeHtml(player.name)}">${Object.entries(PLAYER_STATUSES).map(([status, label]) => `<option value="${status}" ${playerStatus(player, preferences) === status ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></td></tr>`).join("")}
          </tbody></table></div><p class="note" id="preference-status" role="status"></p></details>
        ${myLineup.emptySlots.length ? `<div class="card" style="padding:14px 18px; margin:16px 0; border-left:4px solid var(--red);">⚠ Aucun joueur éligible pour ${myLineup.emptySlots.map(escapeHtml).join(", ")} : ce slot vaut 0 pt chaque semaine. Priorité au <a href="#waivers" id="empty-slot-waivers">Waiver Wire</a> avant tout trade.</div>` : ""}
        <h3 style="margin:24px 0 16px; font-size:1.2rem;">Opportunités de Trades Détectées (${proposals.length})</h3>

        ${proposals.length === 0 ? `
          <div class="card" style="padding:24px; text-align:center; color:var(--muted);">
            Aucun trade bilatéral évident n'a été détecté pour cette configuration d'équipe.
          </div>
        ` : `
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:20px;">
            ${proposals.map((p, index) => {
              const score = p.recommendationScore;
              const delta = value => value === null ? "Indisponible" : `${value >= 0 ? "+" : ""}${value} pts/sem`;
              const catBadge = p.category === "HANDCUFF_INSURANCE"
                ? `<span style="background:rgba(255,180,67,0.15); color:var(--gold); border:1px solid var(--gold); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">🔒 SÉCURITÉ MENOTTE</span>`
                : p.category === "WIN_WIN"
                ? `<span style="background:rgba(184,255,61,0.15); color:var(--grass); border:1px solid var(--grass); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">🤝 WIN-WIN</span>`
                : `<span style="background:rgba(159,177,168,0.15); color:var(--ink); border:1px solid var(--line); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">${p.category === "CONSOLIDATION" ? "⚡ CONSOLIDATION" : p.category === "LINEUP_UPGRADE" ? "📈 UPGRADE LINEUP" : "ÉCHANGE À ÉTUDIER"}</span>`;

              const verdictColor = p.evaluation.verdict === "FAIR" ? "var(--grass)" : "var(--gold)";

              return `
                <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                      <div>
                        ${catBadge}
                        <h4 style="margin:8px 0 2px; font-size:1rem; color:var(--ink);">${escapeHtml(p.partnerName)}</h4>
                      </div>
                      <div style="text-align:right;">
                        <span style="font-size:0.75rem; color:${verdictColor}; font-weight:700; display:block;">${p.evaluation.label}</span>
                        <span style="font-size:0.7rem; color:var(--muted);">Valeur marché uniquement</span>
                      </div>
                    </div>

                    <div class="trade-impact-grid">
                      <div><small>Ta lineup</small><strong>${delta(score.my_lineup_delta)}</strong></div>
                      <div><small>Sa lineup</small><strong>${delta(score.their_lineup_delta)}</strong></div>
                    </div>
                    <p class="note">Faisabilité : ${escapeHtml(score.tradeability)} · Confiance : ${{ HIGH: "bonne", MEDIUM: "moyenne (blessure)", LOW: "faible" }[score.confidence]}. ${score.horizon === "ROS" ? `Moyenne hebdo projetée, semaines ${currentWeek}→${GENERAL_SETTINGS_2026.playoffWeekStart - 1} (blessures et byes inclus)` : "Estimation de la semaine"} : estimation Adineu, pas une garantie.</p>
                    ${score.warnings.length ? `<p class="note">⚠ ${score.warnings.map(escapeHtml).join(" · ")}</p>` : ""}
                    ${score.notes?.length ? `<p class="note">ℹ ${score.notes.map(escapeHtml).join(" · ")}</p>` : ""}
                    ${index === 0 ? `<details class="trade-lineup-detail"><summary>Lineups avant → après</summary>
                      ${[["Ton équipe", score.lineups.mine], [p.partnerName, score.lineups.theirs]].map(([name, lineups]) => `<h5>${escapeHtml(name)}</h5><div class="table-wrap"><table><thead><tr><th>Slot</th><th>Avant</th><th>Après</th></tr></thead><tbody>${lineups.before.slots.map((slot, i) => `<tr><td>${escapeHtml(slot.slot)}</td><td>${escapeHtml(slot.name)} · ${slot.projectedPpg ?? "—"}</td><td>${escapeHtml(lineups.after.slots[i].name)} · ${lineups.after.slots[i].projectedPpg ?? "—"}</td></tr>`).join("")}</tbody></table></div>`).join("")}
                      <p class="note">Lineups optimales projetées (moyenne reste de saison), pas les titulaires actuellement choisis. Les acquisitions futures ne sont pas simulées.</p></details>` : ""}

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0; padding:12px; background:var(--paper-soft); border-radius:4px; border:1px solid var(--line);">
                      <div>
                        <span style="font-size:0.68rem; text-transform:uppercase; color:var(--red); font-weight:700; display:block; margin-bottom:6px;">Tu Cèdes</span>
                        ${p.give.map(g => `
                          <div style="font-size:0.85rem; font-weight:600; margin-bottom:2px;">
                            ${escapeHtml(g.name)} <small style="color:var(--muted);">(${escapeHtml(g.position)})</small>
                          </div>
                          <div style="font-size:0.7rem; color:var(--muted); margin-bottom:6px;">
                            ${typeof g.projectedPpg === "number" ? `Proj: <strong>${g.projectedPpg}</strong>` : ""}
                            ${typeof g.actualPpg === "number" ? ` · Moyenne (${g.gamesPlayed || 1} match${g.gamesPlayed > 1 ? "s" : ""}): <strong>${g.actualPpg}</strong>` : ""}
                            ${g.signal === "BUY_LOW" ? ` · <span style="color:var(--grass); font-weight:700;">🟢 Buy-Low</span>` : ""}
                            ${g.signal === "SELL_HIGH" ? ` · <span style="color:var(--gold); font-weight:700;">🔥 Sell-High</span>` : ""}
                          </div>
                        `).join("")}
                        <div style="font-size:0.7rem; color:var(--muted); margin-top:4px; border-top:1px dashed var(--line); padding-top:4px;">
                          Valeur nette : <strong>${p.evaluation.sideA.netTotal}</strong> pts
                        </div>
                      </div>
                      <div>
                        <span style="font-size:0.68rem; text-transform:uppercase; color:var(--grass); font-weight:700; display:block; margin-bottom:6px;">Tu Reçois</span>
                        ${p.receive.map(r => `
                          <div style="font-size:0.85rem; font-weight:600; margin-bottom:2px;">
                            ${escapeHtml(r.name)} <small style="color:var(--muted);">(${escapeHtml(r.position)})</small>
                          </div>
                          <div style="font-size:0.7rem; color:var(--muted); margin-bottom:6px;">
                            ${typeof r.projectedPpg === "number" ? `Proj: <strong>${r.projectedPpg}</strong>` : ""}
                            ${typeof r.actualPpg === "number" ? ` · Moyenne (${r.gamesPlayed || 1} match${r.gamesPlayed > 1 ? "s" : ""}): <strong>${r.actualPpg}</strong>` : ""}
                            ${r.signal === "BUY_LOW" ? ` · <span style="color:var(--grass); font-weight:700;">🟢 Buy-Low</span>` : ""}
                            ${r.signal === "SELL_HIGH" ? ` · <span style="color:var(--gold); font-weight:700;">🔥 Sell-High</span>` : ""}
                          </div>
                        `).join("")}
                        <div style="font-size:0.7rem; color:var(--muted); margin-top:4px; border-top:1px dashed var(--line); padding-top:4px;">
                          Valeur nette : <strong>${p.evaluation.sideB.netTotal}</strong> pts
                        </div>
                      </div>
                    </div>

                    <button type="button" class="counter-offer-btn filter-btn" data-index="${index}">Explorer les contre-offres</button>
                    <div id="counter-offers-${index}" aria-live="polite"></div>
                    <div style="font-size:0.8rem; color:var(--ink); margin-bottom:8px;">
                      <strong>🎯 Impact :</strong> ${escapeHtml(p.pitchTarget)}
                    </div>
                    <div style="font-size:0.8rem; color:var(--muted); margin-bottom:14px;">
                      <strong>💬 Pitch :</strong> "${escapeHtml(p.pitchPartner)}"
                    </div>
                  </div>

                  <button type="button" class="copy-pitch-btn filter-btn" data-pitch="${escapeHtml(`Salut ! Que penses-tu de cet échange : je te propose ${p.give.map(g => g.name).join(" + ")} contre ${p.receive.map(r => r.name).join(" + ")} ? ${p.pitchPartner}`)}" style="width:100%; text-align:center; padding:8px; font-size:0.75rem;">
                    📋 Copier le message de négociation
                  </button>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>
    `;

    document.getElementById("roster-select")?.addEventListener("change", (e) => {
      selectedRosterId = e.target.value;
      renderFinderView();
    });

    document.querySelectorAll(".player-preference").forEach(select => {
      select.addEventListener("change", () => {
        preferences[select.dataset.player] = select.value;
        try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
        catch {
          document.getElementById("preference-status").textContent = "Stockage indisponible : préférence non enregistrée.";
          return;
        }
        renderFinderView();
        content.querySelector("details").open = true;
      });
    });
    document.querySelectorAll(".counter-offer-btn").forEach(button => {
      button.addEventListener("click", () => {
        const proposal = proposals[Number(button.dataset.index)];
        const partner = formattedRosters.find(roster => String(roster.roster_id) === String(proposal.partnerRosterId));
        const offers = findCounterOffers({ proposal, myPlayers: currentRoster.players, theirPlayers: partner?.players, playerPreferences: preferences, currentWeek });
        const container = document.getElementById(`counter-offers-${button.dataset.index}`);
        container.innerHTML = offers.length ? offers.map(offer => `<p class="note"><strong>${offer.give.map(player => escapeHtml(player.name)).join(" + ")} → ${offer.receive.map(player => escapeHtml(player.name)).join(" + ")}</strong><br>Ta lineup : +${offer.recommendationScore.my_lineup_delta} · Sa lineup : +${offer.recommendationScore.their_lineup_delta} pts/sem<br>Marché : ${offer.evaluation.sideA.netTotal} ↔ ${offer.evaluation.sideB.netTotal} · ${escapeHtml(offer.recommendationScore.tradeability)}</p>`).join("") : '<p class="note">Aucune alternative fiable avec gain pour toi et sans perte adverse. Les joueurs Untouchable restent exclus.</p>';
      });
    });
    document.querySelectorAll(".copy-pitch-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const text = btn.dataset.pitch;
        navigator.clipboard.writeText(text).then(() => {
          const prev = btn.textContent;
          btn.textContent = "✅ Message copié !";
          setTimeout(() => { btn.textContent = prev; }, 2000);
        });
      });
    });
  }

  function renderCalculatorView() {
    const allPlayers = catalog.players || [];
    let sideA = [];
    let sideB = [];

    content.innerHTML = `
      <div class="shell">
        <datalist id="calc-players-datalist">
          ${allPlayers.map(p => {
            const prof = calculatePlayerTradeProfile(p);
            return `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${escapeHtml(p.position)} - ${escapeHtml(p.nflTeam || "NFL")}) · Val ~${prof.tradeValue} · Proj: ${prof.projectedPpg} pts/m</option>`;
          }).join("")}
        </datalist>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:24px; margin-bottom:28px;">
          <!-- SIDE A -->
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <h3 style="margin:0 0 14px; font-size:1.1rem; color:var(--red);">Équipe A (Donne)</h3>
            <div style="margin-bottom:14px;">
              <input type="text" id="calc-add-a" list="calc-players-datalist" autocomplete="off" placeholder="Tape un nom de joueur…" style="width:100%; padding:10px; background:var(--paper-soft); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
            </div>
            <div id="side-a-list" style="min-height:120px; display:flex; flex-direction:column; gap:8px;">
              <span style="color:var(--muted); font-size:0.85rem;">Aucun joueur sélectionné.</span>
            </div>
          </div>

          <!-- SIDE B -->
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <h3 style="margin:0 0 14px; font-size:1.1rem; color:var(--grass);">Équipe B (Reçoit)</h3>
            <div style="margin-bottom:14px;">
              <input type="text" id="calc-add-b" list="calc-players-datalist" autocomplete="off" placeholder="Tape un nom de joueur…" style="width:100%; padding:10px; background:var(--paper-soft); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
            </div>
            <div id="side-b-list" style="min-height:120px; display:flex; flex-direction:column; gap:8px;">
              <span style="color:var(--muted); font-size:0.85rem;">Aucun joueur sélectionné.</span>
            </div>
          </div>
        </div>

        <!-- RÉSULTAT DU CALCUL -->
        <div id="calc-result" class="card" style="background:var(--paper-soft); border:1px solid var(--line); border-radius:6px; padding:24px; text-align:center;">
          <span style="color:var(--muted); font-size:0.9rem;">Sélectionne des joueurs des deux côtés pour évaluer l'échange en direct.</span>
        </div>
      </div>
    `;

    function updateCalcResult() {
      const resultBox = document.getElementById("calc-result");
      if (sideA.length === 0 && sideB.length === 0) {
        resultBox.innerHTML = `<span style="color:var(--muted); font-size:0.9rem;">Sélectionne des joueurs des deux côtés pour évaluer l'échange en direct.</span>`;
        return;
      }

      const evalTrade = evaluateTrade({ sideA, sideB });
      const verdictColor = evalTrade.verdict === "FAIR" ? "var(--grass)" : evalTrade.verdict.startsWith("SLIGHT") ? "var(--gold)" : "var(--red)";

      resultBox.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; gap:16px; margin-bottom:16px;">
          <span style="font-size:1.4rem; font-weight:800; color:${verdictColor}; font-family:var(--display); text-transform:uppercase;">
            ${evalTrade.label}
          </span>
          <span style="font-size:0.85rem; color:var(--muted); font-weight:600; background:var(--panel); padding:4px 10px; border-radius:4px; border:1px solid var(--line);">
            Écart : ${evalTrade.pctDiff}%
          </span>
        </div>

        <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:24px; align-items:center; max-width:640px; margin:0 auto 16px;">
          <div>
            <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase;">Valeur nette Équipe A</div>
            <div style="font-size:2rem; font-weight:800; color:var(--red); font-family:var(--display);">${evalTrade.sideA.netTotal}</div>
            <div style="font-size:0.75rem; color:var(--muted);">Brut : ${evalTrade.sideA.rawTotal} pts</div>
            <div style="font-size:0.8rem; color:var(--ink); margin-top:4px;">
              <strong>${evalTrade.sideA.blendedPpgTotal} pts/sem</strong> <small style="color:var(--muted);">(Proj: ${evalTrade.sideA.projectedPpgTotal})</small>
            </div>
          </div>
          <div style="font-size:1.5rem; color:var(--muted); font-weight:700;">VS</div>
          <div>
            <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase;">Valeur nette Équipe B</div>
            <div style="font-size:2rem; font-weight:800; color:var(--grass); font-family:var(--display);">${evalTrade.sideB.netTotal}</div>
            <div style="font-size:0.75rem; color:var(--muted);">Brut : ${evalTrade.sideB.rawTotal} pts</div>
            <div style="font-size:0.8rem; color:var(--ink); margin-top:4px;">
              <strong>${evalTrade.sideB.blendedPpgTotal} pts/sem</strong> <small style="color:var(--muted);">(Proj: ${evalTrade.sideB.projectedPpgTotal})</small>
            </div>
          </div>
        </div>

        <div style="background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:10px 14px; max-width:540px; margin:12px auto; font-size:0.85rem;">
          📊 <strong>Écart de production des joueurs échangés :</strong> ${evalTrade.weeklyPointsDiff >= 0
            ? `<span style="color:var(--grass); font-weight:700;">+${evalTrade.weeklyPointsDiff} pts/semaine pour Équipe A</span>`
            : `<span style="color:var(--red); font-weight:700;">${evalTrade.weeklyPointsDiff} pts/semaine pour Équipe A</span>`}
          <span style="color:var(--muted); display:block; font-size:0.75rem; margin-top:2px;">Somme pondérée des joueurs uniquement : ce n'est pas un gain de lineup. Consulte le Trade Finder pour l'impact des remplacements.</span>
        </div>

        ${evalTrade.starPlayer ? `
          <div style="font-size:0.85rem; color:var(--ink); margin-top:12px;">
            ⭐ <strong>Meilleur joueur du deal :</strong> ${escapeHtml(evalTrade.starPlayer.name)} (${evalTrade.starPlayer.value} pts)
          </div>
        ` : ""}
      `;
    }

    function renderSideList(side, containerId) {
      const container = document.getElementById(containerId);
      if (side.length === 0) {
        container.innerHTML = `<span style="color:var(--muted); font-size:0.85rem;">Aucun joueur sélectionné.</span>`;
        return;
      }

      container.innerHTML = side.map((p, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--paper-soft); padding:8px 12px; border-radius:4px; border:1px solid var(--line);">
          <div>
            <strong>${escapeHtml(p.name)}</strong> <small style="color:var(--muted);">(${escapeHtml(p.position)} - ${escapeHtml(p.nflTeam || "NFL")})</small>
            <div style="font-size:0.75rem; color:var(--gold);">Valeur : ~${calculatePlayerTradeValue(p)} pts</div>
          </div>
          <button type="button" class="remove-p-btn" data-side="${containerId === 'side-a-list' ? 'A' : 'B'}" data-idx="${idx}" style="background:transparent; border:none; color:var(--muted); cursor:pointer; font-size:1.1rem;">×</button>
        </div>
      `).join("");

      container.querySelectorAll(".remove-p-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          if (btn.dataset.side === "A") {
            sideA.splice(idx, 1);
            renderSideList(sideA, "side-a-list");
          } else {
            sideB.splice(idx, 1);
            renderSideList(sideB, "side-b-list");
          }
          updateCalcResult();
        });
      });
    }

    function wirePlayerPicker(inputId, side, listId) {
      document.getElementById(inputId)?.addEventListener("input", (e) => {
        const player = playerMap.get(e.target.value.trim());
        if (!player) return; // texte partiel, l'utilisateur n'a pas encore choisi une suggestion
        if (side.length < 3) {
          side.push(player);
          renderSideList(side, listId);
          updateCalcResult();
        }
        e.target.value = "";
      });
    }

    wirePlayerPicker("calc-add-a", sideA, "side-a-list");
    wirePlayerPicker("calc-add-b", sideB, "side-b-list");
  }

  async function renderWaiverView() {
    content.innerHTML = `<div class="shell state">Chargement des free agents…</div>`;

    // Waiver v2 (docs/prd-waiver-model-v2.md) : le serveur croise projections ROS, usage réel,
    // événements (titulaire blessé devant, explosion de snaps) et le fit de CETTE équipe.
    const waiverRosterId = selectedRosterId;
    let report = { byPosition: {}, message: "" };
    try {
      const res = await fetch(`/api/free-agents?limit=8&team=${encodeURIComponent(waiverRosterId)}`);
      if (res.ok) report = await res.json();
    } catch (e) {
      console.warn("Impossible de charger les free agents", e);
    }
    const opportunities = Object.values(report.byPosition || {}).flat()
      .filter(player => player.waiver?.fit?.gainPerWeek > 0)
      .sort((a, b) => b.waiver.fit.faabMaxForMe - a.waiver.fit.faabMaxForMe || b.waiver.fit.gainPerWeek - a.waiver.fit.gainPerWeek)
      .slice(0, 10);
    const opportunityError = report.rankingModel ? null : "Calcul indisponible pour le moment.";
    const degradedNote = report.degraded ? `⚠ Données partielles (projections ${report.coverage?.projectionWeeks}, stats ${report.coverage?.statsWeeks}) : classement moins fiable, estimation par rang pour certains joueurs.` : "";

    // l'utilisateur a changé d'onglet ou d'équipe pendant le chargement
    if (currentTab !== "waivers" || String(waiverRosterId) !== String(selectedRosterId)) return;

    const rawRoster = rosters.find(r => String(r.roster_id) === String(selectedRosterId));
    const faabRemaining = rawRoster ? calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, rawRoster.settings?.waiver_budget_used) : null;

    const positionOrder = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const positionCards = positionOrder
      .map(pos => {
        const players = report.byPosition?.[pos] || [];
        if (players.length === 0) return "";
        return `
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:18px;">
            <h4 style="margin:0 0 12px; font-size:0.95rem; color:var(--grass); text-transform:uppercase;">${pos}</h4>
            ${players.map((p, i) => `
              <div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--line); font-size:0.82rem;">
                <span><strong>${i + 1}.</strong> ${escapeHtml(p.name)} <small style="color:var(--muted);">(${escapeHtml(p.nflTeam || "FA")})</small></span>
                <span style="color:var(--muted); font-size:0.72rem; white-space:nowrap;">
                  ${p.waiver ? `${p.waiver.newsOverride ? "⚡ " : ""}${escapeHtml(p.waiver.category)} · ROS ${p.waiver.rosPpg ?? "n/d"}${p.waiver.rosSource === "RANK_ESTIMATE" ? " (rang)" : ""} · Marché ${p.waiver.faabPct[0]}–${p.waiver.faabPct[1]}%${p.waiver.fit ? ` · Fit ${p.waiver.fit.fitScore}` : ""}` : ""}
                </span>
              </div>
            `).join("")}
          </div>
        `;
      })
      .join("");

    content.innerHTML = `
      <div class="shell">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
          <div>
            <label for="waiver-roster-select" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:700; display:block; margin-bottom:6px;">Équipe analysée :</label>
            <select id="waiver-roster-select" style="padding:10px 14px; background:var(--panel); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
              ${formattedRosters.map(r => `
                <option value="${r.roster_id}" ${String(r.roster_id) === String(selectedRosterId) ? "selected" : ""}>
                  ${escapeHtml(r.name)} (@${escapeHtml(r.ownerName)})
                </option>
              `).join("")}
            </select>
          </div>
          <div style="background:var(--paper-soft); border:1px solid var(--line); padding:10px 14px; border-radius:4px;">
            <span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase; display:block;">FAAB restant</span>
            <strong style="font-size:0.95rem;">${faabRemaining !== null ? `${faabRemaining} $` : "Indisponible"}</strong>
          </div>
        </div>

        ${degradedNote ? `<div class="card" style="padding:12px 16px; margin-bottom:16px; border-left:4px solid var(--gold);">${escapeHtml(degradedNote)}</div>` : ""}
        <h3 style="margin:0 0 6px; font-size:1.2rem;">Meilleurs adds pour ton équipe${currentWeek ? ` · Semaine ${currentWeek}` : ""}</h3>
        <p class="note" style="margin:0 0 16px;">Valeur marché (ce que le joueur vaut pour la ligue) ≠ fit (ce qu'il apporte à <em>ta</em> lineup optimale, reste de saison). « Max pour toi » = FAAB marché × fit, plafonné par ton FAAB restant. Estimations Adineu, jamais une probabilité de gagner l'enchère.</p>
        ${opportunityError ? `
          <div class="card" style="padding:20px; text-align:center; color:var(--muted); margin-bottom:28px;">${escapeHtml(opportunityError)}</div>
        ` : opportunities.length === 0 ? `
          <div class="card" style="padding:20px; text-align:center; color:var(--muted); margin-bottom:28px;">Aucune opportunité claire cette semaine pour cette équipe.</div>
        ` : `
          <div class="table-wrap" style="margin-bottom:28px;">
            <table>
              <thead><tr><th>Joueur</th><th>Slot</th><th>Gain lineup</th><th>Market</th><th>Fit</th><th>FAAB marché</th><th>Max pour toi</th></tr></thead>
              <tbody>
                ${opportunities.map(p => `
                  <tr>
                    <td>${escapeHtml(p.name)} <small style="color:var(--muted);">(${escapeHtml(p.position)}${p.nflTeam ? ` ${escapeHtml(p.nflTeam)}` : ""})</small>${p.waiver.newsOverride ? `<br><small style="color:var(--gold);">⚡ ${escapeHtml(p.waiver.reasons.join(" · "))}</small>` : ""}</td>
                    <td>${escapeHtml(p.waiver.fit.slot || "—")}</td>
                    <td style="color:var(--grass); font-weight:700;">+${p.waiver.fit.gainPerWeek} pts/sem</td>
                    <td>${p.waiver.score}</td>
                    <td>${p.waiver.fit.fitScore}</td>
                    <td>${p.waiver.faabMarket[0]}–${p.waiver.faabMarket[1]} $</td>
                    <td style="font-weight:700;">${p.waiver.fit.faabMaxForMe} $</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}

        ${(report.trending || []).length ? `
          <h3 style="margin:0 0 6px; font-size:1.2rem;">Tendances Sleeper · 48 h</h3>
          <p class="note" style="margin:0 0 12px;">Joueurs les plus ajoutés sur toute la plateforme Sleeper, croisés avec la ligue Adineu et le modèle waiver.</p>
          <div class="table-wrap" style="margin-bottom:28px;"><table>
            <thead><tr><th>Joueur</th><th class="num">Ajouts</th><th>Dans Adineu</th><th>Marché</th><th>Max pour toi</th></tr></thead>
            <tbody>${report.trending.map(t => `<tr>
              <td>${escapeHtml(t.name)} <small style="color:var(--muted);">(${escapeHtml(t.position || "?")}${t.nflTeam ? ` ${escapeHtml(t.nflTeam)}` : ""})</small>${t.waiver?.newsOverride ? `<br><small style="color:var(--gold);">⚡ ${escapeHtml(t.waiver.reasons.join(" · "))}</small>` : ""}</td>
              <td class="num">${Number(t.adds).toLocaleString("fr-FR")}</td>
              <td>${t.rostered ? `Rosté · ${escapeHtml(t.rosteredBy || "?")}` : t.injuryStatus ? `Libre · ${escapeHtml(t.injuryStatus)}` : "<strong>Libre</strong>"}</td>
              <td>${t.waiver ? `${escapeHtml(t.waiver.category)} · ${t.waiver.faabMarket[0]}–${t.waiver.faabMarket[1]} $` : "—"}</td>
              <td>${t.waiver?.fit ? `${t.waiver.fit.faabMaxForMe} $` : "—"}</td>
            </tr>`).join("")}</tbody>
          </table></div>` : ""}

        ${(report.faabHistory || []).length ? `
          <h3 style="margin:0 0 6px; font-size:1.2rem;">Historique FAAB de la ligue</h3>
          <p class="note" style="margin:0 0 12px;">Enchères gagnées cette saison (Sleeper). ${Object.entries(report.faabByPosition || {}).map(([pos, stat]) => `${escapeHtml(pos)} : médiane ${stat.median} $ · max ${stat.max} $`).join(" · ")}</p>
          <div class="table-wrap" style="margin-bottom:28px;"><table>
            <thead><tr><th>Sem.</th><th>Joueur</th><th>Équipe</th><th class="num">Enchère</th></tr></thead>
            <tbody>${report.faabHistory.slice(0, 15).map(c => `<tr>
              <td>S${c.week}</td>
              <td>${escapeHtml(c.name)} <small style="color:var(--muted);">(${escapeHtml(c.position || "?")})</small></td>
              <td>${escapeHtml(c.team || "?")}</td>
              <td class="num"><strong>${c.bid} $</strong></td>
            </tr>`).join("")}</tbody>
          </table></div>` : ""}

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:1.2rem;">Free Agents Disponibles${report.week ? ` · Semaine ${report.week}` : ""}</h3>
            <p style="margin:0; color:var(--muted); font-size:0.82rem;">Classés par valeur marché reste de saison : projections Sleeper sem. ${report.week || "?"}→14, usage réel (snaps, opportunités) et événements ⚡ (titulaire blessé devant, explosion d'usage).</p>
          </div>
          <button type="button" id="copy-waiver-btn" class="filter-btn" style="padding:8px 14px; font-size:0.75rem;">📋 Copier le rapport Waiver Wire</button>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px;">
          ${positionCards || `<div class="card" style="padding:24px; text-align:center; color:var(--muted);">Aucun free agent trouvé.</div>`}
        </div>
      </div>
    `;

    document.getElementById("waiver-roster-select")?.addEventListener("change", (e) => {
      selectedRosterId = e.target.value;
      renderWaiverView();
    });

    document.getElementById("copy-waiver-btn")?.addEventListener("click", event => {
      const btn = event.currentTarget;
      navigator.clipboard.writeText(report.message || "").then(() => {
        const prev = btn.textContent;
        btn.textContent = "✅ Rapport copié !";
        setTimeout(() => { btn.textContent = prev; }, 2000);
      });
    });
  }

  async function renderAdvisorView() {
    content.innerHTML = `<div class="shell state">Analyse du lineup en cours…</div>`;

    let advisory = { alerts: [], message: "" };
    const requestedRosterId = selectedRosterId;
    try {
      const res = await fetch(`/api/lineup-advisor?team=${encodeURIComponent(requestedRosterId)}`);
      if (res.ok) advisory = await res.json();
    } catch (e) {
      console.warn("Impossible de charger le Start/Sit Advisor", e);
    }

    // l'utilisateur a changé d'onglet ou d'équipe pendant le chargement
    if (currentTab !== "advisor" || String(requestedRosterId) !== String(selectedRosterId)) return;

    const alertCards = advisory.alerts.map(alert => {
      const severityColor = alert.severity === "ALERT" ? "var(--red)" : "var(--gold)";
      const severityLabel = alert.severity === "ALERT" ? "🔴 ALERTE" : "🟡 À SURVEILLER";
      const who = alert.player
        ? `${escapeHtml(alert.player.name)} <small style="color:var(--muted);">(${escapeHtml(alert.player.position)}${alert.player.nflTeam ? " " + escapeHtml(alert.player.nflTeam) : ""})</small>`
        : `<em style="color:var(--muted);">Slot vide</em>`;
      const replacement = alert.replacement
        ? `${escapeHtml(alert.replacement.player.name)} <small style="color:var(--muted);">(${escapeHtml(alert.replacement.player.position)}${alert.replacement.player.nflTeam ? " " + escapeHtml(alert.replacement.player.nflTeam) : ""} · ${alert.replacement.source === "bench" ? "banc" : "free agent"})</small>`
        : `<span style="color:var(--muted);">Aucun remplaçant évident.</span>`;

      return `
        <div class="card" style="background:var(--panel); border:1px solid var(--line); border-left:4px solid ${severityColor}; border-radius:6px; padding:18px; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
            <div>
              <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.08em; color:${severityColor};">${severityLabel} · ${escapeHtml(alert.slot)}</span>
              <div style="font-size:0.95rem; margin-top:6px;">${who}</div>
              <div style="font-size:0.78rem; color:var(--muted); margin-top:4px;">${escapeHtml(alert.reason)}</div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:0.68rem; text-transform:uppercase; color:var(--muted); display:block; margin-bottom:4px;">Remplaçant conseillé</span>
              <div style="font-size:0.9rem;">${replacement}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    content.innerHTML = `
      <div class="shell">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
          <div>
            <label for="advisor-roster-select" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:700; display:block; margin-bottom:6px;">Équipe analysée :</label>
            <select id="advisor-roster-select" style="padding:10px 14px; background:var(--panel); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
              ${formattedRosters.map(r => `<option value="${r.roster_id}" ${String(r.roster_id) === String(selectedRosterId) ? "selected" : ""}>${escapeHtml(r.name)} (@${escapeHtml(r.ownerName)})</option>`).join("")}
            </select>
          </div>
          <div>
            <h3 style="margin:0 0 4px; font-size:1.2rem;">Start/Sit Advisor${advisory.week ? ` · Semaine ${advisory.week}` : ""}</h3>
            <p style="margin:0; color:var(--muted); font-size:0.82rem;">Croise la lineup avec le statut blessure Sleeper. Un slot vide compte comme alerte.</p>
          </div>
          <button type="button" id="copy-advisor-btn" class="filter-btn" style="padding:8px 14px; font-size:0.75rem;">📋 Copier le rapport</button>
        </div>
        ${advisory.optimal ? `<div class="card" style="padding:16px 18px; margin-bottom:16px; border-left:4px solid ${advisory.optimal.gain > 0 ? "var(--grass)" : "var(--line)"};">
          <strong>Lineup optimisée${advisory.week ? ` · semaine ${advisory.week}` : ""} :</strong> ${advisory.optimal.gain > 0
            ? `+${advisory.optimal.gain} pts projetés (${advisory.optimal.currentTotal} → ${advisory.optimal.optimalTotal}). Titulariser ${advisory.optimal.promote.map(p => escapeHtml(p.name)).join(", ")} · Asseoir ${advisory.optimal.bench.map(p => escapeHtml(p.name)).join(", ")}.`
            : `ta lineup actuelle est déjà la meilleure selon les projections Sleeper (${advisory.optimal.currentTotal} pts).`}
          <br><small style="color:var(--muted);">Même moteur que le Trade Finder : projection Sleeper de la semaine, 0 pt pour un joueur Out/IR, IR exclu.</small>
        </div>` : ""}
        ${alertCards || `<div class="card" style="padding:24px; text-align:center; color:var(--muted);">✅ Aucune alerte : lineup complet, personne à risque signalé par Sleeper.</div>`}
      </div>
    `;

    document.getElementById("advisor-roster-select")?.addEventListener("change", e => {
      selectedRosterId = e.target.value;
      renderAdvisorView();
    });

    document.getElementById("copy-advisor-btn")?.addEventListener("click", event => {
      const btn = event.currentTarget;
      navigator.clipboard.writeText(advisory.message || "").then(() => {
        const prev = btn.textContent;
        btn.textContent = "✅ Rapport copié !";
        setTimeout(() => { btn.textContent = prev; }, 2000);
      });
    });
  }

  // Usage Score (docs/prd-usage-score.md) : parts d'usage réelles vs production, calculées côté serveur.
  async function renderUsageView() {
    content.innerHTML = `<div class="shell state">Analyse de l'usage des 3 dernières semaines…</div>`;
    let report = null;
    const requestedRosterId = selectedRosterId;
    try {
      const res = await fetch(`/api/usage?team=${encodeURIComponent(requestedRosterId)}`);
      if (res.ok) report = await res.json();
    } catch (e) {
      console.warn("Impossible de charger l'Usage Score", e);
    }
    // Une réponse arrivée après un changement d'onglet ou d'équipe est ignorée.
    if (currentTab !== "usage" || String(requestedRosterId) !== String(selectedRosterId)) return;
    if (!report) {
      content.innerHTML = `<div class="shell state">Usage indisponible pour le moment (stats Sleeper).</div>`;
      return;
    }

    const signalBadge = signal => signal === "BUY_LOW" ? `<span style="color:var(--grass); font-weight:800;">🟢 Buy-low</span>`
      : signal === "SELL_HIGH" ? `<span style="color:var(--gold); font-weight:800;">🔥 Sell-high</span>` : "";
    const trend = value => value === null || value === undefined ? "—" : `${value > 0 ? "▲ +" : value < 0 ? "▼ " : ""}${value}`;
    const table = (rows, { owner = false } = {}) => rows.length ? `<div class="table-wrap" style="margin-bottom:24px;"><table>
      <thead><tr><th>Joueur</th>${owner ? "<th>Équipe</th>" : ""}<th class="num">Usage</th><th class="num">Tendance</th><th class="num">Snaps</th><th class="num">Targets</th><th class="num">Courses</th><th class="num">Red zone</th><th class="num">Pts/m</th><th class="num">xFP</th><th>Signal</th></tr></thead>
      <tbody>${rows.map(p => `<tr>
        <td>${escapeHtml(p.name)} <small style="color:var(--muted);">(${escapeHtml(p.position)} ${escapeHtml(p.team || "")}${p.injuryStatus ? ` · ${escapeHtml(p.injuryStatus)}` : ""})</small></td>
        ${owner ? `<td>${escapeHtml(p.owner || "Libre")}</td>` : ""}
        <td class="num"><strong>${p.usageScore}</strong></td>
        <td class="num">${trend(p.trend)}</td>
        <td class="num">${p.snapShare}%</td>
        <td class="num">${p.targetShare}%</td>
        <td class="num">${p.carryShare}%</td>
        <td class="num">${p.redZoneShare}%</td>
        <td class="num">${p.ppg}</td>
        <td class="num">${p.xfp}</td>
        <td>${signalBadge(p.signal)}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="note">Aucun joueur dans cette catégorie.</p>`;

    const mine = report.players.filter(p => p.mine);
    const buyTargets = report.players.filter(p => p.signal === "BUY_LOW" && !p.mine && p.owner).slice(0, 10);
    const sellMine = mine.filter(p => p.signal === "SELL_HIGH");
    const freeHighUsage = report.players.filter(p => !p.owner && p.usageScore >= 60 && !p.injuryStatus).slice(0, 10);
    const leaders = ["RB", "WR", "TE"].map(pos => `<details class="trade-lineup-detail"><summary>Top 20 usage · ${pos}</summary>${table(report.players.filter(p => p.position === pos).slice(0, 20), { owner: true })}</details>`).join("");

    content.innerHTML = `
      <div class="shell">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
          <div>
            <label for="usage-roster-select" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:700; display:block; margin-bottom:6px;">Équipe analysée :</label>
            <select id="usage-roster-select" style="padding:10px 14px; background:var(--panel); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
              ${formattedRosters.map(r => `<option value="${r.roster_id}" ${String(r.roster_id) === String(selectedRosterId) ? "selected" : ""}>${escapeHtml(r.name)} (@${escapeHtml(r.ownerName)})</option>`).join("")}
            </select>
          </div>
          <p class="note" style="margin:0; max-width:640px;"><strong>Usage Score (0–100)</strong> = rang, parmi les joueurs du même poste, de la part de l'attaque de son équipe qu'il reçoit (targets, air yards, snaps, courses, red zone ; semaines ${report.weeks.join(", ")}, les plus récentes comptent plus). <strong>xFP</strong> = points attendus pour ce volume. <strong>Buy-low</strong> : il produit ≥ 3 pts/match sous son volume. <strong>Sell-high</strong> : ≥ 4 pts au-dessus (TD, big plays), hors usage élite. Routes : non disponibles gratuitement.</p>
        </div>
        ${report.degraded ? `<div class="card" style="padding:12px 16px; margin-bottom:16px; border-left:4px solid var(--gold);">⚠ Stats partielles : semaines chargées ${report.weeks.join(", ") || "aucune"}.</div>` : ""}
        <h3 style="margin:0 0 8px; font-size:1.2rem;">Buy-low à cibler chez les autres</h3>
        ${table(buyTargets, { owner: true })}
        <h3 style="margin:0 0 8px; font-size:1.2rem;">Sell-high sur ton roster</h3>
        ${table(sellMine)}
        <h3 style="margin:0 0 8px; font-size:1.2rem;">Ton roster</h3>
        ${table(mine)}
        <h3 style="margin:0 0 8px; font-size:1.2rem;">Free agents à fort usage</h3>
        ${table(freeHighUsage)}
        ${leaders}
      </div>`;

    document.getElementById("usage-roster-select")?.addEventListener("change", e => {
      selectedRosterId = e.target.value;
      renderUsageView();
    });
  }

  function renderRulesView() {
    content.innerHTML = `
      <div class="shell">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:20px; margin-bottom:32px;">
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <p class="eyebrow" style="color:var(--grass); margin-bottom:8px;">Format & Playoffs</p>
            <h3 style="margin:0 0 12px; font-size:1.1rem;">12 Équipes · H2H</h3>
            <ul style="padding-left:18px; margin:0; font-size:0.85rem; color:var(--muted); line-height:1.6;">
              <li>Saison régulière : Semaines 1 à 14</li>
              <li><strong>Playoffs : Semaines 15 à 17</strong></li>
              <li><strong>8 équipes qualifiées</strong> en playoffs (bracket à 8)</li>
              <li>Consolation bracket pour les 4 autres</li>
            </ul>
          </div>

          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <p class="eyebrow" style="color:var(--gold); margin-bottom:8px;">Waivers & Trades</p>
            <h3 style="margin:0 0 12px; font-size:1.1rem;">FAAB 1 000 $</h3>
            <ul style="padding-left:18px; margin:0; font-size:0.85rem; color:var(--muted); line-height:1.6;">
              <li>Enchère minimum : 0 $</li>
              <li>Déblocage : Mercredi à 09:00 Paris (traitement continu)</li>
              <li><strong>Trade Deadline : Semaine 12</strong></li>
              <li>Veto : 6 votes · Review : 1 jour · Pick trading : Oui</li>
            </ul>
          </div>

          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <p class="eyebrow" style="color:var(--ink); margin-bottom:8px;">Composition Roster</p>
            <h3 style="margin:0 0 12px; font-size:1.1rem;">15 Joueurs + 1 IR</h3>
            <ul style="padding-left:18px; margin:0; font-size:0.85rem; color:var(--muted); line-height:1.6;">
              <li><strong>9 Titulaires :</strong> 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF</li>
              <li><strong>6 Remplaçants (Banc)</strong></li>
              <li><strong>1 Slot IR :</strong> Réservé aux joueurs déclarés Out (O) ou IR</li>
            </ul>
          </div>
        </div>

        <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px; margin-bottom:24px;">
          <p class="eyebrow" style="color:var(--grass); margin-bottom:8px;">Évaluation Déterministe des Trades</p>
          <h3 style="margin:0 0 12px; font-size:1.1rem;">Modèle Dynamique : Projections & Production Réelle Hebdomadaire</h3>
          <div style="font-size:0.85rem; color:var(--muted); line-height:1.6;">
            <p style="margin:0 0 8px;">Notre moteur de trade calcule la valeur de chaque joueur et le bénéfice pour les deux équipes en croisant plusieurs dimensions objectives :</p>
            <ul style="padding-left:18px; margin:0 0 12px;">
              <li><strong>Qualité & Rareté positionnelle :</strong> Prise en compte du format PPR 12 équipes (prime aux RB titulaires et TE élite, surplus QB).</li>
              <li><strong>Projections hebdomadaires Sleeper :</strong> Points projetés par match calculés selon notre barème officiel.</li>
              <li><strong>Production réelle hebdomadaire :</strong> Points réels marqués match par match en ligue Sleeper sous notre scoring 2026.</li>
              <li><strong>Lissage bayésien (Bayesian Shrinkage) :</strong> Au fil des semaines jouées, le poids de la production réelle augmente progressivement sans sur-réagir à une anomalie isolée d'une semaine.</li>
              <li><strong>Signaux Marché :</strong> Détection automatique des opportunités <em>Buy-Low</em> (production temporairement inférieure aux projections) et <em>Sell-High</em> (surperformance temporaire).</li>
            </ul>
          </div>
        </div>

        <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:24px;">
          <h3 style="margin:0 0 20px; font-size:1.2rem;">Grille Officielle du Scoring Adineu 2026</h3>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:24px;">
            <div>
              <h4 style="color:var(--grass); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">🏈 Passe (Passing)</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Yards à la passe</td><td style="text-align:right; font-weight:700;">1 pt / 25 yds (0.04)</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Touchdown passe</td><td style="text-align:right; font-weight:700;">+4.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Interception lancée</td><td style="text-align:right; font-weight:700; color:var(--red);">-2.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Conversion 2 pts passe</td><td style="text-align:right; font-weight:700;">+2.0 pts</td></tr>
                <tr><td style="padding:6px 0;">Sack subi par le QB</td><td style="text-align:right; color:var(--muted);">0 pt (aucun malus)</td></tr>
              </table>
            </div>

            <div>
              <h4 style="color:var(--grass); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">🏃 Course (Rushing)</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Yards à la course</td><td style="text-align:right; font-weight:700;">1 pt / 10 yds (0.10)</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Touchdown à la course</td><td style="text-align:right; font-weight:700;">+6.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Conversion 2 pts course</td><td style="text-align:right; font-weight:700;">+2.0 pts</td></tr>
                <tr><td style="padding:6px 0;">Fumble perdu</td><td style="text-align:right; font-weight:700; color:var(--red);">-2.0 pts</td></tr>
              </table>
            </div>

            <div>
              <h4 style="color:var(--grass); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">🎯 Réception (Full PPR)</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Réception (PPR)</td><td style="text-align:right; font-weight:700; color:var(--grass);">+1.0 pt (tous postes)</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Yards à la réception</td><td style="text-align:right; font-weight:700;">1 pt / 10 yds (0.10)</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Touchdown réception</td><td style="text-align:right; font-weight:700;">+6.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Conversion 2 pts réc.</td><td style="text-align:right; font-weight:700;">+2.0 pts</td></tr>
                <tr><td style="padding:6px 0;">TE Premium (TEP)</td><td style="text-align:right; color:var(--muted);">Aucun (0.0 pt)</td></tr>
              </table>
            </div>

            <div>
              <h4 style="color:var(--gold); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">👟 Kicking (0 Pénalité)</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Extra Point (PAT) réussi</td><td style="text-align:right; font-weight:700;">+1.0 pt</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">FG 0–39 yards</td><td style="text-align:right; font-weight:700;">+3.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">FG 40–49 yards</td><td style="text-align:right; font-weight:700;">+4.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">FG 50–59 yards</td><td style="text-align:right; font-weight:700;">+5.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">FG 60+ yards</td><td style="text-align:right; font-weight:700;">+6.0 pts</td></tr>
                <tr><td style="padding:6px 0;">FG / PAT Manqué</td><td style="text-align:right; font-weight:700; color:var(--grass);">0 pt (aucun malus)</td></tr>
              </table>
            </div>

            <div>
              <h4 style="color:var(--gold); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">🛡️ Défense d'équipe (DEF)</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Sack</td><td style="text-align:right; font-weight:700;">+1.0 pt</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Interception / Fumble Rec.</td><td style="text-align:right; font-weight:700;">+2.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Fumble provoqué (FF)</td><td style="text-align:right; font-weight:700;">+1.0 pt</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Safety / Blocked Kick</td><td style="text-align:right; font-weight:700;">+2.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">Touchdown DEF / ST</td><td style="text-align:right; font-weight:700;">+6.0 pts</td></tr>
                <tr><td style="padding:6px 0;">Yards concédés</td><td style="text-align:right; color:var(--muted);">0 pt (non comptabilisés)</td></tr>
              </table>
            </div>

            <div>
              <h4 style="color:var(--gold); margin:0 0 10px; font-size:0.95rem; text-transform:uppercase;">📊 Barème Points Encaissés</h4>
              <table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">0 point (Shutout)</td><td style="text-align:right; font-weight:700; color:var(--grass);">+10.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">1 à 6 points</td><td style="text-align:right; font-weight:700; color:var(--grass);">+7.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">7 à 13 points</td><td style="text-align:right; font-weight:700; color:var(--grass);">+4.0 pts</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">14 à 20 points</td><td style="text-align:right; font-weight:700;">+1.0 pt</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">21 à 27 points</td><td style="text-align:right; font-weight:700;">0.0 pt</td></tr>
                <tr style="border-bottom:1px solid var(--line);"><td style="padding:6px 0;">28 à 34 points</td><td style="text-align:right; font-weight:700; color:var(--red);">-1.0 pt</td></tr>
                <tr><td style="padding:6px 0;">35+ points</td><td style="text-align:right; font-weight:700; color:var(--red);">-4.0 pts</td></tr>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Switch tabs
  const tabFinderBtn = document.getElementById("tab-finder-btn");
  const tabCalcBtn = document.getElementById("tab-calc-btn");
  const tabWaiversBtn = document.getElementById("tab-waivers-btn");
  const tabAdvisorBtn = document.getElementById("tab-advisor-btn");
  const tabRulesBtn = document.getElementById("tab-rules-btn");
  const tabUsageBtn = document.getElementById("tab-usage-btn");
  const tabButtons = { finder: tabFinderBtn, calc: tabCalcBtn, waivers: tabWaiversBtn, advisor: tabAdvisorBtn, usage: tabUsageBtn, rules: tabRulesBtn };
  const tabHashes = { finder: "#recommendations", calc: "#calculator", waivers: "#waivers", advisor: "#advisor", usage: "#usage", rules: "#rules" };

  function selectTab(tab, { updateUrl = true } = {}) {
    currentTab = tab;
    for (const [key, btn] of Object.entries(tabButtons)) {
      btn.classList.toggle("active", tab === key);
      btn.setAttribute("aria-selected", String(tab === key));
    }
    if (updateUrl) {
      window.history.replaceState(null, "", `${window.location.pathname}${tabHashes[tab]}`);
    }
    renderCurrentTab();
  }

  for (const [tab, btn] of Object.entries(tabButtons)) {
    btn.addEventListener("click", () => selectTab(tab));
  }

  window.addEventListener("hashchange", () => {
    const h = window.location.hash;
    const tab = h === "#calculator" ? "calc" : h === "#waivers" ? "waivers" : h === "#advisor" ? "advisor" : h === "#usage" ? "usage" : h === "#rules" ? "rules" : "finder";
    selectTab(tab, { updateUrl: false });
  });

  selectTab(currentTab, { updateUrl: false });
}
