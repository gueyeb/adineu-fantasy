/**
 * Adineu Fantasy — Team Profile (/teams/)
 *
 * Live dossier for one manager: identity, live record/rank, roster (titulaires/banc/IR),
 * lineup alerts, roster strength by position, all-play record, FAAB remaining, win/loss streak,
 * and cross-links into Trade Finder / Matchups. Self-contained module, same pattern as
 * trade-ui.js / matchups-live.js — fetches its own Sleeper/Supabase data rather than depending
 * on site.js's static Yahoo bundle.
 *
 * Roster strength reuses calculatePlayerTradeProfile's tradeValue (public/assets/trade-value.js) —
 * the same number already shown in the Trade Hub — via public/assets/roster-strength.js. It is a
 * baseline estimate from expert rank/ADP only: unlike the Trade Hub, this page does not fetch
 * weekly projections or per-week actual scores for all 12 rosters (that loop lives in trade-ui.js
 * and would roughly double this page's network cost for a secondary panel). Scoped this way on
 * purpose — upgrade later if the baseline proves too coarse.
 *
 * All-Play (public/assets/all-play.js) reuses the exact same matchup rows and completed-weeks gate
 * as Power Rankings (one Supabase call for both) and never shows before that gate is ready — same
 * "no fabricated pre-gate stat" rule as everywhere else derived stats touch live matchup data.
 * FAAB remaining and streak (public/assets/team-metrics.js) are read straight off the roster object
 * Sleeper already returns with the roster fetch — zero extra network cost.
 *
 * Record Watch (public/assets/record-watch.js) compares this team's live numbers to the Yahoo-era
 * (2019-2025) record book (public/assets/record-book.js, extracted out of site.js in this
 * increment — 2nd consumer). Transactions (public/assets/transactions.js) shows a 3-week rolling
 * window of this team's Sleeper waiver/FA/trade activity — deliberately not the full season, see
 * docs/prd-team-page-increment3.md.
 */

import {
  listRosterIdentities,
  findRosterByTeam,
  buildStarterSlotOrder,
  buildRosterSlots,
  resolvePlayer
} from "./roster-view.js?v=2";
import { ROSTER_SETTINGS_2026, GENERAL_SETTINGS_2026 } from "./league-settings.js";
import { calculateLeagueRosterStrength } from "./roster-strength.js?v=1";
import { calculatePowerRankings } from "./power-rankings.js?v=1";
import { calculateAllPlayRecords } from "./all-play.js?v=1";
import { calculateFaabRemaining, formatStreak, streakWinCount } from "./team-metrics.js?v=2";
import { buildYahooRecordBook } from "./record-book.js?v=1";
import { highestCompletedScore, buildRecordWatchEntries } from "./record-watch.js?v=1";
import { filterTeamTransactions, describeTransaction } from "./transactions.js?v=1";

const SLEEPER_LEAGUE_ID = "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const SUPABASE_URL = "https://juosrzsffvjprqhdyado.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7Bu9q2dKz0WEol94OGVhHw_xjSwHeHu";
const CURRENT_SEASON = 2026;
const STARTER_SLOT_ORDER = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
const STRENGTH_LABELS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatPoints(value, digits = 1) {
  return Number(value ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);
  return response.json();
}

async function loadPlayerCatalog() {
  const catalog = await fetchJson("/data/players-catalog.json");
  const playerMap = new Map();
  for (const player of catalog.players || []) {
    playerMap.set(player.sleeperId, player);
    playerMap.set(player.name, player);
  }
  return playerMap;
}

async function loadSleeperLeague() {
  const [rosters, users] = await Promise.all([
    fetchJson(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/rosters`),
    fetchJson(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/users`)
  ]);
  return { rosters, users };
}

