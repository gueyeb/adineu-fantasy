import { renderLiveStandings, renderLiveTrackerCards, renderNflLiveGames } from "./live-tracker-view.js?v=21eea25602";
import { tierChip, tierSeparator } from "./tier-view.js?v=d3a45b4046";
import { sleeperManager } from "./rivalry-week.js?v=adb53f3728";
import { describeIdentity, teamLabel } from "./manager-identity.js?v=7f451cdf4d";
import { buildWeeklyAwards, resolveCompletedAwardsWeek } from "./weekly-awards.js?v=fbe776fba5";
import { renderWeeklyAwards } from "./weekly-awards-view.js?v=ead74e2c71";
import { resolveOperationalWeek } from "./nfl-week.js?v=8f9fa3f5b2";
import { estimateBaselineProjectedPpg } from "./trade-value.js?v=2c9caa87cf";
import { estimatePregameWinProbability, pregameEstimatePresentation } from "./win-probability.js?v=71b4f153fa";

import { SLEEPER_API, SLEEPER_LEAGUE_ID as DEFAULT_LEAGUE_ID, sleeperGet } from "./sleeper-client.js?v=3f75d48ec5";
import { addToWatchlist, removeFromWatchlist, REASON_MAX } from "./war-room.js?v=e9eae48675";
import { loadWatchlist, saveWatchlist } from "./war-room-store.js?v=679685c790";

const LEADER_POSITION_LABELS = { QB: "Quarterbacks", RB: "Running backs", WR: "Receveurs", TE: "Tight ends", K: "Kickers", DEF: "Défenses" };
const USAGE_SIGNAL_LABELS = { BUY_LOW: "Buy low", SELL_HIGH: "Sell high" };

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

export { estimatePregameWinProbability };

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

const UNAVAILABLE = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA"]);

/** Starters Sleeper marks unavailable, with the healthy weekly estimate they take out of the
 * lineup (expert-rank estimate: a projection for an Out player is 0, so it can't measure the loss). */
export function summarizeUnavailableStarters(starters, playerStatuses = {}, playerCatalog = new Map()) {
  const players = (starters || []).filter(id => id && id !== "0" && UNAVAILABLE.has(playerStatuses[id])).map(id => {
    const entry = playerCatalog.get(id);
    return {
      sleeperId: id,
      name: entry?.name || `Player #${id}`,
      status: playerStatuses[id],
      expectedPpg: entry ? estimateBaselineProjectedPpg({ ...entry, projectedPpg: undefined, projection: undefined }) : null
    };
  });
  return { players, lostPoints: Number(players.reduce((sum, player) => sum + (player.expectedPpg || 0), 0).toFixed(1)) };
}

