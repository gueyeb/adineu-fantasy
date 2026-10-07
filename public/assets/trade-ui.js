/**
 * Adineu Fantasy — Interface Utilisateur Trade Hub
 *
 * Gère le Calculateur de Trade interactif et le Moteur de Recommandations.
 */

import { calculatePlayerTradeValue, calculatePlayerTradeProfile, evaluateTrade } from "./trade-value.js?v=c385666df3";
import { diagnoseRoster, findTradeProposals, findCounterOffers } from "./trade-recommender.js?v=d2789d533e";
import { PLAYER_STATUSES, playerKey, playerStatus } from "./trade-preferences.js?v=c5fec5ce56";
import {
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026
} from "./league-settings.js?v=f6d1bf5212";
import { resolveOperationalWeek } from "./nfl-week.js?v=8f9fa3f5b2";
import { listRosterIdentities } from "./roster-view.js?v=120de9d74d";
import { calculateFaabRemaining } from "./team-metrics.js?v=e47db97055";
import { buildProjectedLineup, restOfSeasonEstimate } from "./trade-score.js?v=eae8f8dc83";

import { SLEEPER_API, SLEEPER_LEAGUE_ID, sleeperGet } from "./sleeper-client.js?v=3f75d48ec5";
const SUPABASE_URL = "https://juosrzsffvjprqhdyado.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7Bu9q2dKz0WEol94OGVhHw_xjSwHeHu";

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
  // Valeur reste de saison (projections + usage) et signaux d'usage : même calcul que /api/trades et n8n.
  const [injuryStatuses, playerValues] = await Promise.all([
    fetch("/api/player-status").then(res => res.ok ? res.json() : { statuses: {} }).then(body => body.statuses || {}).catch(() => ({})),
    fetch("/api/player-values").then(res => res.ok ? res.json() : { players: {} }).then(body => body.players || {}).catch(() => ({}))
  ]);

  try {
    const [rosterData, userData, nflState] = await Promise.all([
      sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/rosters`, { optional: true }),
      sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/users`, { optional: true }),
      sleeperGet("/state/nfl", { optional: true })
    ]);
    if (rosterData && userData) {
      rosters = rosterData;
      users = userData;
    }

    if (nflState) {
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
        Object.assign(player, playerValues[pid] || {});
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
    else { renderRulesView(); renderModelFeedback(); }
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
          <p class="note" style="margin:0 0 16px;">Gains = moyenne hebdo de la <strong>lineup optimale</strong> projetée, semaines ${currentWeek ?? "?"}→${GENERAL_SETTINGS_2026.playoffWeekStart - 1} (projections Sleeper + usage, blessures et byes inclus). « Marché » compare la valeur d'échange des deux côtés. Estimations Adineu, pas des garanties.</p>
          <div class="tf-grid">
            ${proposals.map((p, index) => {
              const score = p.recommendationScore;
              const delta = value => value === null ? "—" : `${value > 0 ? "+" : ""}${value}`;
              const badge = { HANDCUFF_INSURANCE: ["gold", "🔒 Menotte"], WIN_WIN: ["grass", "🤝 Win-win"], CONSOLIDATION: ["", "⚡ Consolidation"], LINEUP_UPGRADE: ["", "📈 Upgrade lineup"] }[p.category] || ["", "À étudier"];
              const gap = p.evaluation.pctDiff;
              const market = p.evaluation.verdict === "FAIR" ? ["grass", "Marché équilibré"]
                : p.evaluation.sideA.netTotal > p.evaluation.sideB.netTotal ? ["gold", `Marché : tu donnes +${gap} %`] : ["gold", `Marché : tu reçois +${gap} %`];
              const usageChip = player => player.signal === "BUY_LOW" ? `<span class="chip chip-grass">🟢 Buy-low</span>` : player.signal === "SELL_HIGH" ? `<span class="chip chip-gold">🔥 Sell-high</span>` : "";
              const playerLine = player => `
                <div class="tf-player">
                  <div><strong>${escapeHtml(player.name)}</strong> <small>${escapeHtml(player.position)}${player.nflTeam ? ` · ${escapeHtml(player.nflTeam)}` : ""}${player.injuryStatus ? ` · <span class="tf-injury">${escapeHtml(player.injuryStatus)}</span>` : ""}</small></div>
                  <div class="tf-meta">${Number.isFinite(player.rosPpg) ? `ROS ${player.rosPpg}` : typeof player.projectedPpg === "number" ? `Proj. ${player.projectedPpg}` : ""}${typeof player.actualPpg === "number" ? ` · Moy. ${player.actualPpg}` : ""}${Number.isFinite(player.usageScore) ? ` · Usage ${player.usageScore}` : ""} ${usageChip(player)}</div>
                </div>`;
              return `
                <article class="tf-card">
                  <header class="tf-head">
                    <div><span class="chip ${badge[0] ? `chip-${badge[0]}` : ""}">${badge[1]}</span><h4>${escapeHtml(p.partnerName)}</h4></div>
                    <span class="chip chip-${market[0]}">${escapeHtml(market[1])}</span>
                  </header>
                  <div class="trade-impact-grid">
                    <div><small>Ta lineup</small><strong>${delta(score.my_lineup_delta)} <em>pts/sem</em></strong></div>
                    <div><small>Sa lineup</small><strong>${delta(score.their_lineup_delta)} <em>pts/sem</em></strong></div>
                  </div>
                  <div class="tf-sides">
                    <div class="tf-side tf-give"><span class="tf-label">Tu cèdes</span>${p.give.map(playerLine).join("")}<small class="tf-value">Valeur marché ${p.evaluation.sideA.netTotal}</small></div>
                    <div class="tf-side tf-receive"><span class="tf-label">Tu reçois</span>${p.receive.map(playerLine).join("")}<small class="tf-value">Valeur marché ${p.evaluation.sideB.netTotal}</small></div>
                  </div>
                  <p class="tf-status">Faisabilité <strong>${escapeHtml(score.tradeability)}</strong> · Confiance <strong>${{ HIGH: "bonne", MEDIUM: "moyenne", LOW: "faible" }[score.confidence]}</strong>${score.usageAdjustment ? ` · Usage ${score.usageAdjustment > 0 ? "+" : ""}${score.usageAdjustment}` : ""}</p>
                  ${score.warnings.length ? `<p class="note">⚠ ${score.warnings.map(escapeHtml).join(" · ")}</p>` : ""}
                  ${score.notes?.length ? `<p class="note">ℹ ${score.notes.map(escapeHtml).join(" · ")}</p>` : ""}
                  <details class="trade-lineup-detail"><summary>Lineups avant → après</summary>
                    ${[["Ton équipe", score.lineups.mine], [p.partnerName, score.lineups.theirs]].map(([name, lineups]) => `<h5>${escapeHtml(name)}</h5><div class="table-wrap"><table><thead><tr><th>Slot</th><th>Avant</th><th>Après</th></tr></thead><tbody>${lineups.before.slots.map((slot, i) => `<tr><td>${escapeHtml(slot.slot)}</td><td>${escapeHtml(slot.name)} · ${slot.projectedPpg ?? "—"}</td><td>${escapeHtml(lineups.after.slots[i].name)} · ${lineups.after.slots[i].projectedPpg ?? "—"}</td></tr>`).join("")}</tbody></table></div>`).join("")}
                  </details>
                  <div id="counter-offers-${index}" aria-live="polite"></div>
                  <div class="tf-actions">
                    <button type="button" class="counter-offer-btn filter-btn" data-index="${index}">Contre-offres</button>
                    <button type="button" class="copy-pitch-btn filter-btn" data-pitch="${escapeHtml(`Salut ! Que penses-tu de cet échange : je te propose ${p.give.map(g => g.name).join(" + ")} contre ${p.receive.map(r => r.name).join(" + ")} ? ${p.pitchPartner}`)}">📋 Copier le message</button>
                  </div>
                </article>
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
      .filter(player => player.waiver?.fit && (player.waiver.fit.netGainTotal > 0 || !player.waiver.fit.horizonCovered))
      .sort((a, b) => b.waiver.fit.priorityScore - a.waiver.fit.priorityScore || b.waiver.fit.netGainPerWeek - a.waiver.fit.netGainPerWeek)
      .slice(0, 10);
    const opportunityError = report.rankingModel ? null : "Calcul indisponible pour le moment.";
    const degradedNote = report.degraded ? `⚠ Données partielles (projections ${report.coverage?.projectionWeeks}, stats ${report.coverage?.statsWeeks}) : classement moins fiable, estimation par rang pour certains joueurs.` : "";

    // l'utilisateur a changé d'onglet ou d'équipe pendant le chargement
    if (currentTab !== "waivers" || String(waiverRosterId) !== String(selectedRosterId)) return;

    const rawRoster = rosters.find(r => String(r.roster_id) === String(selectedRosterId));
    const faabRemaining = rawRoster ? calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, rawRoster.settings?.waiver_budget_used) : null;

    const positionOrder = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const metric = value => Number.isFinite(value) ? String(value) : "n/d";
    const signed = value => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value}` : "n/d";
    const date = value => value && Number.isFinite(typeof value === "number" ? value : Date.parse(value)) ? new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "n/d";
    const engineNotes = p => {
      const notes = [];
      const entry = p.poolEntry;
      if (entry?.recentDrop) notes.push("Coupé récemment · déblocage non vérifié");
      if (entry && !entry.valuationCovered) notes.push("Projection absente · aucun gain chiffré");
      if (entry?.reasons?.includes("SOURCED_EVENT")) notes.push("Événement sourcé");
      if (p.roleProfile?.profile) notes.push(`Profil ${p.roleProfile.profile}`);
      if (p.emergingRole?.progression === "RISING") notes.push(`Rôle en hausse (xFP ${p.emergingRole.xfpDelta >= 0 ? "+" : ""}${p.emergingRole.xfpDelta}/sem, ${p.emergingRole.progressionSource === "ORGANIC" ? "organique" : "coïncide avec une absence"})`);
      if (["NOT_JUSTIFIED", "UNPRICED"].includes(p.waiver?.fit?.progressionGuard)) notes.push("Couperait une progression organique sans gain net documenté");
      if (p.ripple?.length) notes.push(`À réévaluer : ${p.ripple.map(row => `${row.triggerName || row.triggerPlayerId} ${row.triggerStatus || row.type}`).join(", ")} (aucune part attribuée)`);
      const next = p.nextUnlockScenario;
      if (next) notes.push(next.status === "EVALUATED"
        ? `Scénario S${next.startWeek} (non exécutable, déblocage ${next.unlockVerified ? "vérifié" : "non vérifié"}) : net ${next.netGainTotal ?? "n/d"} pts · coupe ${next.dropCandidate?.name || "n/d"} · plafond indicatif ${next.indicativeMaxBid ?? "n/d"} $`
        : `Prochain déblocage : ${next.status}`);
      return notes.join(" · ");
    };
    const availabilityText = p => [`${p.availability?.availability || "UNKNOWN"}${p.availability?.availabilitySource === "LEAGUE_RULES_INFERRED" ? " (déduite — à confirmer dans Sleeper)" : ""} · ${p.waiver?.decision?.recommendedAction || "WATCH"}`, engineNotes(p)].filter(Boolean).join(" · ");
    const money = range => range && range[1] > 0 ? `${range[0]}–${range[1]} $` : "—";
    const usageCell = w => Number.isFinite(w.usageScore) ? `${w.usageScore}${w.usageSignal === "BUY_LOW" ? " 🟢" : w.usageSignal === "SELL_HIGH" ? " 🔥" : ""}` : "—";
    const positionCards = positionOrder
      .map(pos => {
        const players = report.byPosition?.[pos] || [];
        if (players.length === 0) return "";
        return `
          <h4 class="fa-pos">${pos}</h4>
          <div class="table-wrap fa-table"><table>
            <colgroup><col class="fa-col-player"><col class="fa-col-cat"><col><col><col class="fa-col-money"><col><col class="fa-col-money"></colgroup>
            <thead><tr><th>Joueur</th><th>Catégorie</th><th class="num" title="Points par semaine attendus d'ici la S14 (rôle actuel inclus)">Pts/sem</th><th class="num">Usage</th><th class="num">FAAB marché</th><th class="num" title="Part du surplus marché captée par ta lineup">Capture</th><th class="num">Max pour toi</th></tr></thead>
            <tbody>${players.map(p => `<tr>
              <td><strong>${escapeHtml(p.name)}</strong> <small>${escapeHtml(p.nflTeam || "FA")}${p.injuryStatus ? ` · ${escapeHtml(p.injuryStatus)}` : ""}</small><br><small>${escapeHtml(availabilityText(p))}</small>${p.waiver?.newsOverride ? `<br><small class="fa-news">⚡ ${escapeHtml(p.waiver.reasons.join(" · "))}</small>` : ""}</td>
              <td>${escapeHtml(p.waiver?.category || "—")}</td>
              <td class="num" title="${escapeHtml({ SLEEPER_USAGE_BLEND: "Base : projections Sleeper + usage", RANK_ESTIMATE: "Base : estimation par rang", SLEEPER_PROJECTIONS: "Base : projections Sleeper" }[p.waiver?.rosSource] || "")}">${Number.isFinite(p.effectivePpg) ? p.effectivePpg : p.waiver?.rosPpg ?? "—"}${p.waiver?.rosSource === "RANK_ESTIMATE" ? "*" : ""}${Number.isFinite(p.effectivePpg) && Number.isFinite(p.waiver?.rosPpg) && Math.abs(p.effectivePpg - p.waiver.rosPpg) >= 0.5 ? `<br><small>ROS ${p.waiver.rosPpg}</small>` : ""}</td>
              <td class="num">${p.waiver ? usageCell(p.waiver) : "—"}</td>
              <td class="num">${money(p.waiver?.faabMarket)}</td>
              <td class="num">${p.waiver?.fit ? p.waiver.fit.fitScore : "—"}</td>
              <td class="num"><strong>${Number.isFinite(p.waiver?.personalMaxBid) ? `${p.waiver.personalMaxBid} $` : p.waiver?.maxBidStatus === "NOT_DETERMINED_UNCALIBRATED_POTENTIAL" ? "non déterminé" : "n/d"}</strong></td>
            </tr>`).join("")}</tbody>
          </table></div>`;
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
        <details class="card" style="padding:12px 16px; margin-bottom:16px;"><summary>Transactions récentes · 72 h (${report.recentTransactions?.length || 0})</summary><p>Propriété relue après transactions : ${report.ownershipRechecked ? "oui" : "non"}. Snapshot non atomique. Disponibilité au ${escapeHtml(date(report.availabilityAsOf))}. ${report.transactionsTruncatedCount || 0} transaction(s) non affichée(s).</p>${(report.recentTransactions || []).map(t => `<p>${escapeHtml(date(Number(t.status_updated ?? t.created)))} · ${escapeHtml(t.status)} · ajouts ${escapeHtml(Object.keys(t.adds || {}).join(", ") || "—")} · coupes ${escapeHtml(Object.keys(t.drops || {}).join(", ") || "—")}${t.relevant ? " · touche le roster ou les candidats" : ""}</p>`).join("")}</details>
        ${(report.rosterPreferences || []).length ? `<details class="card" style="padding:12px 16px; margin-bottom:16px;"><summary>Préférences temporaires (${report.rosterPreferences.length})</summary>${report.rosterPreferences.map(pref => `<p>${escapeHtml(pref.playerId)} · ${escapeHtml(pref.reason)} · jusqu’au ${escapeHtml(date(pref.expiresAt))} · pénalité de préférence ${pref.penaltyPoints} points d’utilité (pas des points fantasy)</p>`).join("")}</details>` : ""}
        ${report.acquisitionPlan ? `<details class="card" style="padding:12px 16px; margin-bottom:16px;"><summary>Plan conditionnel d’acquisition (${report.acquisitionPlan.steps.length}) · ${report.acquisitionPlan.reservedFaab} $ réservés</summary><p>Gains recalculés après chaque ajout prévu. Suppose les succès précédents ; vérifier les résultats, le roster et les déblocages avant chaque action. Plan glouton, sans garantie d’optimalité ni de gagner une enchère.</p><ol>${report.acquisitionPlan.steps.map(step => `<li>${escapeHtml(step.name)} · coupe ${escapeHtml(step.dropCandidate?.name || "place libre")} · enchère ${step.suggestedBid} $ · budget après ${step.budgetAfter} $ · gain marginal ${step.netGainTotal} pts${step.preferenceOverridden ? ` · préférence temporaire dépassée (${step.preferencePenaltyTotal} points d’utilité)` : ""}</li>`).join("")}</ol>${report.acquisitionPlan.conflicts.length ? `<p>${report.acquisitionPlan.conflicts.length} conflit(s) de coupe entre les options individuelles ; le plan affecte des coupes distinctes.</p>` : ""}</details>` : ""}
        <h3 style="margin:0 0 6px; font-size:1.2rem;">Scénarios ajout–coupe pour ton équipe${currentWeek ? ` · Semaine ${currentWeek}` : ""}</h3>
        <p class="note" style="margin:0 0 16px;">« Capture » = part du surplus marché qui atteint ta lineup, pas une note de fit. Chaque scénario recalcule la lineup après ajout et coupe. Le gain net retire une estimation de la valeur d’option du banc sur le même horizon. « Max pour toi » tient compte de ce coût et reste plafonné par ton FAAB. Estimations Adineu, jamais une probabilité de gagner l'enchère. Les scénarios sont alternatifs : deux claims partageant une coupe ne peuvent pas être exécutés ensemble.</p>
        ${opportunityError ? `
          <div class="card" style="padding:20px; text-align:center; color:var(--muted); margin-bottom:28px;">${escapeHtml(opportunityError)}</div>
        ` : opportunities.length === 0 ? `
          <div class="card" style="padding:20px; text-align:center; color:var(--muted); margin-bottom:28px;">Aucun scénario positif ou à compléter pour cette équipe.</div>
        ` : `
          <div class="table-wrap waiver-scenarios" style="margin-bottom:28px;">
            <table>
              <thead><tr><th>Joueur</th><th>Priorité</th><th>Delta S${currentWeek || report.week}</th><th>Coupe</th><th>Horizon / coût option</th><th>Gain net total</th><th>FAAB marché estimé</th><th>Proposé / plafond</th></tr></thead>
              <tbody>
                ${opportunities.map(p => `
                  <tr>
                    <td>${escapeHtml(p.name)} <small style="color:var(--muted);">(${escapeHtml(p.position)}${p.nflTeam ? ` ${escapeHtml(p.nflTeam)}` : ""})</small><br><small>${escapeHtml(availabilityText(p))}</small><br><small>Kickoff ${escapeHtml(date(p.availability?.kickoffAt))} · waiver ${escapeHtml(date(p.availability?.waiverProcessesAt))}</small>${p.waiver.newsOverride ? `<br><small style="color:var(--gold);">⚡ ${escapeHtml(p.waiver.reasons.join(" · "))}</small>` : ""}</td>
                    <td>${p.waiver.fit.priorityScore}</td>
                    <td>${signed(p.waiver.fit.targetWeekDelta)} pts</td>
                    <td>${escapeHtml(p.waiver.fit.dropCandidate?.name || "—")}${p.waiver.fit.cutSelection === "ONLY_ELIGIBLE_CUT" ? "<br><small>Seule coupe éligible (autres joueurs verrouillés)</small>" : p.waiver.fit.cutSelection === "UNRANKED_INCOMPLETE_COVERAGE" ? "<br><small>Aucune coupe désignée : couverture incomplète</small>" : ""}${p.waiver.fit.preferenceOverridden ? `<br><small>Préférence dépassée : ${escapeHtml(p.waiver.fit.appliedPreference.reason)}</small>` : ""}</td>
                    <td>${metric(p.waiver.fit.horizonWeeks)} sem<br><small>Option coupe : ${metric(p.waiver.fit.dropCostTotal)} pts estimés<br>Perte après rôle : ${metric(p.waiver.fit.postRoleCutCostTotal)} pts</small></td>
                    <td style="font-weight:700;">${signed(p.waiver.fit.netGainTotal)} pts<br><small>Brut ${metric(p.waiver.fit.grossGainTotal)} · moyenne rôle ${metric(p.waiver.fit.netGainAverage)} pts/sem</small><details><summary>Détail par semaine</summary>${p.waiver.fit.weeklyLineupDeltas.map(row => `<div>S${row.week} : ${signed(row.delta)} pts · ${escapeHtml(row.slot || "banc")} ${row.covered ? "" : "· projection manquante"}</div>`).join("")}<p>${escapeHtml(p.waiver.fit.coverageIssues.join(" · "))}</p></details></td>
                    <td>${money(p.waiver.faabMarket)}</td>
                    <td style="font-weight:700;">${metric(p.waiver.suggestedBid)} $ / ${metric(p.waiver.personalMaxBid)} $<br><small>${metric(p.waiver.bidPctInitial)} % initial · ${metric(p.waiver.bidPctRemaining)} % restant</small></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}

        ${(report.trending || []).length ? `<details class="trade-lineup-detail fold-section"><summary>Tendances Sleeper · 48 h — ${report.trending.filter(t => !t.rostered).length} joueur(s) encore libre(s)</summary>
          <p class="note" style="margin:0 0 12px;">Joueurs les plus ajoutés sur toute la plateforme Sleeper, croisés avec la ligue Adineu et le modèle waiver.</p>
          <div class="table-wrap" style="margin-bottom:28px;"><table>
            <thead><tr><th>Joueur</th><th class="num">Ajouts</th><th>Dans Adineu</th><th>Marché</th><th>Max pour toi</th></tr></thead>
            <tbody>${report.trending.map(t => `<tr>
              <td>${escapeHtml(t.name)} <small style="color:var(--muted);">(${escapeHtml(t.position || "?")}${t.nflTeam ? ` ${escapeHtml(t.nflTeam)}` : ""})</small>${t.waiver?.newsOverride ? `<br><small style="color:var(--gold);">⚡ ${escapeHtml(t.waiver.reasons.join(" · "))}</small>` : ""}</td>
              <td class="num">${Number(t.adds).toLocaleString("fr-FR")}</td>
              <td>${t.rostered ? `Rosté · ${escapeHtml(t.rosteredBy || "?")}` : t.injuryStatus ? `Libre · ${escapeHtml(t.injuryStatus)}` : "<strong>Libre</strong>"}</td>
              <td>${t.waiver ? `${escapeHtml(t.waiver.category)} · ${money(t.waiver.faabMarket)}` : "—"}</td>
              <td>${t.waiver?.fit ? `${t.waiver.fit.faabMaxForMe} $` : "—"}</td>
            </tr>`).join("")}</tbody>
          </table></div></details>` : ""}

        ${(report.faabHistory || []).length ? `<details class="trade-lineup-detail fold-section"><summary>Historique FAAB de la ligue — ${report.faabHistory.length} enchères, max ${report.faabHistory[0].bid} $</summary>
          <p class="note" style="margin:0 0 12px;">Enchères gagnées cette saison (Sleeper). ${Object.entries(report.faabByPosition || {}).map(([pos, stat]) => `${escapeHtml(pos)} : médiane ${stat.median} $ · max ${stat.max} $`).join(" · ")}</p>
          <div class="table-wrap" style="margin-bottom:28px;"><table>
            <thead><tr><th>Sem.</th><th>Joueur</th><th>Équipe</th><th class="num">Enchère</th></tr></thead>
            <tbody>${report.faabHistory.slice(0, 15).map(c => `<tr>
              <td>S${c.week}</td>
              <td>${escapeHtml(c.name)} <small style="color:var(--muted);">(${escapeHtml(c.position || "?")})</small></td>
              <td>${escapeHtml(c.team || "?")}</td>
              <td class="num"><strong>${c.bid} $</strong></td>
            </tr>`).join("")}</tbody>
          </table></div></details>` : ""}

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:1.2rem;">Candidats hors roster${report.week ? ` · Semaine ${report.week}` : ""}</h3>
            <p style="margin:0; color:var(--muted); font-size:0.82rem;">Classés par valeur marché reste de saison : projections Sleeper sem. ${report.week || "?"}→14, usage réel (snaps, opportunités) et événements ⚡ (titulaire blessé devant, explosion d'usage).</p>
          </div>
          <button type="button" id="copy-waiver-btn" class="filter-btn" style="padding:8px 14px; font-size:0.75rem;">📋 Copier le rapport Waiver Wire</button>
        </div>
        <p class="note" style="margin:0 0 8px;">Pts/sem = points attendus par semaine d'ici la S14, rôle actuel inclus (sous-ligne ROS = projection de base quand un événement ⚡ la modifie ; * = estimation par rang). Usage = Usage Score 0–100 (🟢 buy-low, 🔥 sell-high), diagnostic de production vs xFP estimé : aucune consigne de coupe ni garantie de rebond. Disponibilité vérifiée séparément ; un joueur hors roster peut rester en waiver. Fit = part de la valeur qui passe dans <em>ta</em> lineup.</p>
        <div>
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
    let startSit = null;
    const requestedRosterId = selectedRosterId;
    try {
      const [res, sitRes] = await Promise.all([
        fetch(`/api/lineup-advisor?team=${encodeURIComponent(requestedRosterId)}`),
        fetch(`/api/start-sit?team=${encodeURIComponent(requestedRosterId)}`).catch(() => null)
      ]);
      if (res.ok) advisory = await res.json();
      if (sitRes?.ok) startSit = await sitRes.json();
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
        ? `${escapeHtml(alert.replacement.player.name)} <small style="color:var(--muted);">(${escapeHtml(alert.replacement.player.position)}${alert.replacement.player.nflTeam ? " " + escapeHtml(alert.replacement.player.nflTeam) : ""} · ${alert.replacement.source === "bench" ? "banc" : "cible à acquérir"})</small>${alert.advice ? `<br><small>${escapeHtml(alert.advice)}</small>` : ""}`
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
        ${startSit ? `
          ${startSit.lineups ? boomSafeCard(startSit.lineups) : ""}
          <h3 style="margin:28px 0 6px; font-size:1.2rem;">Ton roster cette semaine</h3>
          <p class="note" style="margin:0 0 10px;">Matchup = points concédés par l'adversaire à ce poste depuis le début de saison (semaines ${startSit.completedWeeks.join(", ") || "—"}), ramenés vers la moyenne tant que l'échantillon est petit. Rang 1 = défense la plus généreuse.</p>
          ${startSitTable(startSit.players, { markStarters: true })}
          <h3 style="margin:28px 0 6px; font-size:1.2rem;">Comparer jusqu'à ${MAX_COMPARE} joueurs</h3>
          <div class="compare-bar">
            <input type="text" id="compare-input" list="compare-datalist" autocomplete="off" placeholder="Nom d'un joueur…" aria-label="Ajouter un joueur à comparer">
            <datalist id="compare-datalist">${(catalog.players || []).filter(player => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position)).map(player => `<option value="${escapeHtml(player.name)}"></option>`).join("")}</datalist>
            <button type="button" id="compare-add" class="filter-btn">Ajouter</button>
            <button type="button" id="compare-run" class="filter-btn">Comparer</button>
          </div>
          <div id="compare-chips" class="compare-chips"></div>
          <div id="compare-result" aria-live="polite"></div>` : ""}
      </div>
    `;
    bindComparator();

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

  // Comparateur Start/Sit (benchmark Fantasy Life, lot 3) : projection, matchup DvP, usage, statut.
  const MAX_COMPARE = 8;
  const compareIds = [];
  function startSitTable(players, { markStarters = false } = {}) {
    const best = Math.max(...players.map(player => player.projection ?? -Infinity));
    const matchupChip = matchup => !matchup ? "—"
      : matchup.label === "BYE" ? `<span class="chip">Bye</span>`
      : `<span class="chip ${matchup.label === "FACILE" ? "chip-grass" : matchup.label === "DIFFICILE" ? "chip-red" : ""}">${escapeHtml(matchup.opponent)} · ${matchup.label === "FACILE" ? "facile" : matchup.label === "DIFFICILE" ? "difficile" : "neutre"}${matchup.rank ? ` (${matchup.rank}e)` : ""}</span>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Joueur</th>${markStarters ? "<th>Rôle</th>" : ""}<th class="num">Proj. semaine</th><th class="num" title="20e percentile : 4 semaines sur 5 au-dessus">Plancher</th><th class="num" title="80e percentile : 1 semaine sur 5 au-dessus">Plafond</th><th class="num" title="Probabilité d'une grosse semaine (QB ≥ 25, RB/WR ≥ 20, TE ≥ 15, K/DEF ≥ 12)">Boom</th><th class="num" title="Probabilité d'une semaine ratée (QB ≤ 12, RB/WR ≤ 6, TE ≤ 4, K ≤ 4, DEF ≤ 2)">Bust</th><th>Matchup</th><th class="num">ROS</th><th class="num">Usage</th><th>Statut</th></tr></thead>
      <tbody>${players.map(player => `<tr${!markStarters && player.projection === best && best > 0 ? ' class="compare-best"' : ""}>
        <td><strong>${escapeHtml(player.name)}</strong> <small style="color:var(--muted);">${escapeHtml(player.position || "?")}${player.nflTeam ? ` · ${escapeHtml(player.nflTeam)}` : ""}</small></td>
        ${markStarters ? `<td>${player.starter ? "Titulaire" : "Banc"}</td>` : ""}
        <td class="num"><strong>${player.projection ?? "—"}</strong></td>
        <td class="num">${player.floor ?? "—"}</td>
        <td class="num">${player.ceiling ?? "—"}</td>
        <td class="num">${Number.isFinite(player.boomPct) ? `${player.boomPct} %` : "—"}</td>
        <td class="num">${Number.isFinite(player.bustPct) ? `${player.bustPct} %` : "—"}</td>
        <td>${matchupChip(player.matchup)}</td>
        <td class="num">${player.rosPpg ?? "—"}</td>
        <td class="num">${player.usageScore ?? "—"}${player.signal === "BUY_LOW" ? " 🟢" : player.signal === "SELL_HIGH" ? " 🔥" : ""}</td>
        <td>${player.injuryStatus ? `<span class="tf-injury">${escapeHtml(player.injuryStatus)}</span>` : "OK"}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  // Boom / Safe : quelle lineup jouer selon tes chances cette semaine (docs/prd-boom-bust-qb-usage.md).
  function boomSafeCard(lineups) {
    const label = { BOOM: "Boom (chercher le plafond)", SAFE: "Safe (sécuriser le plancher)", OPTIMAL: "Optimale (projection)" };
    const changes = (lineup, reference) => {
      const ids = new Set(lineup.slots.map(slot => slot.sleeperId));
      const refIds = new Set(reference.slots.map(slot => slot.sleeperId));
      const promote = lineup.slots.filter(slot => slot.sleeperId && !refIds.has(slot.sleeperId)).map(slot => slot.name);
      const bench = reference.slots.filter(slot => slot.sleeperId && !ids.has(slot.sleeperId)).map(slot => slot.name);
      return `Titulariser ${promote.map(escapeHtml).join(", ")} · Asseoir ${bench.map(escapeHtml).join(", ")}`;
    };
    const row = (name, lineup, differs) => `<tr><td>${name}</td><td class="num">${lineup.projection}</td><td class="num">${lineup.floor}</td><td class="num">${lineup.ceiling}</td><td>${differs === false ? "Identique à l'optimale" : differs ? changes(lineup, lineups.optimal) : "—"}</td></tr>`;
    const mode = lineups.recommended || "OPTIMAL";
    return `<div class="card" style="padding:16px 18px; margin:20px 0; border-left:4px solid var(--grass);">
      <strong>Lineup selon ton match :</strong> ${Number.isFinite(lineups.winPct) ? `${lineups.winPct} % de chances estimées (${lineups.optimal.projection} pts projetés contre ${lineups.opponent.projection}). ` : "adversaire de la semaine pas encore publié. "}Mode conseillé : <strong>${label[mode]}</strong>.
      <div class="table-wrap" style="margin-top:10px;"><table>
        <thead><tr><th>Lineup</th><th class="num">Projection</th><th class="num" title="Somme des planchers individuels (prudent : tous les joueurs ne ratent pas leur semaine en même temps)">Σ planchers</th><th class="num" title="Somme des plafonds individuels">Σ plafonds</th><th>Changements vs optimale</th></tr></thead>
        <tbody>${row("Actuelle", lineups.current)}${row("Optimale", lineups.optimal, false)}${row("Boom", lineups.boom, lineups.boomDiffers)}${row("Safe", lineups.safe, lineups.safeDiffers)}</tbody>
      </table></div>
      <small style="color:var(--muted);">Plancher / plafond = 20e / 80e percentile, calibrés sur 31 000 matchs réels (2021–2025). Outsider (&lt; 40 %) : vise le plafond ; favori (&gt; 60 %) : sécurise le plancher. Estimation Adineu.</small>
    </div>`;
  }

  function bindComparator() {
    const input = document.getElementById("compare-input");
    if (!input) return;
    const chips = document.getElementById("compare-chips");
    const renderChips = () => {
      chips.innerHTML = compareIds.map(id => `<button type="button" class="chip compare-chip" data-id="${escapeHtml(id)}" title="Retirer">${escapeHtml(playerMap.get(id)?.name || id)} ✕</button>`).join("");
      chips.querySelectorAll(".compare-chip").forEach(chip => chip.addEventListener("click", () => {
        compareIds.splice(compareIds.indexOf(chip.dataset.id), 1);
        renderChips();
      }));
    };
    const add = () => {
      const player = playerMap.get(input.value.trim());
      if (player && !compareIds.includes(player.sleeperId) && compareIds.length < MAX_COMPARE) compareIds.push(player.sleeperId);
      input.value = "";
      renderChips();
    };
    document.getElementById("compare-add").addEventListener("click", add);
    input.addEventListener("keydown", event => { if (event.key === "Enter") add(); });
    document.getElementById("compare-run").addEventListener("click", async () => {
      const result = document.getElementById("compare-result");
      if (compareIds.length < 2) { result.innerHTML = `<p class="note">Ajoute au moins 2 joueurs.</p>`; return; }
      result.innerHTML = `<p class="note">Comparaison…</p>`;
      try {
        const res = await fetch(`/api/start-sit?ids=${compareIds.map(encodeURIComponent).join(",")}`);
        const body = await res.json();
        const sorted = [...body.players].sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1));
        result.innerHTML = startSitTable(sorted) + `<p class="note">Classé par projection de la semaine. Le matchup et l'usage départagent les cas serrés ; un joueur Out vaut 0.</p>`;
      } catch {
        result.innerHTML = `<p class="note">Comparaison indisponible pour le moment.</p>`;
      }
    });
    renderChips();
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
        <td class="num">${p.position === "QB" ? "—" : `${p.targetShare}%`}</td>
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
    const leaders = ["QB", "RB", "WR", "TE"].map(pos => `<details class="trade-lineup-detail"><summary>Top 20 usage · ${pos}</summary>${table(report.players.filter(p => p.position === pos).slice(0, 20), { owner: true })}</details>`).join("");

    content.innerHTML = `
      <div class="shell">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
          <div>
            <label for="usage-roster-select" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); font-weight:700; display:block; margin-bottom:6px;">Équipe analysée :</label>
            <select id="usage-roster-select" style="padding:10px 14px; background:var(--panel); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
              ${formattedRosters.map(r => `<option value="${r.roster_id}" ${String(r.roster_id) === String(selectedRosterId) ? "selected" : ""}>${escapeHtml(r.name)} (@${escapeHtml(r.ownerName)})</option>`).join("")}
            </select>
          </div>
          <p class="note" style="margin:0; max-width:640px;"><strong>Usage Score (0–100)</strong> = rang, parmi les joueurs du même poste, de la part de l'attaque de son équipe qu'il reçoit (targets, air yards, snaps, courses, red zone ; semaines ${report.weeks.join(", ")}, les plus récentes comptent plus). <strong>xFP</strong> = points attendus pour ce volume. <strong>Buy-low</strong> : il produit ≥ 3 pts/match sous son volume. <strong>Sell-high</strong> : ≥ 4 pts au-dessus (TD, big plays), hors usage élite. QB : dropbacks, courses, red zone et profondeur des passes (seuils ± 5 pts) ; l'usage QB sert aux signaux, pas aux projections (backtest : il ne les améliore pas). Routes : non disponibles gratuitement.</p>
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

  // Bilan hebdo du modèle (scripts/model-tracking.js, table model_feedback en lecture publique).
  async function renderModelFeedback() {
    const target = document.getElementById("model-feedback");
    if (!target) return;
    let rows = [];
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/model_feedback?select=season,week,generated_at,report&order=season.desc,week.desc&limit=4`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` }
      });
      if (res.ok) rows = await res.json();
    } catch { /* bloc facultatif : la page reste utilisable */ }
    if (!document.getElementById("model-feedback")) return;
    if (!rows.length) { target.innerHTML = `<p class="note">Premier bilan après la prochaine semaine jouée.</p>`; return; }
    const latest = rows[0].report;
    const pct = value => value === null || value === undefined ? "—" : `${Math.round(value * 100)} %`;
    target.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Semaine</th><th class="num">Enchères gagnées</th><th class="num">Couvertes par le modèle</th><th class="num">Dans la fourchette</th><th class="num">Prix payé / pt (médiane)</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>S${row.week}</td><td class="num">${row.report.faab.claims}</td><td class="num">${row.report.faab.covered}</td><td class="num">${pct(row.report.faab.inRangeRate)}</td><td class="num">${row.report.faab.medianImpliedPricePerPoint ?? "—"}${row.report.faab.medianImpliedPricePerPoint !== null ? " $" : ""}</td></tr>`).join("")}</tbody>
      </table></div>
      ${latest.projections.length ? `<p class="note">Projections Sleeper, S${latest.week} : ${latest.projections.map(entry => `${entry.horizon} sem. avant → ${entry.mae} pts d'erreur`).join(" · ")}</p>` : `<p class="note">La précision des projections selon leur ancienneté apparaîtra dès que des snapshots antérieurs seront disponibles.</p>`}
      ${latest.algoFeedback.length ? `<div class="card" style="padding:12px 16px; border-left:4px solid var(--gold);"><strong>ALGO FEEDBACK</strong><ul style="margin:6px 0 0; padding-left:18px;">${latest.algoFeedback.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      <p class="note">Modèle ${escapeHtml(latest.modelVersion)} · prix du point ${latest.faab.pricePerPoint} $ · bilan généré chaque mardi.</p>`;
  }

  function renderRulesView() {
    content.innerHTML = `
      <div class="shell">
        <h3 style="margin:0 0 6px; font-size:1.2rem;">Suivi du modèle</h3>
        <p class="note" style="margin:0 0 10px;">Chaque mardi, le modèle est confronté à la réalité : enchères FAAB gagnées vs estimées, précision des projections, suivi des signaux buy-low / sell-high.</p>
        <div id="model-feedback" style="margin-bottom:32px;"><p class="note">Chargement du bilan…</p></div>
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
