import { sleeperManager } from "./rivalry-week.js?v=4";
import { buildWeeklyRecap } from "./weekly-recap.js?v=1";

const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_LEAGUE_ID = "1392715510830878721";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function pairKey(managerA, managerB) {
  return [managerA, managerB].sort((a, b) => a.localeCompare(b, "fr")).join("::");
}

function resultFor(points, opponentPoints) {
  if (points > opponentPoints) return "win";
  if (points < opponentPoints) return "loss";
  return "tie";
}

export function buildHistoricalRecords(archive) {
  const records = new Map();

  for (const season of archive?.seasons || []) {
    for (const week of season.weeks || []) {
      for (const matchup of week.matchups || []) {
        const managers = [matchup.team1Manager, matchup.team2Manager]
          .sort((a, b) => a.localeCompare(b, "fr"));
        const key = pairKey(...managers);
        const record = records.get(key) || {
          managerA: managers[0],
          managerB: managers[1],
          winsA: 0,
          winsB: 0,
          ties: 0,
          games: 0
        };
        const team1Result = resultFor(Number(matchup.team1Score), Number(matchup.team2Score));
        const team1IsA = matchup.team1Manager === record.managerA;
        if (team1Result === "tie") record.ties += 1;
        else if ((team1Result === "win") === team1IsA) record.winsA += 1;
        else record.winsB += 1;
        record.games += 1;
        records.set(key, record);
      }
    }
  }

  return records;
}

export function estimatePregameWinProbability(projectionA, projectionB) {
  if (!Number.isFinite(projectionA) || !Number.isFinite(projectionB)
    || projectionA <= 0 || projectionB <= 0) return null;
  const probabilityA = 100 / (1 + Math.exp((projectionB - projectionA) / 18));
  const boundedA = Math.min(95, Math.max(5, probabilityA));
  return {
    teamA: Number(boundedA.toFixed(1)),
    teamB: Number((100 - boundedA).toFixed(1))
  };
}

function starterProjection(starters, projections) {
  const playerIds = (starters || []).filter(playerId => playerId && playerId !== "0");
  const values = playerIds.map(playerId => Number(projections?.[playerId]?.pts_ppr))
    .filter(Number.isFinite);
  const minimumCoverage = Math.max(1, playerIds.length - 2);
  if (values.length < minimumCoverage) return { total: null, coverage: values.length, starters: playerIds.length };
  return {
    total: Number(values.reduce((sum, value) => sum + value, 0).toFixed(1)),
    coverage: values.length,
    starters: playerIds.length
  };
}

export function buildSeasonMatchups({
  rows,
  rosters,
  users,
  projections = {},
  historicalRecords = new Map(),
  expectedStarterCount = 9
}) {
  const userById = new Map((users || []).map(user => [user.user_id, user]));
  const rosterById = new Map((rosters || []).map(roster => [Number(roster.roster_id), roster]));
  const grouped = new Map();

  for (const row of rows || []) {
    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const sides = grouped.get(Number(row.matchup_id)) || [];
    sides.push(row);
    grouped.set(Number(row.matchup_id), sides);
  }

  return [...grouped.entries()].filter(([, sides]) => sides.length === 2)
    .sort(([matchupA], [matchupB]) => matchupA - matchupB)
    .map(([matchupId, sides]) => {
      const teams = sides.map(row => {
        const roster = rosterById.get(Number(row.roster_id));
        const user = userById.get(roster?.owner_id);
        const manager = sleeperManager(user) || user?.display_name || `Roster ${row.roster_id}`;
        const teamName = user?.metadata?.team_name || user?.display_name || manager;
        return {
          rosterId: Number(row.roster_id),
          manager,
          teamName,
          sleeperName: user?.display_name || manager,
          points: Number(row.points) || 0,
          starters: (row.starters || []).filter(playerId => playerId && playerId !== "0").length,
          projection: starterProjection(row.starters, projections)
        };
      });
      const history = historicalRecords.get(pairKey(teams[0].manager, teams[1].manager)) || null;
      const lineupsComplete = teams.every(team => team.starters === expectedStarterCount);
      const chances = lineupsComplete
        ? estimatePregameWinProbability(teams[0].projection.total, teams[1].projection.total)
        : null;
      return { matchupId, teams, history, chances };
    });
}