export function buildSeasonMatchups({
  rows,
  rosters,
  users,
  projections = {},
  historicalRecords = new Map(),
  expectedStarterCount = 9,
  playerStatuses = null,
  playerCatalog = new Map()
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
        const canonicalManager = sleeperManager(user);
        const manager = canonicalManager || user?.display_name || `Roster ${row.roster_id}`;
        // No public Sleeper team name: say so instead of repeating the account as a team.
        const teamName = user ? teamLabel(describeIdentity({ account: user.display_name, teamName: user.metadata?.team_name })) : manager;
        return {
          rosterId: Number(row.roster_id),
          manager,
          canonicalManager,
          teamName,
          sleeperName: user?.display_name || manager,
          points: Number(row.points) || 0,
          starters: (row.starters || []).filter(playerId => playerId && playerId !== "0").length,
          projection: starterProjection(row.starters, projections),
          unavailable: playerStatuses ? summarizeUnavailableStarters(row.starters, playerStatuses, playerCatalog) : null
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
    : `<small>Avant-match : ${team.projection.total.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pts${Number.isFinite(chance) ? ` · ${chance}%` : ""}</small>`;
  return `<div class="matchup-team matchup-team-${side}">
    <span class="matchup-manager">${team.canonicalManager ? `Manager · ${escapeHtml(team.canonicalManager)}` : `Compte Sleeper · @${escapeHtml(team.sleeperName)}`}</span>
    ${team.canonicalManager && team.canonicalManager !== team.sleeperName ? `<small>Compte Sleeper · @${escapeHtml(team.sleeperName)}</small>` : ""}
    <strong>${escapeHtml(team.teamName)}</strong>
    <b>${formatPoints(team.points)}</b>
    ${projection}
    ${team.unavailable?.players.length ? `<small class="lineup-alert" title="${escapeHtml(team.unavailable.players.map(player => `${player.name} (${player.status})`).join(", "))}">⚠ ${team.unavailable.players.length} titulaire${team.unavailable.players.length > 1 ? "s" : ""} indisponible${team.unavailable.players.length > 1 ? "s" : ""} : ${escapeHtml(team.unavailable.players.map(player => `${player.name} ${player.status}`).join(", "))}${team.unavailable.lostPoints > 0 ? ` · ≈${team.unavailable.lostPoints.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pts perdus` : ""}</small>` : ""}
  </div>`;
}

/**
 * Whether a calendar matchup has begun: week status first, then the Live report's per-roster
 * `started` for the current week. Unknown stays null — a zero score does not prove a game is ahead.
 */
export function calendarMatchupStarted(matchup, status, startedByRoster = null) {
  if (["Terminé", "En cours"].includes(status)) return true;
  if (status === "Programmé") return false;
  const flags = startedByRoster ? matchup.teams.map(team => startedByRoster.get(team.rosterId)) : [];
  if (flags.some(flag => flag === true)) return true;
  return flags.length === 2 && flags.every(flag => flag === false) ? false : null;
}

export function renderMatchupCards(matchups, status, { readAt = null, startedByRoster = null } = {}) {
  if (!matchups.length) return `<div class="matchup-empty"><strong>Calendrier incomplet</strong><p>Sleeper n’a pas encore publié les six affiches de cette semaine.</p></div>`;
  return matchups.map((matchup, index) => {
    const [teamA, teamB] = matchup.teams;
    const estimate = pregameEstimatePresentation({ chances: matchup.chances, started: calendarMatchupStarted(matchup, status, startedByRoster), readAt });
    const showPregame = estimate.show;
    const chanceA = showPregame ? estimate.teamA : null;
    const chanceB = showPregame ? estimate.teamB : null;
    const lineupIncomplete = teamA.starters < 9 || teamB.starters < 9;
    const pendingCopy = estimate.note ?? (lineupIncomplete
      ? "Probabilité suspendue : au moins une lineup est incomplète."
      : "Probabilité publiée dès que les projections Sleeper couvrent les deux lineups.");
    return `<article class="live-matchup-card">
      <header><span>Match ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(status)}</strong></header>
      <div class="live-matchup-score">
        ${renderTeam(teamA, chanceA, "a")}
        <i>VS</i>
        ${renderTeam(teamB, chanceB, "b")}
      </div>
      ${showPregame ? `<div class="win-meter" aria-label="Estimation avant match figée : ${chanceA} % pour ${escapeHtml(teamA.manager)}, ${chanceB} % pour ${escapeHtml(teamB.manager)}"><span style="width:${chanceA}%"></span></div><p class="note win-meter-basis"><strong>${escapeHtml(estimate.label)}</strong> · ${escapeHtml(estimate.basis)}</p>` : `<div class="projection-pending${lineupIncomplete ? " lineup-alert" : ""}">${pendingCopy}</div>`}
      <footer><span>${escapeHtml(historyLabel(matchup))}</span><small class="${lineupIncomplete ? "lineup-alert" : ""}">${teamA.starters}/9 · ${teamB.starters}/9 titulaires</small></footer>
    </article>`;
  }).join("");
}

async function fetchJson(url, { optional = false, timeoutMs = 10_000 } = {}) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
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

/** Roster du War Room dans ce navigateur : posé par /coach/, absent pour les autres visiteurs. */
function coachRosterHint() {
  try { return localStorage.getItem("adineu:coach-roster"); } catch { return null; }
}

function followButton(row, followed) {
  return `<button class="war-follow${followed ? " war-followed" : ""}" type="button" data-player="${escapeHtml(row.playerId)}" data-name="${escapeHtml(row.name)}" data-position="${escapeHtml(row.position)}"${followed ? ` data-followed="1" title="Retirer de la watchlist">Suivi ✕` : `>+ Suivre`}</button>`;
}

function signedPoints(value) {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatPoints(Math.abs(value))}`;
}

function renderLeaderRow(row, { rosterId, followedIds }) {
  const holder = row.freeAgent
    ? `<span class="leader-free">Agent libre</span>${rosterId ? ` ${followButton(row, followedIds.has(row.playerId))}` : ""}`
    : `${escapeHtml(row.owner)}${row.benched ? ` <span class="leader-bench">Banc</span>` : ""}`;
  const signal = USAGE_SIGNAL_LABELS[row.usageSignal];
  return `<tr>
    <td>${row.rank}</td>
    <td><strong>${escapeHtml(row.name)}</strong> <small>${escapeHtml([row.nflTeam, row.injuryStatus].filter(Boolean).join(" · "))}</small></td>
    <td class="leader-holder">${holder}</td>
    <td class="num"><strong>${formatPoints(row.points)}</strong></td>
    <td class="num">${row.projected === null ? "—" : formatPoints(row.projected)}</td>
    <td class="num${row.delta > 0 ? " positive" : row.delta < 0 ? " negative" : ""}">${signedPoints(row.delta)}</td>
    <td class="num">${row.usageScore ?? "—"}${signal ? ` <span class="leader-signal leader-${row.usageSignal.toLowerCase()}">${signal}</span>` : ""}</td>
  </tr>`;
}

function renderSeasonLeaders(report, context) {
  if (!report.weeks?.length) {
    return `<div class="matchup-empty"><strong>Saison pas encore commencée</strong><p>Le cumul apparaît après la première semaine terminée.</p></div>`;
  }
  const sections = Object.entries(report.positions).map(([position, group]) => `<article class="leader-card">
      <h3>${LEADER_POSITION_LABELS[position] || position}</h3>
      <div class="table-wrap leader-table"><table>
        <thead><tr><th>#</th><th>Joueur</th><th>Détenu par</th><th class="num">Pts</th><th class="num" title="Matchs joués">M.</th><th class="num">Moy.</th><th class="num" title="Semaines dans le top 10 du poste">Top 10</th></tr></thead>
        <tbody>${group.leaders.map(row => `<tr>
          <td>${row.rank}</td>
          <td><strong>${escapeHtml(row.name)}</strong> <small>${escapeHtml([row.nflTeam, row.injuryStatus].filter(Boolean).join(" · "))}</small></td>
          <td class="leader-holder">${row.freeAgent ? `<span class="leader-free">Agent libre</span>${context.rosterId ? ` ${followButton(row, context.followedIds.has(row.playerId))}` : ""}` : escapeHtml(row.owner)}</td>
          <td class="num"><strong>${formatPoints(row.points)}</strong></td>
          <td class="num">${row.games}</td>
          <td class="num">${formatPoints(row.average)}</td>
          <td class="num">${row.topTenWeeks}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </article>`).join("");
  const pickups = report.pickups.map(row => `<tr>
      <td>${row.rank}</td>
      <td><strong>${escapeHtml(row.name)}</strong> <small>${escapeHtml([row.position, row.nflTeam].filter(Boolean).join(" · "))}</small></td>
      <td>${escapeHtml(row.owner)}</td>
      <td class="num">S${row.addedWeek}</td>
      <td class="num">${row.faab === null ? "libre" : `${row.faab} $`}</td>
      <td class="num"><strong>${formatPoints(row.points)}</strong></td>
      <td class="num">${row.games}</td>
      <td class="num">${formatPoints(row.average)}</td>
    </tr>`).join("");
  return `<div class="leader-grid">${sections}</div>
    <article class="leader-card leader-pickups">
      <h3>Meilleurs ajouts de la saison</h3>
      <div class="table-wrap leader-table"><table>
        <thead><tr><th>#</th><th>Joueur</th><th>Ajouté par</th><th class="num">Depuis</th><th class="num">FAAB</th><th class="num">Pts depuis</th><th class="num">M.</th><th class="num">Moy.</th></tr></thead>
        <tbody>${pickups || `<tr><td colspan="8">Aucun ajout n’a encore joué.</td></tr>`}</tbody>
      </table></div>
      <p class="leader-free-line">Waivers et agents libres encore détenus par l’équipe qui les a ajoutés ; points comptés à partir de la semaine de l’ajout.</p>
    </article>`;
}

function renderLeaders(report, context) {
  if (!report.summary?.played) {
    return `<div class="matchup-empty"><strong>Semaine pas encore jouée</strong><p>Le classement apparaît dès le premier match terminé.</p></div>`;
  }
  const sections = Object.entries(report.positions).map(([position, group]) => {
    const free = group.freeAgents.map(row => `${position}${row.rank} ${escapeHtml(row.name)} · ${formatPoints(row.points)} pts`).join(" — ");
    return `<article class="leader-card">
      <h3>${LEADER_POSITION_LABELS[position] || position}</h3>
      <div class="table-wrap leader-table"><table>
        <thead><tr><th>#</th><th>Joueur</th><th>Détenu par</th><th class="num">Pts</th><th class="num">Proj.</th><th class="num">Écart</th><th class="num">Usage</th></tr></thead>
        <tbody>${group.leaders.map(row => renderLeaderRow(row, context)).join("")}</tbody>
      </table></div>
      <p class="leader-free-line"><b>Meilleurs agents libres :</b> ${free || "aucun n’a marqué."}</p>
    </article>`;
  }).join("");
  return `<div class="recap-grid">
      <article class="recap-stat"><span>Agents libres dans un top 10</span><strong>${report.summary.freeAgentsInTop}</strong><small>Tous postes confondus, disponibles aujourd’hui.</small></article>
      <article class="recap-stat"><span>Top 10 laissés au banc</span><strong>${report.summary.benchedInTop}</strong><small>Par le manager qui les détient encore.</small></article>
    </div>
    <div class="leader-grid">${sections}</div>`;
}

function weekStatus(week, currentWeek, hasScores) {
  if (week < currentWeek) return "Terminé";
  if (week > currentWeek) return "Programmé";
  return hasScores ? "En cours" : "À venir";
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
    <button type="button" class="matchups-view" data-view="leaders" role="tab">Leaders</button>
    <button type="button" class="matchups-view" data-view="rankings" role="tab">Classements</button>
    <button type="button" class="matchups-view" data-view="archives" role="tab">Archives 2019—2025</button>
  </div></div>
  <div id="matchups-panel-live" class="matchups-panel" role="tabpanel">
    <section class="section"><div class="shell">
      <div class="section-head matchup-live-head"><div><p class="eyebrow" id="live-eyebrow">Sleeper · semaine courante</p><h2>La ligue, en direct.</h2></div>
        <div class="matchup-refresh"><small id="live-updated">Synchronisation…</small><button type="button" id="refresh-matchups">Actualiser</button></div>
      </div>
      <p id="live-update-status" class="note" role="status"></p>
      <section class="live-standing-panel" id="live-standing-panel" aria-live="polite"></section>
      <h3>Les six affiches.</h3>
      <div class="live-matchup-grid" id="live-matchup-grid" aria-live="polite"><div class="state">Chargement des scores Sleeper…</div></div>
      <div id="live-nfl-games"></div>
      <p class="note"><strong>Lecture :</strong> scores et lineups Sleeper ; horloges NFL ESPN. Classement provisoire et estimation Adineu séparés du classement officiel. Actualisation toutes les 30 secondes tant que cette vue est visible.</p>
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
  <div id="matchups-panel-leaders" class="matchups-panel" role="tabpanel" hidden>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Top 10 par poste</p><h2>Qui a marqué, et qui l’a.</h2></div>
        <div class="schedule-toolbar"><label for="leaders-week">Semaine <select id="leaders-week"></select></label><span id="leaders-status">Chargement…</span></div>
      </div>
      <div id="leaders-content" aria-live="polite"><div class="state">Chargement des leaders…</div></div>
      <p class="note"><strong>Lecture :</strong> points au barème de la ligue. La projection est celle de Sleeper avant le match, rescorée au même barème. Le détenteur est celui d’aujourd’hui ; l’Usage Score couvre les trois dernières semaines terminées. Un gros écart avec un usage faible tient souvent à un touchdown.</p>
    </div></section>
  </div>
  <div id="matchups-panel-rankings" class="matchups-panel" role="tabpanel" hidden>
    <section class="section"><div class="shell">
      <h2>Classements de la semaine</h2>
      <div class="schedule-toolbar"><label>Semaine <select id="rankings-week"></select></label>
        <label>Joueurs <select id="rankings-filter"><option value="all">Tous</option><option value="free">Free agents</option>${coachRosterHint() ? '<option value="mine">Mon équipe</option>' : ''}</select></label>
      </div>
      <div id="rankings-positions" class="schedule-toolbar" role="group" aria-label="Poste">${["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].map(pos => `<button type="button" data-position="${pos}" aria-pressed="${pos === 'QB'}">${pos}</button>`).join("")}</div>
      <div id="rankings-content" aria-live="polite"></div>
      <p class="note">Projections Sleeper rescorées au barème de la ligue ; tiers = groupes séparés par les plus gros écarts. — = sans projection, non classé. Détenteurs actuels des 12 équipes.</p>
    </div></section>
  </div>
  <div id="matchups-panel-archives" class="matchups-panel" role="tabpanel" hidden><div class="shell state">Les archives seront chargées à l’ouverture.</div></div>`;

  const urls = {
    history: "/data/yahoo-matchups.json?v=2"
  };
  const [league, nflState, rosters, users, archive] = await Promise.all([
    sleeperGet(`/league/${leagueId}`),
    sleeperGet("/state/nfl"),
    sleeperGet(`/league/${leagueId}/rosters`),
    sleeperGet(`/league/${leagueId}/users`),
    fetchJson(urls.history, { optional: true })
  ]);
  const historicalRecords = buildHistoricalRecords(archive);
  let currentWeek = resolveOperationalWeek(nflState);
  const season = nflState.season || league.season || "2026";
  const regularWeekCount = Math.max(1, Number(league.settings?.playoff_week_start || 15) - 1);
  document.getElementById("hub-week").textContent = String(currentWeek).padStart(2, "0");
  document.getElementById("hub-season-state").textContent = league.status === "in_season" ? "Saison en cours" : "Calendrier publié";

  const scheduleSelect = document.getElementById("schedule-week");
  scheduleSelect.innerHTML = Array.from({ length: regularWeekCount }, (_, index) => index + 1)
    .map(week => `<option value="${week}"${week === currentWeek ? " selected" : ""}>Semaine ${week}${week === currentWeek ? " · actuelle" : ""}</option>`).join("");

  const recapSelect = document.getElementById("recap-week");
  let completedThroughWeek = resolveCompletedAwardsWeek({ league, state: nflState });
  const requestedWeek = Number(new URLSearchParams(window.location.search).get("week"));
  const defaultRecapWeek = Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= regularWeekCount
    ? requestedWeek : completedThroughWeek || 1;
  recapSelect.innerHTML = Array.from({ length: regularWeekCount }, (_, index) => index + 1)
    .map(week => `<option value="${week}"${week === defaultRecapWeek ? " selected" : ""}>Semaine ${week}</option>`).join("");

  let liveReport = null;
  let standingMode = "live";
  let liveLoading = false;
  function showStandings() {
    const panel = document.getElementById("live-standing-panel");
    const methodOpen = panel.querySelector("details")?.open;
    const focusedMode = panel.contains(document.activeElement) ? document.activeElement.dataset.standingMode : null;
    panel.innerHTML = renderLiveStandings(liveReport, standingMode);
    if (methodOpen && panel.querySelector("details")) panel.querySelector("details").open = true;
    if (focusedMode) panel.querySelector(`[data-standing-mode="${focusedMode}"]`)?.focus();
    panel.querySelectorAll("[data-standing-mode]").forEach(button => button.addEventListener("click", () => {
      standingMode = button.dataset.standingMode;
      showStandings();
    }));
  }
  async function refreshLive() {
    if (liveLoading) return;
    liveLoading = true;
    const button = document.getElementById("refresh-matchups");
    button.disabled = true;
    try {
      const report = await fetchJson("/api/live-standings", { timeoutMs: 25_000 });
      if (!container.isConnected) return;
      if (report.season && report.season !== String(season)) throw new Error("Season changed; reload required");
      if (Number.isInteger(report.week) && report.week !== currentWeek) {
        currentWeek = report.week;
        completedThroughWeek = Math.min(regularWeekCount, Math.max(0, currentWeek - 1));
        for (const option of scheduleSelect.options) option.textContent = `Semaine ${option.value}${Number(option.value) === currentWeek ? " · actuelle" : ""}`;
      }
      liveReport = report;
      document.getElementById("hub-week").textContent = String(report.week || currentWeek).padStart(2, "0");
      document.getElementById("live-eyebrow").textContent = `Sleeper · semaine ${report.week || currentWeek} · ${report.completed ? "scores publiés" : "suivi en cours"}`;
      const cards = document.getElementById("live-matchup-grid");
      const openDuels = new Set([...cards.querySelectorAll("details[open]")].map(detail => detail.dataset.matchupId));
      const focusedDuel = cards.contains(document.activeElement) ? document.activeElement.closest("details")?.dataset.matchupId : null;
      const historyCards = buildSeasonMatchups({ rows: (report.matchups || []).flatMap(pair => pair.teams.map(team => ({
        matchup_id: pair.matchupId, roster_id: team.rosterId, points: team.points, starters: team.starters.map(player => player.playerId)
      }))), rosters, users, historicalRecords });
      const labels = new Map(historyCards.map(pair => [String(pair.matchupId), historyLabel(pair)]));
      cards.innerHTML = renderLiveTrackerCards({ ...report, matchups: (report.matchups || []).map(pair => ({ ...pair, historyLabel: labels.get(String(pair.matchupId)) })) });
      for (const detail of cards.querySelectorAll("details")) {
        if (openDuels.has(detail.dataset.matchupId)) detail.open = true;
        if (detail.dataset.matchupId === focusedDuel) detail.querySelector("summary")?.focus();
      }
      document.getElementById("live-nfl-games").innerHTML = renderNflLiveGames(report.nfl);
      showStandings();
      document.getElementById("live-updated").textContent = `Données au ${new Date(report.asOf).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })} · Paris`;
      document.getElementById("live-update-status").textContent = "";
    } catch {
      if (!container.isConnected) return;
      document.getElementById("live-update-status").textContent = liveReport ? "Actualisation impossible. Les dernières données affichées sont conservées avec leur heure de lecture." : "Scores live indisponibles. Réessaie avec Actualiser.";
      if (!liveReport) document.getElementById("live-matchup-grid").innerHTML = '<p class="state">Aucune donnée live chargée.</p>';
    } finally {
      liveLoading = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  async function loadWeek(week, targetId, { live = false } = {}) {
    if (live) return refreshLive();
    const target = document.getElementById(targetId);
    target.innerHTML = `<div class="state">Lecture de la semaine ${week}…</div>`;
    try {
      // Semaine en cours ou à venir : statuts blessure (serveur Adineu) pour signaler les titulaires indisponibles.
      const upcoming = week >= currentWeek;
      const [rows, projections, statusBody, catalog] = await Promise.all([
        fetchJson(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`),
        fetchJson(`${SLEEPER_API}/projections/nfl/regular/${season}/${week}`, { optional: true }),
        upcoming ? fetchJson("/api/player-status", { optional: true }) : null,
        upcoming ? fetchJson("/data/players-catalog.json", { optional: true }) : null
      ]);
      const playerCatalog = new Map((catalog?.players || []).map(player => [player.sleeperId, player]));
      const matchups = buildSeasonMatchups({ rows, rosters, users, projections: projections || {}, historicalRecords, playerStatuses: statusBody?.statuses || null, playerCatalog });
      const hasScores = matchups.some(matchup => matchup.teams.some(team => team.points > 0));
      const status = weekStatus(week, currentWeek, hasScores);
      // Current week: the Live report knows which starters' games began; a zero score proves nothing.
      const startedByRoster = week === currentWeek && liveReport?.week === week
        ? new Map((liveReport.matchups || []).flatMap(pair => pair.teams).map(team => [Number(team.rosterId), Boolean(team.started)]))
        : null;
      target.innerHTML = renderMatchupCards(matchups, status, { readAt: new Date().toISOString(), startedByRoster });
      document.getElementById("schedule-status").textContent = `${status} · ${matchups.length} affiches`;
    } catch (error) {
      target.innerHTML = `<div class="matchup-empty"><strong>Impossible de joindre Sleeper</strong><p>${escapeHtml(error.message)}. Réessayez dans quelques instants.</p></div>`;
    }
  }

  async function loadRecap(week) {
    const status = document.getElementById("recap-status");
    const content = document.getElementById("recap-content");
    content.innerHTML = `<div class="state">Lecture de la semaine ${week}…</div>`;
    try {
      const rows = week <= completedThroughWeek ? await sleeperGet(`/league/${leagueId}/matchups/${week}`, { fresh: true }) : [];
      const ids = [...new Set(rows.flatMap(row => row.players || []).map(String))];
      const playerCatalog = ids.length ? await fetch(`/api/players?ids=${encodeURIComponent(ids.join(","))}`).then(r => r.ok ? r.json() : null).then(body => body?.players ?? null).catch(() => null) : null;
      const recap = buildWeeklyAwards({ rows, rosters, users, week, completedThroughWeek, playerCatalog, rosterPositions: league.roster_positions,
        expectedTeamCount: Number(league.total_rosters) });
      content.innerHTML = renderWeeklyAwards(recap);
      status.textContent = recap.ready ? `Semaine ${week} terminée · ${recap.matchups.length} matchs` : `Semaine ${week} · récap en attente`;
      const query = new URLSearchParams(window.location.search);
      query.set("week", String(week));
      window.history.replaceState(null, "", `${window.location.pathname}?${query}#recap`);
    } catch (error) {
      content.innerHTML = `<div class="matchup-empty"><strong>Impossible de joindre Sleeper</strong><p>${escapeHtml(error.message)}. Réessayez dans quelques instants.</p></div>`;
    }
  }

  const rankingsSelect = document.getElementById("rankings-week");
  const rankingsFilter = document.getElementById("rankings-filter");
  const rankingsContent = document.getElementById("rankings-content");
  rankingsSelect.innerHTML = Array.from({ length: 18 }, (_, i) => `<option value="${i + 1}"${i + 1 === currentWeek ? " selected" : ""}>Semaine ${i + 1}</option>`).join("");
  let rankingsReport = null;
  let rankingsPosition = "QB";
  let rankingsRequest = 0;
  function renderRankings() {
    if (!rankingsReport) return;
    const rows = (rankingsPosition === "FLEX" ? rankingsReport.flex : rankingsReport.byPosition[rankingsPosition]).filter(row =>
      rankingsFilter.value === "mine" ? String(row.holderRosterId) === coachRosterHint() : !row.beyondLimit && (rankingsFilter.value !== "free" || row.holder === null));
    const number = (value, suffix = "") => Number.isFinite(value) ? `${value.toFixed(suffix ? 0 : 1)}${suffix}` : "—";
    rankingsContent.innerHTML = `<div class="table-wrap" tabindex="0" role="region" aria-label="Classements ${rankingsPosition}"><table><thead><tr>${["Rang", "Joueur", "Équipe fantasy", "Proj.", "Plancher", "Plafond", "Boom", "Bust", "Matchup", "Statut"].map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `${tierSeparator({ ...row, position: rankingsPosition }, index ? { ...rows[index - 1], position: rankingsPosition } : null, 10)}<tr>
      <td>${row.rank ?? "—"}</td><td>${tierChip(row.tier)}${escapeHtml(row.name)}<br><small>${escapeHtml(row.position)} · ${escapeHtml(row.nflTeam)}</small></td>
      <td>${escapeHtml(row.holder ?? "Free agent")}</td><td>${number(row.projection)}</td><td>${number(row.floor)}</td><td>${number(row.ceiling)}</td><td>${number(row.boomPct, "%")}</td><td>${number(row.bustPct, "%")}</td>
      <td>${row.matchup.opponent ? `${escapeHtml(row.matchup.opponent)} · ${escapeHtml(row.matchup.label)}${row.matchup.rank ? ` #${row.matchup.rank}` : ""}` : row.injuryStatus === "BYE" ? "BYE" : "—"}</td><td>${escapeHtml(row.injuryStatus || "—")}</td></tr>`).join("") || '<tr><td colspan="10">Aucun joueur dans ce filtre.</td></tr>'}</tbody></table></div>`;
  }
  async function loadRankings() {
    const request = ++rankingsRequest;
    rankingsContent.innerHTML = '<div class="state">Chargement des classements…</div>';
    rankingsReport = null;
    try {
      const report = await fetchJson(`/api/rankings?week=${rankingsSelect.value}`, { timeoutMs: 40_000 });
      if (request !== rankingsRequest) return;
      rankingsReport = report;
      renderRankings();
    } catch (error) {
      if (request === rankingsRequest) rankingsContent.innerHTML = `<div class="state">Classements indisponibles : ${escapeHtml(error.message)} <button type="button" id="rankings-retry">Réessayer</button></div>`;
    }
  }
  rankingsContent.addEventListener("click", event => { if (event.target.closest("#rankings-retry")) loadRankings(); });
  rankingsSelect.addEventListener("change", loadRankings);
  rankingsFilter.addEventListener("change", renderRankings);
  document.getElementById("rankings-positions").addEventListener("click", event => {
    const button = event.target.closest("[data-position]");
    if (!button) return;
    rankingsPosition = button.dataset.position;
    document.querySelectorAll("#rankings-positions button").forEach(node => node.setAttribute("aria-pressed", String(node === button)));
    renderRankings();
  });

  const leadersSelect = document.getElementById("leaders-week");
  const leadersContent = document.getElementById("leaders-content");
  let leadersWeek = null;
  async function loadLeaders(week = null) {
    const status = document.getElementById("leaders-status");
    leadersContent.innerHTML = `<div class="state">Lecture des leaders…</div>`;
    try {
      const report = await fetchJson(`/api/leaders${week ? `?week=${week}` : ""}`, { timeoutMs: 40_000 });
      const seasonView = report.scope === "season";
      leadersWeek = seasonView ? report.currentWeek : report.week;
      const lastWeek = Math.min(18, Math.max(report.currentWeek, seasonView ? 1 : report.week));
      leadersSelect.innerHTML = `<option value="season"${seasonView ? " selected" : ""}>Saison ${escapeHtml(report.season)}</option>` + Array.from({ length: lastWeek }, (_, index) => index + 1)
        .map(value => `<option value="${value}"${!seasonView && value === report.week ? " selected" : ""}>Semaine ${value}</option>`).join("");
      const rosterId = coachRosterHint();
      const context = { rosterId, followedIds: new Set(rosterId ? loadWatchlist(rosterId).map(entry => entry.playerId) : []) };
      leadersContent.innerHTML = seasonView ? renderSeasonLeaders(report, context) : renderLeaders(report, context);
      status.textContent = seasonView ? `Saison · ${report.weeks.length} semaine${report.weeks.length > 1 ? "s" : ""} terminée${report.weeks.length > 1 ? "s" : ""}` : `Semaine ${report.week} · ${report.live ? "en cours" : "terminée"}`;
    } catch (error) {
      leadersContent.innerHTML = `<div class="matchup-empty"><strong>Leaders indisponibles</strong><p>${escapeHtml(error.message)}. Réessayez dans quelques instants.</p></div>`;
      status.textContent = "Erreur";
    }
  }

  // Suivre un agent libre avec un motif daté : même watchlist que le War Room de /coach/.
  leadersContent.addEventListener("click", event => {
    const button = event.target.closest("button.war-follow[data-player]");
    const rosterId = coachRosterHint();
    if (!button || !rosterId) return;
    const { player: playerId, name, position } = button.dataset;
    const swap = (node, followed) => { node.outerHTML = followButton({ playerId, name, position }, followed); };
    if (button.dataset.followed) {
      saveWatchlist(rosterId, removeFromWatchlist(loadWatchlist(rosterId), playerId));
      swap(button, false);
      return;
    }
    const form = document.createElement("form");
    form.className = "war-follow-form";
    form.innerHTML = `<input type="text" required maxlength="${REASON_MAX}" placeholder="Motif (ex. WR9 en S5)" aria-label="Motif du suivi"><button class="war-follow" type="submit">Suivre</button>`;
    form.addEventListener("submit", submitEvent => {
      submitEvent.preventDefault();
      const reason = form.querySelector("input").value.trim();
      if (!reason) return;
      const saved = saveWatchlist(rosterId, addToWatchlist(loadWatchlist(rosterId), { playerId, name, position },
        { reason, now: new Date().toISOString(), week: leadersWeek }));
      swap(form, saved);
    });
    button.replaceWith(form);
    form.querySelector("input").focus();
  });

  let archiveLoaded = false;
  let scheduleLoaded = false;
  let recapLoaded = false;
  let leadersLoaded = false;
  let rankingsLoaded = false;
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
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${view}`);
    }
    if (view === "schedule" && !scheduleLoaded) {
      scheduleLoaded = true;
      await loadWeek(Number(scheduleSelect.value), "schedule-matchup-grid");
    }
    if (view === "recap" && !recapLoaded) {
      recapLoaded = true;
      await loadRecap(Number(recapSelect.value));
    }
    if (view === "rankings" && !rankingsLoaded) {
      rankingsLoaded = true;
      await loadRankings();
    }
    if (view === "leaders" && !leadersLoaded) {
      leadersLoaded = true;
      await loadLeaders();
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
  leadersSelect.addEventListener("change", () => {
    loadLeaders(leadersSelect.value === "season" ? "season" : Number(leadersSelect.value));
  });
  document.getElementById("refresh-matchups").addEventListener("click", () => {
    loadWeek(currentWeek, "live-matchup-grid", { live: true });
  });
  function viewFromHash() {
    const hash = window.location.hash;
    if (hash === "#schedule") return "schedule";
    if (hash === "#recap") return "recap";
    if (hash === "#rankings") return "rankings";
    if (hash === "#leaders") return "leaders";
    if (hash === "#archives") return "archives";
    return "live";
  }

  window.addEventListener("hashchange", () => {
    selectView(viewFromHash(), { updateUrl: false });
  });

  await loadWeek(currentWeek, "live-matchup-grid", { live: true });
  await selectView(viewFromHash(), { updateUrl: false });
  const liveTimer = window.setInterval(() => {
    if (!container.isConnected) { window.clearInterval(liveTimer); return; }
    if (!document.hidden && !document.getElementById("matchups-panel-live").hidden) refreshLive();
  }, 30_000);
}
