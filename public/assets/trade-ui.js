/**
 * Adineu Fantasy — Interface Utilisateur Trade Hub
 *
 * Gère le Calculateur de Trade interactif et le Moteur de Recommandations.
 */

import { calculatePlayerTradeValue, evaluateTrade } from "./trade-value.js";
import { diagnoseRoster, findTradeProposals } from "./trade-recommender.js";

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
        <p class="eyebrow">Adineu NFL · In-Season Market</p>
        <h1>Trade Hub</h1>
        <p class="lede">Calculateur de valeur déterministe et moteur de détection d'opportunités bilatérales pour la ligue.</p>

        <div class="tabs-nav" style="display:flex; gap:12px; margin-top:28px; border-bottom:1px solid var(--line); padding-bottom:12px;">
          <button id="tab-finder-btn" class="filter-btn active" type="button">💡 Opportunités de Trades</button>
          <button id="tab-calc-btn" class="filter-btn" type="button">🧮 Calculateur de Trade</button>
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
  let currentTab = "finder";
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

  // Switch tabs
  const tabFinderBtn = document.getElementById("tab-finder-btn");
  const tabCalcBtn = document.getElementById("tab-calc-btn");

  tabFinderBtn.addEventListener("click", () => {
    currentTab = "finder";
    tabFinderBtn.classList.add("active");
    tabCalcBtn.classList.remove("active");
    renderCurrentTab();
  });

  tabCalcBtn.addEventListener("click", () => {
    currentTab = "calc";
    tabCalcBtn.classList.add("active");
    tabFinderBtn.classList.remove("active");
    renderCurrentTab();
  });

  renderCurrentTab();
}