function formatPoints(value) {
  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function historyLabel(matchup) {
  if (!matchup.history) return "Premier duel de l’ère documentée";
  const [teamA, teamB] = matchup.teams;
  const aIsRecordA = teamA.manager === matchup.history.managerA;
  const winsA = aIsRecordA ? matchup.history.winsA : matchup.history.winsB;
  const winsB = aIsRecordA ? matchup.history.winsB : matchup.history.winsA;
  const ties = matchup.history.ties ? ` · ${matchup.history.ties} N` : "";
  return `Historique · ${teamA.manager} ${winsA}—${winsB} ${teamB.manager}${ties}`;
}

function renderTeam(team, chance, side) {
  const projection = team.projection.total === null
    ? `<small>Projection en attente</small>`
    : `<small>Proj. ${team.projection.total.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pts${Number.isFinite(chance) ? ` · ${chance}%` : ""}</small>`;
  return `<div class="matchup-team matchup-team-${side}">
    <span class="matchup-manager">${escapeHtml(team.manager)}</span>
    <strong>${escapeHtml(team.teamName)}</strong>
    <b>${formatPoints(team.points)}</b>
    ${projection}
  </div>`;
}

function renderMatchupCards(matchups, status) {
  if (!matchups.length) return `<div class="matchup-empty"><strong>Calendrier incomplet</strong><p>Sleeper n’a pas encore publié les six affiches de cette semaine.</p></div>`;
  return matchups.map((matchup, index) => {
    const [teamA, teamB] = matchup.teams;
    const chanceA = matchup.chances?.teamA ?? null;
    const chanceB = matchup.chances?.teamB ?? null;
    const lineupIncomplete = teamA.starters < 9 || teamB.starters < 9;
    const pendingCopy = lineupIncomplete
      ? "Probabilité suspendue : au moins une lineup est incomplète."
      : "Probabilité publiée dès que les projections Sleeper couvrent les deux lineups.";
    return `<article class="live-matchup-card">
      <header><span>Match ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(status)}</strong></header>
      <div class="live-matchup-score">
        ${renderTeam(teamA, chanceA, "a")}
        <i>VS</i>
        ${renderTeam(teamB, chanceB, "b")}
      </div>
      ${matchup.chances ? `<div class="win-meter" aria-label="Estimation pré-match : ${chanceA}% pour ${escapeHtml(teamA.manager)}, ${chanceB}% pour ${escapeHtml(teamB.manager)}"><span style="width:${chanceA}%"></span></div>` : `<div class="projection-pending${lineupIncomplete ? " lineup-alert" : ""}">${pendingCopy}</div>`}
      <footer><span>${escapeHtml(historyLabel(matchup))}</span><small class="${lineupIncomplete ? "lineup-alert" : ""}">${teamA.starters}/9 · ${teamB.starters}/9 titulaires</small></footer>
    </article>`;
  }).join("");
}

async function fetchJson(url, { optional = false } = {}) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      if (optional) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}

function weekStatus(week, currentWeek, hasScores) {
  if (week < currentWeek) return "Terminé";
  if (week > currentWeek) return "Programmé";
  return hasScores ? "En cours" : "À venir";
}