/** Same query as site.js's live Standings tab — keeps the rank number identical across pages. */
async function loadLiveStandings() {
  return fetchJson(`${SUPABASE_URL}/rest/v1/v_standings?year=eq.${CURRENT_SEASON}&order=live_rank.asc`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` }
  });
}

/** Same query as site.js's Power Rankings page — one Supabase call for every regular-season matchup row. */
async function loadSleeperMatchups() {
  const select = "week,points,opponent_points,is_playoff,team:teams!matchups_team_id_fkey(team_name,season:seasons!inner(year,platform),owner:owners(display_name))";
  const query = new URLSearchParams({ select, "team.season.year": `eq.${CURRENT_SEASON}`, "team.season.platform": "eq.sleeper" });
  const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/matchups?${query}`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` }
  });
  return rows.map(row => ({
    week: row.week,
    manager: row.team?.owner?.display_name,
    team: row.team?.team_name,
    points: row.points,
    opponentPoints: row.opponent_points,
    isPlayoff: row.is_playoff
  }));
}

async function loadLineupAdvisory(team) {
  return fetchJson(`/api/lineup-advisor?team=${encodeURIComponent(team)}`);
}

/**
 * Same gate and inputs as site.js's renderPowerRankings() — never publishes a rank before it's
 * ready. All-Play reuses the exact same matchupRows/currentWeek fetch (one Supabase call, not two)
 * since both derive from the identical completed-weeks window. currentWeek/matchupRows are also
 * returned as-is for Record Watch's per-manager weekly-high lookup.
 */
async function loadSeasonContext(expectedManagers) {
  const [league, nflState, matchupRows] = await Promise.all([
    fetchJson(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}`),
    fetchJson(`${SLEEPER_API}/state/nfl`),
    loadSleeperMatchups()
  ]);
  const currentWeek = league.status === "in_season" && nflState.season_type === "regular" ? Number(nflState.week) : null;
  return {
    currentWeek,
    matchupRows,
    powerRankings: calculatePowerRankings(matchupRows, { currentWeek, expectedManagers }),
    allPlay: calculateAllPlayRecords(matchupRows, { currentWeek, expectedManagers })
  };
}

/**
 * Last 3 weeks of Sleeper transactions across the whole league (waivers/FA/trades) — one fetch
 * per week ("leg"), since Sleeper has no "all transactions" endpoint. Deliberately a rolling
 * window rather than the full season (docs/prd-team-page-increment3.md, decision #1): fetching
 * every week of the season on every page load would be a disproportionate network cost for a
 * "recent activity" feed. Filtered down to one team in showTeam() via filterTeamTransactions.
 * A single bad week is dropped rather than failing the whole feed.
 */
async function loadRecentTransactions(currentWeek) {
  if (!Number.isFinite(currentWeek) || currentWeek < 1) return [];
  const legs = [...new Set([currentWeek - 2, currentWeek - 1, currentWeek].filter(leg => leg >= 1))];
  const perLeg = await Promise.all(legs.map(leg =>
    fetchJson(`${SLEEPER_API}/league/${SLEEPER_LEAGUE_ID}/transactions/${leg}`).catch(() => [])
  ));
  return perLeg.flat();
}

/**
 * Yahoo-era archive (2019-2025), same static files site.js loads for /hall-of-fame/ — cached by
 * the browser like any other static asset, no new backend. Only the matchup archive is needed:
 * Record Watch v1 skips playoff records, so buildYahooRecordBook is called with an empty
 * playoffSeasons array rather than duplicating site.js's private allYahooPlayoffSeasons helper.
 */
async function loadRecordWatchContext() {
  const [history, matchupArchive] = await Promise.all([
    fetchJson("/data/yahoo-history.json?v=4"),
    fetchJson("/data/yahoo-matchups.json?v=2")
  ]);
  const seasonPointsRecord = history.seasons
    .flatMap(season => season.teams.map(team => ({ ...team, year: season.year })))
    .reduce((best, item) => (item.pf > best.pf ? item : best));
  return {
    recordBook: buildYahooRecordBook(matchupArchive, []),
    seasonPointsRecord
  };
}

