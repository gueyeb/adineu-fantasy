/**
 * Adineu Fantasy — Interface Utilisateur Trade Hub
 *
 * Gère le Calculateur de Trade interactif et le Moteur de Recommandations.
 */

import { calculatePlayerTradeValue, evaluateTrade } from "./trade-value.js?v=2";
import { diagnoseRoster, findTradeProposals } from "./trade-recommender.js?v=2";
import {
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026
} from "./league-settings.js";

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
          <button id="tab-rules-btn" class="filter-btn" type="button" role="tab" aria-controls="trade-content">Règles & Scoring 2026</button>
        </div>
      </div>
    </section>

    <section class="section" id="trade-content">
      <div class="shell state">Chargement des rosters et du marché…</div>
    </section>
  `;

  // 1. Charger le catalogue et les données Sleeper
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
  try {
    const [rRes, uRes] = await Promise.all([
      fetch(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/rosters`),
      fetch(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/users`)
    ]);
    if (rRes.ok && uRes.ok) {
      rosters = await rRes.json();
      users = await uRes.json();
    }
  } catch (e) {
    console.warn("Erreur chargement Sleeper API", e);
  }

  const userById = new Map(users.map(u => [u.user_id, u]));
  const formattedRosters = rosters.map(r => {
    const user = userById.get(r.owner_id);
    const ownerName = user?.display_name || `Manager ${r.roster_id}`;
    const teamName = user?.metadata?.team_name || ownerName;

    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      ownerName,
      name: teamName,
      players: (r.players || []).map(pid => {
        const found = playerMap.get(pid);
        if (found) return found;
        return { sleeperId: pid, name: `Player #${pid}`, position: "FLEX" };
      })
    };
  });

  const content = document.getElementById("trade-content");
  let currentTab = window.location.hash === "#calculator" ? "calc" : "finder";
  let selectedRosterId = formattedRosters.find(r => r.ownerName.toLowerCase() === "t0z")?.roster_id || formattedRosters[0]?.roster_id || 1;

  function renderCurrentTab() {
    if (currentTab === "finder") {
      renderFinderView();
    } else {
      renderCalculatorView();
    }
  }

  function renderFinderView() {
    const currentRoster = formattedRosters.find(r => String(r.roster_id) === String(selectedRosterId));
    if (!currentRoster) {
      content.innerHTML = `<div class="shell state">Aucun roster trouvé.</div>`;
      return;
    }

    const diag = diagnoseRoster(currentRoster.players);
    const proposals = findTradeProposals({
      targetRosterId: selectedRosterId,
      rosters: formattedRosters,
      playerCatalog: playerMap
    });

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

        <h3 style="margin:24px 0 16px; font-size:1.2rem;">Opportunités de Trades Détectées (${proposals.length})</h3>

        ${proposals.length === 0 ? `
          <div class="card" style="padding:24px; text-align:center; color:var(--muted);">
            Aucun trade bilatéral évident n'a été détecté pour cette configuration d'équipe.
          </div>
        ` : `
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:20px;">
            ${proposals.map(p => {
              const catBadge = p.category === "HANDCUFF_INSURANCE"
                ? `<span style="background:rgba(255,180,67,0.15); color:var(--gold); border:1px solid var(--gold); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">🔒 SÉCURITÉ MENOTTE</span>`
                : p.category === "WIN_WIN"
                ? `<span style="background:rgba(184,255,61,0.15); color:var(--grass); border:1px solid var(--grass); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">🤝 WIN-WIN</span>`
                : `<span style="background:rgba(159,177,168,0.15); color:var(--ink); border:1px solid var(--line); font-size:0.7rem; padding:3px 8px; border-radius:3px; font-weight:700;">⚡ CONSOLIDATION</span>`;

              const verdictColor = p.evaluation.verdict === "FAIR" ? "var(--grass)" : "var(--gold)";

              return `
                <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                      <div>
                        ${catBadge}
                        <h4 style="margin:8px 0 2px; font-size:1rem; color:var(--ink);">${escapeHtml(p.partnerName)}</h4>
                      </div>
                      <span style="font-size:0.75rem; color:${verdictColor}; font-weight:700;">${p.evaluation.label}</span>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0; padding:12px; background:var(--paper-soft); border-radius:4px; border:1px solid var(--line);">
                      <div>
                        <span style="font-size:0.68rem; text-transform:uppercase; color:var(--red); font-weight:700; display:block; margin-bottom:4px;">Tu Cèdes</span>
                        ${p.give.map(g => `<div style="font-size:0.85rem; font-weight:600;">${escapeHtml(g.name)} <small style="color:var(--muted);">(${escapeHtml(g.position)})</small></div>`).join("")}
                        <div style="font-size:0.7rem; color:var(--muted); margin-top:4px;">Valeur nette : ${p.evaluation.sideA.netTotal} pts</div>
                      </div>
                      <div>
                        <span style="font-size:0.68rem; text-transform:uppercase; color:var(--grass); font-weight:700; display:block; margin-bottom:4px;">Tu Reçois</span>
                        ${p.receive.map(r => `<div style="font-size:0.85rem; font-weight:600;">${escapeHtml(r.name)} <small style="color:var(--muted);">(${escapeHtml(r.position)})</small></div>`).join("")}
                        <div style="font-size:0.7rem; color:var(--muted); margin-top:4px;">Valeur nette : ${p.evaluation.sideB.netTotal} pts</div>
                      </div>
                    </div>

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
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:24px; margin-bottom:28px;">
          <!-- SIDE A -->
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <h3 style="margin:0 0 14px; font-size:1.1rem; color:var(--red);">Équipe A (Donne)</h3>
            <div style="margin-bottom:14px;">
              <select id="calc-add-a" style="width:100%; padding:10px; background:var(--paper-soft); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
                <option value="">+ Ajouter un joueur...</option>
                ${allPlayers.slice(0, 180).map(p => `
                  <option value="${escapeHtml(p.sleeperId)}">${escapeHtml(p.name)} (${escapeHtml(p.position)} - ${escapeHtml(p.nflTeam || "NFL")}) · Valeur ~${calculatePlayerTradeValue(p)}</option>
                `).join("")}
              </select>
            </div>
            <div id="side-a-list" style="min-height:120px; display:flex; flex-direction:column; gap:8px;">
              <span style="color:var(--muted); font-size:0.85rem;">Aucun joueur sélectionné.</span>
            </div>
          </div>

          <!-- SIDE B -->
          <div class="card" style="background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:20px;">
            <h3 style="margin:0 0 14px; font-size:1.1rem; color:var(--grass);">Équipe B (Reçoit)</h3>
            <div style="margin-bottom:14px;">
              <select id="calc-add-b" style="width:100%; padding:10px; background:var(--paper-soft); border:1px solid var(--line); color:var(--ink); font-weight:600; border-radius:4px;">
                <option value="">+ Ajouter un joueur...</option>
                ${allPlayers.slice(0, 180).map(p => `
                  <option value="${escapeHtml(p.sleeperId)}">${escapeHtml(p.name)} (${escapeHtml(p.position)} - ${escapeHtml(p.nflTeam || "NFL")}) · Valeur ~${calculatePlayerTradeValue(p)}</option>
                `).join("")}
              </select>
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

        <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:24px; align-items:center; max-width:600px; margin:0 auto 16px;">
          <div>
            <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase;">Valeur nette Équipe A</div>
            <div style="font-size:2rem; font-weight:800; color:var(--red); font-family:var(--display);">${evalTrade.sideA.netTotal}</div>
            <div style="font-size:0.75rem; color:var(--muted);">Brut : ${evalTrade.sideA.rawTotal} pts</div>
          </div>
          <div style="font-size:1.5rem; color:var(--muted); font-weight:700;">VS</div>
          <div>
            <div style="font-size:0.75rem; color:var(--muted); text-transform:uppercase;">Valeur nette Équipe B</div>
            <div style="font-size:2rem; font-weight:800; color:var(--grass); font-family:var(--display);">${evalTrade.sideB.netTotal}</div>
            <div style="font-size:0.75rem; color:var(--muted);">Brut : ${evalTrade.sideB.rawTotal} pts</div>
          </div>
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

    document.getElementById("calc-add-a")?.addEventListener("change", (e) => {
      const pid = e.target.value;
      if (!pid) return;
      const player = playerMap.get(pid);
      if (player && sideA.length < 3) {
        sideA.push(player);
        renderSideList(sideA, "side-a-list");
        updateCalcResult();
      }
      e.target.value = "";
    });

    document.getElementById("calc-add-b")?.addEventListener("change", (e) => {
      const pid = e.target.value;
      if (!pid) return;
      const player = playerMap.get(pid);
      if (player && sideB.length < 3) {
        sideB.push(player);
        renderSideList(sideB, "side-b-list");
        updateCalcResult();
      }
      e.target.value = "";
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
  const tabRulesBtn = document.getElementById("tab-rules-btn");

  function selectTab(tab, { updateUrl = true } = {}) {
    currentTab = tab;
    tabFinderBtn.classList.toggle("active", tab === "finder");
    tabCalcBtn.classList.toggle("active", tab === "calc");
    tabRulesBtn.classList.toggle("active", tab === "rules");
    tabFinderBtn.setAttribute("aria-selected", String(tab === "finder"));
    tabCalcBtn.setAttribute("aria-selected", String(tab === "calc"));
    tabRulesBtn.setAttribute("aria-selected", String(tab === "rules"));
    if (updateUrl) {
      const hash = tab === "finder" ? "#recommendations" : tab === "calc" ? "#calculator" : "#rules";
      window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    }
    renderCurrentTab();
  }

  tabFinderBtn.addEventListener("click", () => {
    selectTab("finder");
  });

  tabCalcBtn.addEventListener("click", () => {
    selectTab("calc");
  });

  tabRulesBtn.addEventListener("click", () => {
    selectTab("rules");
  });

  window.addEventListener("hashchange", () => {
    const h = window.location.hash;
    selectTab(h === "#calculator" ? "calc" : h === "#rules" ? "rules" : "finder", { updateUrl: false });
  });

  selectTab(currentTab, { updateUrl: false });
}