function formatRefreshTime() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export async function renderMatchupsHub(container, {
  leagueId = DEFAULT_LEAGUE_ID,
  renderArchive
} = {}) {
  container.innerHTML = `<section class="matchups-live-hero"><div class="shell matchups-live-hero-grid">
    <div>
      <p class="eyebrow">Adineu NFL · Saison 2026</p>
      <h1>Matchup <em>Center.</em></h1>
      <p class="lede">Le calendrier officiel Sleeper, les scores de la semaine et sept saisons d’historique réunis au même endroit.</p>
    </div>
    <aside class="week-scorebug"><span>Semaine live</span><strong id="hub-week">—</strong><small id="hub-season-state">Connexion à Sleeper</small></aside>
  </div></section>
  <div class="matchups-viewbar"><div class="shell" role="tablist" aria-label="Vues des matchups">
    <button type="button" class="matchups-view active" data-view="live" role="tab">Live</button>
    <button type="button" class="matchups-view" data-view="schedule" role="tab">Calendrier 2026</button>
    <button type="button" class="matchups-view" data-view="recap" role="tab">Récap Hebdo</button>
    <button type="button" class="matchups-view" data-view="archives" role="tab">Archives 2019—2025</button>
  </div></div>
  <div id="matchups-panel-live" class="matchups-panel" role="tabpanel">
    <section class="section"><div class="shell">
      <div class="section-head matchup-live-head"><div><p class="eyebrow" id="live-eyebrow">Sleeper · semaine courante</p><h2>Les six affiches.</h2></div>
        <div class="matchup-refresh"><small id="live-updated">Synchronisation…</small><button type="button" id="refresh-matchups">Actualiser</button></div>
      </div>
      <div class="live-matchup-grid" id="live-matchup-grid" aria-live="polite"><div class="state">Chargement des scores Sleeper…</div></div>
      <p class="note"><strong>Lecture :</strong> scores et lineups viennent directement de Sleeper. La probabilité, lorsqu’elle est disponible, est une estimation pré-match Adineu fondée sur les projections et non une cote officielle.</p>
    </div></section>
  </div>
  <div id="matchups-panel-schedule" class="matchups-panel" role="tabpanel" hidden>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Calendrier officiel</p><h2>Une saison, semaine par semaine.</h2></div><p>Sélectionnez une semaine pour consulter les affiches publiées par Sleeper et leur historique Yahoo.</p></div>
      <div class="schedule-toolbar"><label for="schedule-week">Semaine <select id="schedule-week"></select></label><span id="schedule-status">Chargement…</span></div>
      <div class="live-matchup-grid" id="schedule-matchup-grid" aria-live="polite"></div>
    </div></section>
  </div>
  <div id="matchups-panel-recap" class="matchups-panel" role="tabpanel" hidden>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Bilan hebdomadaire</p><h2>Ce qui s’est vraiment passé.</h2></div>
        <div class="schedule-toolbar"><label for="recap-week">Semaine <select id="recap-week"></select></label><span id="recap-status">Chargement…</span></div>
      </div>
      <div id="recap-content" aria-live="polite"><div class="state">Chargement du récap…</div></div>
    </div></section>
  </div>
  <div id="matchups-panel-archives" class="matchups-panel" role="tabpanel" hidden><div class="shell state">Les archives seront chargées à l’ouverture.</div></div>`;

  const urls = {
    league: `${SLEEPER_API}/league/${leagueId}`,
    state: `${SLEEPER_API}/state/nfl`,
    rosters: `${SLEEPER_API}/league/${leagueId}/rosters`,
    users: `${SLEEPER_API}/league/${leagueId}/users`,
    history: "/data/yahoo-matchups.json?v=2"
  };
  const [league, nflState, rosters, users, archive] = await Promise.all([
    fetchJson(urls.league),
    fetchJson(urls.state),
    fetchJson(urls.rosters),
    fetchJson(urls.users),
    fetchJson(urls.history, { optional: true })
  ]);
  const historicalRecords = buildHistoricalRecords(archive);
  const currentWeek = Number(nflState.display_week || nflState.week || 1);
  const season = nflState.season || league.season || "2026";
  const regularWeekCount = Math.max(1, Number(league.settings?.playoff_week_start || 15) - 1);
  document.getElementById("hub-week").textContent = String(currentWeek).padStart(2, "0");
  document.getElementById("hub-season-state").textContent = league.status === "in_season" ? "Saison en cours" : "Calendrier publié";

  const scheduleSelect = document.getElementById("schedule-week");
  scheduleSelect.innerHTML = Array.from({ length: regularWeekCount }, (_, index) => index + 1)
    .map(week => `<option value="${week}"${week === currentWeek ? " selected" : ""}>Semaine ${week}${week === currentWeek ? " · actuelle" : ""}</option>`).join("");

  const recapSelect = document.getElementById("recap-week");
  const defaultRecapWeek = currentWeek > 1 ? currentWeek - 1 : currentWeek;
  recapSelect.innerHTML = Array.from({ length: regularWeekCount }, (_, index) => index + 1)
    .map(week => `<option value="${week}"${week === defaultRecapWeek ? " selected" : ""}>Semaine ${week}</option>`).join("");

  async function loadWeek(week, targetId, { live = false } = {}) {
    const target = document.getElementById(targetId);
    target.innerHTML = `<div class="state">Lecture de la semaine ${week}…</div>`;
    try {
      const [rows, projections] = await Promise.all([
        fetchJson(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`),
        fetchJson(`${SLEEPER_API}/projections/nfl/regular/${season}/${week}`, { optional: true })
      ]);
      const matchups = buildSeasonMatchups({ rows, rosters, users, projections: projections || {}, historicalRecords });
      const hasScores = matchups.some(matchup => matchup.teams.some(team => team.points > 0));
      const status = weekStatus(week, currentWeek, hasScores);
      target.innerHTML = renderMatchupCards(matchups, status);
      if (live) {
        document.getElementById("live-eyebrow").textContent = `Sleeper · semaine ${week} · ${status}`;
        document.getElementById("live-updated").textContent = `Actualisé à ${formatRefreshTime()}`;
      } else {
        document.getElementById("schedule-status").textContent = `${status} · ${matchups.length} affiches`;
      }
    } catch (error) {
      target.innerHTML = `<div class="matchup-empty"><strong>Impossible de joindre Sleeper</strong><p>${escapeHtml(error.message)}. Réessayez dans quelques instants.</p></div>`;
    }
  }

  function renderRecapContent(recap) {
    if (!recap.highestScore) {
      return `<div class="matchup-empty"><strong>Semaine pas encore jouée</strong><p>Revenez une fois les scores publiés par Sleeper.</p></div>`;
    }

    const upsetCard = recap.biggestUpset
      ? { label: "Plus gros upset", value: `${recap.biggestUpset.winnerChance}% de chances pré-match`, detail: `${recap.biggestUpset.winner.manager} bat ${recap.biggestUpset.loser.manager}` }
      : { label: "Plus gros upset", value: "Aucun", detail: "Le favori l’a emporté partout (ou projections indisponibles)." };

    const cards = [
      { label: "Meilleur score", value: `${formatPoints(recap.highestScore.actualScore)} pts`, detail: `${recap.highestScore.manager} · ${recap.highestScore.teamName}` },
      recap.closestMatchup
        ? { label: "Match le plus serré", value: `${formatPoints(recap.closestMatchup.margin)} pts d’écart`, detail: `${recap.closestMatchup.teams[0].manager} vs ${recap.closestMatchup.teams[1].manager}` }
        : null,
      upsetCard
    ].filter(Boolean);

    const benchRows = recap.benchPointsLeaders
      .map(team => `<li><strong>${escapeHtml(team.manager)}</strong> <small>${escapeHtml(team.teamName)}</small><span>${formatPoints(team.benchPointsLeft)} pts laissés au banc</span></li>`)
      .join("");

    return `
      <div class="recap-grid">${cards.map(card => `<article class="recap-stat"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small></article>`).join("")}</div>
      <div class="recap-bench"><h3>Points laissés sur le banc</h3><ul>${benchRows || "<li>Aucune donnée pour cette semaine.</li>"}</ul></div>
    `;
  }

  async function loadRecap(week) {
    const status = document.getElementById("recap-status");
    const content = document.getElementById("recap-content");
    content.innerHTML = `<div class="state">Lecture de la semaine ${week}…</div>`;
    try {
      const [rows, projections, catalog] = await Promise.all([
        fetchJson(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`),
        fetchJson(`${SLEEPER_API}/projections/nfl/regular/${season}/${week}`, { optional: true }),
        fetchJson("/data/players-catalog.json", { optional: true })
      ]);
      const playerCatalog = new Map((catalog?.players || []).map(player => [player.sleeperId, player]));
      const recap = buildWeeklyRecap({ rows, rosters, users, playerCatalog, projections: projections || {}, week });
      content.innerHTML = renderRecapContent(recap);
      status.textContent = recap.highestScore ? `Semaine ${week} · ${recap.matchups.length} matchs` : `Semaine ${week}`;
    } catch (error) {
      content.innerHTML = `<div class="matchup-empty"><strong>Impossible de joindre Sleeper</strong><p>${escapeHtml(error.message)}. Réessayez dans quelques instants.</p></div>`;
    }
  }

  let archiveLoaded = false;
  let scheduleLoaded = false;
  let recapLoaded = false;
  async function selectView(view, { updateUrl = true } = {}) {
    document.querySelectorAll(".matchups-view").forEach(button => {
      const selected = button.dataset.view === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".matchups-panel").forEach(panel => {
      panel.hidden = panel.id !== `matchups-panel-${view}`;
    });
    if (updateUrl) {
      const hash = view === "live" ? "#live" : view === "schedule" ? "#schedule" : view === "recap" ? "#recap" : "#archives";
      window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    }
    if (view === "schedule" && !scheduleLoaded) {
      scheduleLoaded = true;
      await loadWeek(Number(scheduleSelect.value), "schedule-matchup-grid");
    }
    if (view === "recap" && !recapLoaded) {
      recapLoaded = true;
      await loadRecap(Number(recapSelect.value));
    }
    if (view === "archives" && !archiveLoaded) {
      archiveLoaded = true;
      await renderArchive?.(document.getElementById("matchups-panel-archives"));
    }
  }

  document.querySelectorAll(".matchups-view").forEach(button => {
    button.addEventListener("click", () => selectView(button.dataset.view));
  });
  scheduleSelect.addEventListener("change", () => {
    loadWeek(Number(scheduleSelect.value), "schedule-matchup-grid");
  });
  recapSelect.addEventListener("change", () => {
    loadRecap(Number(recapSelect.value));
  });
  document.getElementById("refresh-matchups").addEventListener("click", () => {
    loadWeek(currentWeek, "live-matchup-grid", { live: true });
  });
  function viewFromHash() {
    const hash = window.location.hash;
    if (hash === "#schedule") return "schedule";
    if (hash === "#recap") return "recap";
    if (hash === "#archives") return "archives";
    return "live";
  }

  window.addEventListener("hashchange", () => {
    selectView(viewFromHash(), { updateUrl: false });
  });

  await loadWeek(currentWeek, "live-matchup-grid", { live: true });
  await selectView(viewFromHash(), { updateUrl: false });
}