function playerLabel(player) {
  if (!player) return `<span class="team-slot-empty">Emplacement vide</span>`;
  const team = player.nflTeam ? ` <small>${escapeHtml(player.nflTeam)}</small>` : "";
  return `${escapeHtml(player.name)}${team}`;
}

function rosterGroup(title, items, emptyLabel) {
  if (!items.length) return `<div class="team-roster-group"><h3>${title}</h3><p class="team-roster-empty">${emptyLabel}</p></div>`;
  return `<div class="team-roster-group"><h3>${title}</h3><ul class="team-roster-list">${items.map(item => `
    <li>${item.slot ? `<span class="team-slot-label">${item.slot}</span>` : ""}${playerLabel(item.player)}</li>
  `).join("")}</ul></div>`;
}

function alertsBlock(diagnosis) {
  if (!diagnosis || diagnosis.alerts.length === 0) {
    return `<p class="team-roster-empty">Aucune alerte : lineup complet, personne à risque signalé par Sleeper.</p>`;
  }
  return `<ul class="team-alert-list">${diagnosis.alerts.map(alert => {
    const label = alert.player ? `${escapeHtml(alert.player.name)} (${escapeHtml(alert.player.position)})` : "Emplacement vide";
    const replacement = alert.replacement
      ? ` → remplaçant conseillé : ${escapeHtml(alert.replacement.player.name)} (${alert.replacement.source === "bench" ? "banc" : "free agent"})`
      : " → aucun remplaçant évident";
    return `<li class="team-alert${alert.severity === "ALERT" ? " team-alert-severe" : " team-alert-watch"}"><strong>${escapeHtml(alert.slot)}</strong> — ${label} · ${escapeHtml(alert.reason)}${replacement}</li>`;
  }).join("")}</ul>`;
}

function strengthBlock(strength) {
  if (!strength) return `<p class="team-roster-empty">Estimation indisponible pour cette équipe.</p>`;
  const rows = Object.entries(STRENGTH_LABELS).map(([pos, label]) => {
    const percentile = strength.strength[pos];
    const tag = pos === strength.surplus ? `<span class="team-strength-tag team-strength-surplus">Surplus</span>`
      : pos === strength.need ? `<span class="team-strength-tag team-strength-need">Besoin</span>`
      : "";
    return `<div class="team-strength-row">
      <span class="team-strength-label">${label}</span>
      <div class="team-strength-bar"><span class="team-strength-fill" style="width:${percentile}%"></span></div>
      <span class="team-strength-value">${percentile}${tag}</span>
    </div>`;
  }).join("");
  return `<div class="team-strength-grid">${rows}</div>
    <p class="note">Percentile de valeur de trade (0-100) par poste face aux 11 autres rosters — estimation Adineu basée sur le rang expert/ADP, pas une note officielle.</p>`;
}

function allPlayBlock(allPlay, ownerName) {
  if (!allPlay?.ready) {
    return `<p class="team-roster-empty">Pas encore assez de semaines complètes pour calculer le record all-play.</p>`;
  }
  const row = allPlay.records.find(record => record.manager === ownerName);
  if (!row) return `<p class="team-roster-empty">Record all-play indisponible pour cette équipe.</p>`;
  return `<p><strong>${row.wins}—${row.losses}${row.ties ? `—${row.ties}` : ""}</strong> sur ${row.games} confrontations hypothétiques (${(row.winPct * 100).toFixed(0)}%)</p>
    <p class="note">Si cette équipe avait joué contre les 11 autres chaque semaine, au lieu de son seul adversaire — mesure de régularité, pas le classement officiel.</p>`;
}

function recordWatchBlock(entries) {
  if (!entries || entries.length === 0) {
    return `<p class="team-roster-empty">Record Watch indisponible pour le moment.</p>`;
  }
  return `<ul class="team-record-watch-list">${entries.map(entry => `
    <li class="team-record-watch-item${entry.broken ? " team-record-watch-broken" : ""}">
      <span class="team-record-watch-label">${escapeHtml(entry.label)}</span>
      <span class="team-record-watch-value">${entry.broken
        ? `Nouveau record de la ligue ! (${formatPoints(entry.liveValue, 0)} vs ${formatPoints(entry.recordValue, 0)})`
        : `à ${formatPoints(entry.gap, 0)} du record (${formatPoints(entry.recordValue, 0)}, ${escapeHtml(entry.holder)})`}</span>
    </li>
  `).join("")}</ul>
    <p class="note">Écart brut avec le record book Yahoo 2019–2025 — jamais une probabilité ou une projection.</p>`;
}

const TRANSACTION_TYPE_LABELS = { waiver: "Waiver", free_agent: "Free agent", trade: "Trade" };

function transactionsBlock(transactions, teamNameByRosterId) {
  if (!transactions.length) {
    return `<p class="team-roster-empty">Aucune transaction sur les 3 dernières semaines.</p>`;
  }
  return `<ul class="team-transaction-list">${transactions.map(tx => {
    const date = new Date(tx.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const gained = tx.added.map(item => escapeHtml(item.player.name)).join(", ");
    const lost = tx.dropped.map(item => escapeHtml(item.player.name)).join(", ");
    const parts = [];
    if (gained) parts.push(`<strong>+ ${gained}</strong>`);
    if (lost) parts.push(`<strong>− ${lost}</strong>`);
    const faab = tx.faabSpent ? ` · ${tx.faabSpent}$ FAAB` : "";
    const partner = tx.type === "trade" && tx.otherRosterIds.length
      ? ` · avec ${tx.otherRosterIds.map(id => escapeHtml(teamNameByRosterId.get(id) || `équipe #${id}`)).join(", ")}`
      : "";
    return `<li class="team-transaction"><span class="team-transaction-type">${TRANSACTION_TYPE_LABELS[tx.type] || tx.type}</span>
      <span class="team-transaction-detail">${parts.join(" ") || "Mouvement sans détail"}${faab}${partner}</span>
      <span class="team-transaction-date">${date}</span></li>`;
  }).join("")}</ul>`;
}

function matchesTeamParam(entry, requested) {
  if (!requested) return false;
  const normalized = requested.toLowerCase();
  return entry.ownerName.toLowerCase() === normalized
    || entry.teamName.toLowerCase() === normalized
    || String(entry.roster.roster_id) === requested;
}

export async function renderTeamsHub(container) {
  container.innerHTML = `<section class="section"><div class="shell state">Ouverture du dossier équipe…</div></section>`;

  let rosters = [];
  let users = [];
  let playerMap = new Map();
  try {
    const [league, catalog] = await Promise.all([loadSleeperLeague(), loadPlayerCatalog()]);
    rosters = league.rosters;
    users = league.users;
    playerMap = catalog;
  } catch (error) {
    container.innerHTML = `<section class="section"><div class="shell"><div class="state"><strong>Connexion Sleeper indisponible</strong>${escapeHtml(error.message)}</div></div></section>`;
    return;
  }

  const identities = listRosterIdentities(rosters, users).sort((a, b) => a.teamName.localeCompare(b.teamName, "fr"));
  const teamNameByRosterId = new Map(identities.map(entry => [entry.roster.roster_id, entry.teamName]));
  if (identities.length === 0) {
    container.innerHTML = `<section class="section"><div class="shell"><div class="state"><strong>Aucune équipe trouvée</strong>La ligue Sleeper n'a renvoyé aucun roster.</div></div></section>`;
    return;
  }

  // League-wide aggregates, computed once up front. Each degrades independently: a failure here
  // never blocks the roster/alerts panels, which are the core of the page.
  const strengthByRoster = new Map(
    calculateLeagueRosterStrength(
      rosters.map(roster => ({
        rosterId: roster.roster_id,
        players: (roster.players || []).map(id => resolvePlayer(playerMap, id))
      }))
    ).map(entry => [entry.rosterId, entry])
  );

  let powerRankings = null;
  let allPlay = null;
  let currentWeek = null;
  let matchupRows = [];
  try {
    const seasonContext = await loadSeasonContext(identities.map(entry => entry.ownerName));
    powerRankings = seasonContext.powerRankings;
    allPlay = seasonContext.allPlay;
    currentWeek = seasonContext.currentWeek;
    matchupRows = seasonContext.matchupRows;
  } catch {
    powerRankings = null; // Power Rank badge and All-Play both simply don't show — never a
    allPlay = null; // fabricated pre-gate value.
  }

  let recordWatchContext = null;
  try {
    recordWatchContext = await loadRecordWatchContext();
  } catch {
    recordWatchContext = null; // Record Watch panel simply doesn't show — independent failure.
  }

  let recentTransactions = [];
  try {
    recentTransactions = await loadRecentTransactions(currentWeek);
  } catch {
    recentTransactions = []; // Transactions feed simply doesn't show — independent failure.
  }

  const requested = new URLSearchParams(window.location.search).get("team");
  const defaultOwnerName = identities.find(entry => matchesTeamParam(entry, requested))?.ownerName
    || identities.find(entry => entry.ownerName.toLowerCase() === "t0z")?.ownerName
    || identities[0].ownerName;

  container.innerHTML = `
    <section class="hero"><div class="shell">
      <p class="eyebrow">Adineu NFL · Dossier équipe</p>
      <h1>Chaque manager. <em>Une page.</em></h1>
      <p class="lede">Roster live, record, force par poste et alertes lineup — tout ce qu'il faut savoir avant de trader ou de sortir un joueur.</p>
    </div></section>
    <section class="section"><div class="shell">
      <div class="toolbar">
        <label for="team-select">Équipe
          <select id="team-select">${identities.map(entry => `<option value="${escapeHtml(entry.ownerName)}"${entry.ownerName === defaultOwnerName ? " selected" : ""}>${escapeHtml(entry.teamName)} (@${escapeHtml(entry.ownerName)})</option>`).join("")}</select>
        </label>
      </div>
      <div id="team-profile" aria-live="polite"><div class="state">Chargement…</div></div>
    </div></section>
  `;

  const select = document.getElementById("team-select");
  const profile = document.getElementById("team-profile");

  async function showTeam(team) {
    profile.innerHTML = `<div class="state">Chargement du dossier…</div>`;

    let entry;
    try {
      entry = findRosterByTeam(rosters, users, team);
    } catch (error) {
      profile.innerHTML = `<div class="state"><strong>Équipe introuvable</strong>${escapeHtml(error.message)}</div>`;
      return;
    }

    const { starters, bench, ir } = buildRosterSlots({ roster: entry.roster, playerMap, starterSlotOrder: STARTER_SLOT_ORDER });
    const strength = strengthByRoster.get(entry.roster.roster_id) || null;
    const teamTransactions = filterTeamTransactions(recentTransactions, entry.roster.roster_id)
      .map(row => describeTransaction(row, { rosterId: entry.roster.roster_id, playerMap }));
    const powerRow = powerRankings?.ready ? powerRankings.rankings.find(row => row.manager === entry.ownerName) : null;
    const faabRemaining = calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, entry.roster.settings?.waiver_budget_used);
    const streakLabel = formatStreak(entry.roster.metadata?.streak);

    const [standingsResult, advisoryResult] = await Promise.allSettled([
      loadLiveStandings(),
      loadLineupAdvisory(entry.ownerName)
    ]);

    const standingsRow = standingsResult.status === "fulfilled"
      ? standingsResult.value.find(row => row.owner_name === entry.ownerName) || null
      : null;
    const standingsError = standingsResult.status === "rejected" ? standingsResult.reason.message : null;

    // Only meaningful once we know this team's live points_for (from standingsRow above) — that's
    // why this sits after the Promise.allSettled above rather than beside the other pure lookups.
    const recordWatchEntries = (recordWatchContext && standingsRow) ? buildRecordWatchEntries({
      recordBook: recordWatchContext.recordBook,
      seasonPointsRecord: recordWatchContext.seasonPointsRecord,
      liveHighScore: highestCompletedScore(matchupRows, entry.ownerName, currentWeek),
      liveStreakWins: streakWinCount(entry.roster.metadata?.streak),
      livePointsFor: standingsRow.points_for
    }) : [];

    const diagnosis = advisoryResult.status === "fulfilled" ? advisoryResult.value : null;
    const advisorError = advisoryResult.status === "rejected" ? advisoryResult.reason.message : null;

    const teamParam = encodeURIComponent(entry.ownerName);

    profile.innerHTML = `
      <div class="team-profile-head">
        <div>
          <span class="franchise-kicker">${standingsRow ? `#${standingsRow.live_rank} · ` : ""}Saison 2026</span>
          <h2>${escapeHtml(entry.teamName)}</h2>
          <p>Manager · ${escapeHtml(entry.ownerName)}</p>
        </div>
        ${standingsRow ? `<div class="team-record">
            <strong>${standingsRow.wins}—${standingsRow.losses}${standingsRow.ties ? `—${standingsRow.ties}` : ""}</strong>
            <span>${formatPoints(standingsRow.points_for)} PF · ${formatPoints(standingsRow.points_against)} PA</span>
            ${powerRow ? `<span class="team-power-badge">Power Rank #${powerRow.rank} · ${formatPoints(powerRow.powerScore, 1)}</span>` : ""}
            ${streakLabel ? `<span>${escapeHtml(streakLabel)}</span>` : ""}
            ${faabRemaining !== null ? `<span>FAAB restant : ${faabRemaining}$</span>` : ""}
          </div>` : `<p class="note">${standingsError ? `Classement live indisponible — ${escapeHtml(standingsError)}` : "Classement pas encore disponible pour cette équipe."}</p>`}
      </div>

      <div class="team-roster-grid">
        ${rosterGroup("Titulaires", starters, "Aucun titulaire.")}
        ${rosterGroup("Banc", bench.map(player => ({ player })), "Banc vide.")}
        ${rosterGroup("IR", ir.map(player => ({ player })), "Aucun joueur en IR.")}
      </div>

      <div class="team-strength">
        <h3>Force du roster par poste</h3>
        ${strengthBlock(strength)}
      </div>

      <div class="team-alerts">
        <h3>Alertes lineup</h3>
        ${advisorError ? `<p class="note">Alertes indisponibles — ${escapeHtml(advisorError)}</p>` : alertsBlock(diagnosis)}
      </div>

      <div class="team-all-play">
        <h3>Record all-play</h3>
        ${allPlayBlock(allPlay, entry.ownerName)}
      </div>

      <div class="team-record-watch">
        <h3>Record Watch</h3>
        ${recordWatchBlock(recordWatchEntries)}
      </div>

      <div class="team-transactions">
        <h3>Transactions récentes <small>(3 dernières semaines)</small></h3>
        ${transactionsBlock(teamTransactions, teamNameByRosterId)}
      </div>

      <div class="team-links">
        <a class="source-link" href="/trades/?team=${teamParam}#recommendations">Chercher des trades pour cette équipe ↗</a>
        <a class="source-link" href="/matchups/">Voir les matchups de la semaine ↗</a>
      </div>
    `;

    window.history.replaceState(null, "", `${window.location.pathname}?team=${teamParam}`);
  }

  select.addEventListener("change", () => showTeam(select.value));
  await showTeam(defaultOwnerName);
}
