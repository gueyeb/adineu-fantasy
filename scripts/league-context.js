#!/usr/bin/env node
import { formatTeRosterUtility } from './te-roster-utility.js';
import { loadProjectionCapture, buildProjectionComparison } from './projection-comparison.js';
import { createWaiverEvaluator } from "./waiver-evaluator.js";
import { extractDecisionFeatures, SEVERITY_BY_STATUS } from "./decision-features.js";
import { buildCoherenceWarnings, formatCoherenceWarnings } from "../public/assets/decision-coherence.js";
import { resolveAcquisitionAvailability, summarizeRecentTransactions, resolveRoleEvidence, formatRecentTransactions, findRecentDrops, nextWeekHorizon } from "../public/assets/acquisition-availability.js";
/**
 * Adineu Fantasy — Contexte IA & Waiver Wire Report
 *
 * Usage :
 *   node scripts/league-context.js --team=t0z
 *   node scripts/league-context.js --free-agents
 *   node scripts/league-context.js --free-agents --position=RB
 */

import { normalizeRosterPreferences } from "../public/assets/roster-preferences.js";
import { buildAcquisitionPlan, formatClaimPortfolio } from "../public/assets/waiver-plan.js";
import { summarizeMatchupCoverage } from "../public/assets/matchup-coverage.js";
import { loadDecisionEvidence, easternKickoffIso } from "./decision-evidence.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  LEAGUE_METADATA_2026,
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026
} from "../public/assets/league-settings.js";
import { resolveOperationalWeek, resolveLastCompletedWeek } from "../public/assets/nfl-week.js";
import { findRosterByTeam, buildStarterSlotOrder, buildRosterSlots, listRosterIdentities } from "../public/assets/roster-view.js";
import { buildFaabHistory, buildTrendingAdds, summarizeFaabByPosition } from "../public/assets/league-market.js";
import { buildPlayerWeeks, calculateUsageScores } from "../public/assets/usage-score.js";
import { calculateFaabRemaining } from "../public/assets/team-metrics.js";
import { restOfSeasonEstimate } from "../public/assets/trade-score.js";
import {
  FANTASY_POSITIONS,
  LAST_REGULAR_WEEK,
  PRICE_PER_POINT,
  evaluateMarket
} from "../public/assets/waiver-model.js";

export const DEFAULT_SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_CATALOG_URL = new URL("../public/data/players-catalog.json", import.meta.url);
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
const STARTER_SLOT_ORDER = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
const INJURY_STATUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // le dump Sleeper /players/nfl pèse ~15 Mo, on ne le refetch pas à chaque requête

// Statuts Sleeper connus : Questionable, Doubtful, Out, IR, PUP, Sus, NA.
export { SEVERITY_BY_STATUS };

// Par fetchImpl, comme les caches hebdo : un fetch injecté ne partage jamais l'index réel.
const playersIndexCaches = new WeakMap();

/**
 * Index allégé (et mis en cache 6 h) du dump Sleeper /players/nfl (~15 Mo) : poste, équipe,
 * statut et zone de blessure, depth chart. Partagé par le Start/Sit Advisor, le Trade Finder
 * (/api/player-status) et le Waiver Wire v2 (événements : promotion, blessure du titulaire).
 */
export async function getPlayersIndex({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const now = Date.now();
  const hit = playersIndexCaches.get(fetchImpl);
  if (!forceRefresh && hit && (now - hit.at) < INJURY_STATUS_CACHE_TTL_MS) return hit.index;

  const response = await fetchImpl(`${SLEEPER_API}/players/nfl`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Sleeper API /players/nfl -> HTTP ${response.status}`);
  const raw = await response.json();

  const index = new Map();
  for (const [playerId, player] of Object.entries(raw || {})) {
    if (!player) continue;
    const position = player.position || player.fantasy_positions?.[0] || null;
    index.set(playerId, {
      id: playerId,
      name: player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || `Player #${playerId}`,
      position,
      nflTeam: player.team || null,
      injuryStatus: player.injury_status || null,
      injuryBodyPart: player.injury_body_part || null,
      depthOrder: Number.isFinite(player.depth_chart_order) ? player.depth_chart_order : null,
      teamChangedAt: Number.isFinite(player.team_changed_at) ? player.team_changed_at : null,
      searchRank: Number.isFinite(player.search_rank) ? player.search_rank : null,
      active: player.active !== false
    });
  }

  playersIndexCaches.set(fetchImpl, { at: now, index });
  return index;
}

/** sleeperId -> injury_status, pour les joueurs qui en ont un. */
export async function getInjuryStatuses({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const index = await getPlayersIndex({ fetchImpl, forceRefresh });
  const statuses = new Map();
  for (const [playerId, player] of index) {
    if (player.injuryStatus) statuses.set(playerId, player.injuryStatus);
  }
  return statuses;
}

async function sleeperGet(path, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${SLEEPER_API}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Sleeper API ${path} -> HTTP ${response.status}`);
  return response.json();
}

async function loadPlayerCatalog(catalogUrl = DEFAULT_CATALOG_URL) {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const playerMap = new Map();
  for (const player of catalog.players || []) {
    playerMap.set(player.sleeperId, player);
    playerMap.set(player.name, player);
  }
  return { catalog, playerMap };
}

/**
 * Agrège les règles de ligue et le roster d'une équipe (titulaires/banc/IR) en un seul objet,
 * pensé pour être collé tel quel dans un assistant IA externe.
 */
export async function getLeagueContext({
  team = "t0z",
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL
} = {}) {
  const { playerMap } = await loadPlayerCatalog(catalogUrl);
  const [rosters, users] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl })
  ]);

  const { roster, ownerName, teamName } = findRosterByTeam(rosters, users, team);
  const settings = roster.settings || {};
  const points = (whole, decimal) => {
    const base = Number(whole ?? 0);
    const cents = Number(decimal ?? 0);
    return Number((base + cents / 100).toFixed(2));
  };
  const standings = [...rosters].sort((a, b) => {
    const aSettings = a.settings || {};
    const bSettings = b.settings || {};
    return (Number(bSettings.wins || 0) - Number(aSettings.wins || 0)) ||
      (points(bSettings.fpts, bSettings.fpts_decimal) - points(aSettings.fpts, aSettings.fpts_decimal));
  });
  const standingsRank = standings.findIndex(entry => entry.roster_id === roster.roster_id) + 1;
  const faabBudget = GENERAL_SETTINGS_2026.waiver.budget;
  const faabUsed = Number(settings.waiver_budget_used || 0);

  let week = 1;
  try {
    const nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}

  const { starters, bench, ir } = buildRosterSlots({ roster, playerMap, starterSlotOrder: STARTER_SLOT_ORDER });

  return {
    generatedAt: new Date().toISOString(),
    week,
    league: {
      id: leagueId,
      name: LEAGUE_METADATA_2026.name,
      teams: GENERAL_SETTINGS_2026.teams,
      playoffTeams: GENERAL_SETTINGS_2026.playoffTeams,
      format: "redraft",
      scoring: "full_ppr",
      rosterSettings: ROSTER_SETTINGS_2026,
      // Kept for backwards compatibility. This is the league's initial budget, not the balance.
      faab: faabBudget,
      faabBudget,
      waiverClear: `${GENERAL_SETTINGS_2026.waiver.clearDay} ${GENERAL_SETTINGS_2026.waiver.clearTime}`,
      tradeDeadlineWeek: GENERAL_SETTINGS_2026.trades.deadlineWeek
    },
    myTeam: {
      rosterId: roster.roster_id,
      owner: ownerName,
      teamName,
      record: {
        wins: Number(settings.wins || 0),
        losses: Number(settings.losses || 0),
        ties: Number(settings.ties || 0)
      },
      standingsRank,
      pointsFor: points(settings.fpts, settings.fpts_decimal),
      pointsAgainst: points(settings.fpts_against, settings.fpts_against_decimal),
      faab: {
        budget: faabBudget,
        used: faabUsed,
        remaining: calculateFaabRemaining(faabBudget, faabUsed)
      },
      waiverPriority: Number.isFinite(Number(settings.waiver_position)) ? Number(settings.waiver_position) : null,
      streak: roster.metadata?.streak || null,
      starters,
      bench,
      ir
    }
  };
}

/** Current Sleeper head-to-head and published starter projections for one team. */
export async function getMatchupContext({
  team = "t0z",
  week,
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch
} = {}) {
  const [rosters, users, matchupRows, projections, schedule, players] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/matchups/${week}`, { fetchImpl }),
    getWeeklyProjections({ week, fetchImpl }).catch(() => ({})),
    getSchedule({ fetchImpl }).catch(() => []),
    getPlayersIndex({ fetchImpl }).catch(() => new Map())
  ]);
  const mine = findRosterByTeam(rosters, users, team);
  const myRow = matchupRows.find(row => row.roster_id === mine.roster.roster_id);
  if (!myRow || myRow.matchup_id === null || myRow.matchup_id === undefined) return null;
  const opponentRow = matchupRows.find(row => row.matchup_id === myRow.matchup_id && row.roster_id !== myRow.roster_id);
  if (!opponentRow) return null;
  const opponent = listRosterIdentities(rosters, users).find(entry => entry.roster.roster_id === opponentRow.roster_id);
  if (!opponent) return null;
  const projected = row => summarizeMatchupCoverage({
    starters: row.starters || [], requiredSlots: STARTER_SLOT_ORDER.length, projections,
    actualPoints: row.players_points || {},
    gameStateOf: id => {
      const team = players.get(id)?.nflTeam;
      const game = schedule.find(g => g.week === week && [g.away_team, g.home_team].includes(team));
      if (!game?.kickoffAt) return "UNKNOWN";
      return game.completed ? "FINAL" : Date.parse(game.kickoffAt) <= Date.now() ? "LIVE" : "PREGAME";
    }
  });
  return {
    week,
    opponent: {
      rosterId: opponent.roster.roster_id,
      owner: opponent.ownerName,
      teamName: opponent.teamName,
      record: {
        wins: Number(opponent.roster.settings?.wins || 0),
        losses: Number(opponent.roster.settings?.losses || 0),
        ties: Number(opponent.roster.settings?.ties || 0)
      }
    },
    myProjection: projected(myRow),
    opponentProjection: projected(opponentRow),
    currentScore: Number(myRow.points || 0),
    opponentCurrentScore: Number(opponentRow.points || 0),
    source: "Sleeper"
  };
}

function formatPlayerLine(player) {
  if (!player) return "EMPTY";
  const team = player.nflTeam ? ` ${player.nflTeam}` : "";
  return `${player.name}${team}`;
}

/** Rend le contexte en texte brut, prêt à coller dans un chat IA externe. */
export function formatContextText(context) {
  const { league, myTeam, week } = context;
  const startersLabel = Object.entries(league.rosterSettings.starters)
    .map(([pos, count]) => `${count}${pos}`)
    .join(" ");
  const record = myTeam.record || { wins: 0, losses: 0, ties: 0 };
  const recordText = `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
  const faabBudget = myTeam.faab?.budget ?? league.faabBudget ?? league.faab;
  const faabRemaining = myTeam.faab?.remaining ?? faabBudget;
  const faabUsed = myTeam.faab?.used ?? Math.max(0, faabBudget - faabRemaining);

  const lines = [
    `${league.name.toUpperCase()}`,
    `${league.teams} teams · Full PPR · ${startersLabel} · ${league.rosterSettings.benchSlots} bench · ${league.rosterSettings.reserveSlots} IR`,
    `FAAB restant: $${faabRemaining} / $${faabBudget} (${faabUsed} $ dépensés)`,
    `Waivers: ${league.waiverClear}`,
    `Semaine: ${week}`,
    "",
    `MON ROSTER — ${myTeam.teamName.toUpperCase()} (@${myTeam.owner})`,
    `Bilan: ${recordText} · Rang: ${myTeam.standingsRank ?? "n/d"}/${league.teams} · PF: ${myTeam.pointsFor ?? "n/d"} · PA: ${myTeam.pointsAgainst ?? "n/d"}`,
    `Priorité waiver (départage): ${myTeam.waiverPriority ?? "n/d"}${myTeam.streak ? ` · Série: ${myTeam.streak}` : ""}`,
    "",
    "TITULAIRES"
  ];

  for (const starter of myTeam.starters) lines.push(`${starter.slot} ${formatPlayerLine(starter.player)}`);

  lines.push("", "BANC");
  if (myTeam.bench.length === 0) lines.push("EMPTY");
  for (const player of myTeam.bench) lines.push(`${(player.position || "FLEX")} ${formatPlayerLine(player)}`);

  lines.push("", "IR");
  if (myTeam.ir.length === 0) lines.push("EMPTY");
  for (const player of myTeam.ir) lines.push(`${(player.position || "FLEX")} ${formatPlayerLine(player)}`);

  return lines.join("\n");
}

// Par fetchImpl : un fetch injecté (tests) ne partage jamais le cache du vrai Sleeper.
const weeklyCaches = new WeakMap();
/** Stats/projections Sleeper d'une semaine, en cache 1 h (une semaine terminée ne bouge presque plus). */
async function cachedWeekly(path, fetchImpl) {
  if (!weeklyCaches.has(fetchImpl)) weeklyCaches.set(fetchImpl, new Map());
  const cache = weeklyCaches.get(fetchImpl);
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const data = await sleeperGet(path, { fetchImpl });
  cache.set(path, { at: Date.now(), data });
  return data;
}

/**
 * Usage Score (docs/prd-usage-score.md) : parts d'usage des 3 dernières semaines terminées,
 * points attendus (xFP) et signaux buy-low / sell-high, pour tous les RB/WR/TE ayant joué,
 * avec l'équipe Adineu qui les détient. `team` = l'équipe analysée (ses joueurs sont marqués `mine`).
 */
export async function getUsageReport({ leagueId = DEFAULT_SLEEPER_LEAGUE_ID, fetchImpl = fetch, team = null, weeksBack = 3 } = {}) {
  const [rosters, users, nflState] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl }),
    sleeperGet("/state/nfl", { fetchImpl }).catch(() => ({}))
  ]);
  // Équipe inconnue : 404 avant tout le travail coûteux.
  const mine = team ? findRosterByTeam(rosters, users, team).roster.roster_id : null;
  const season = nflState?.season || "2026";
  const lastCompletedWeek = resolveLastCompletedWeek(nflState);
  const index = await getPlayersIndex({ fetchImpl });
  const statsByWeek = [];
  for (let w = Math.max(1, lastCompletedWeek - weeksBack + 1); w <= lastCompletedWeek && lastCompletedWeek > 0; w++) {
    try { statsByWeek.push({ week: w, stats: await cachedWeekly(`/stats/nfl/regular/${season}/${w}`, fetchImpl) }); } catch {}
  }
  // Les stats hebdo Sleeper n'ont pas d'équipe : on prend l'équipe actuelle, sauf pour les semaines
  // jouées avant un transfert (team_changed_at), exclues plutôt qu'attribuées à la mauvaise équipe.
  const seasonStart = Date.parse(nflState?.season_start_date || "2026-09-09");
  const weekEnd = week => seasonStart + week * 7 * 24 * 3600 * 1000;
  const teamOf = (id, week) => {
    const player = index.get(id);
    if (!player?.nflTeam) return null;
    return Number.isFinite(player.teamChangedAt) && player.teamChangedAt > weekEnd(week) && player.teamChangedAt > seasonStart ? null : player.nflTeam;
  };
  const rows = buildPlayerWeeks(statsByWeek, { teamOf, positionOf: id => index.get(id)?.position });
  const { players, models } = calculateUsageScores(rows);

  const identities = listRosterIdentities(rosters, users);
  const ownerOf = new Map(identities.flatMap(({ roster, teamName }) => (roster.players || []).map(id => [id, { rosterId: roster.roster_id, teamName }])));
  return {
    generatedAt: new Date().toISOString(),
    weeks: statsByWeek.map(entry => entry.week),
    degraded: statsByWeek.length < Math.min(weeksBack, lastCompletedWeek),
    models,
    team: team || null,
    players: players.map(player => {
      const meta = index.get(player.playerId) || {};
      const owner = ownerOf.get(player.playerId) || null;
      return { ...player, name: meta.name || `Player #${player.playerId}`, injuryStatus: meta.injuryStatus || null, owner: owner?.teamName || null, mine: mine !== null && owner?.rosterId === mine };
    })
  };
}

/** Stats Sleeper d'une semaine terminée (cache 1 h). */
export async function getWeeklyStats({ week, season = "2026", fetchImpl = fetch } = {}) {
  return cachedWeekly(`/stats/nfl/regular/${season}/${week}`, fetchImpl);
}

const NFLVERSE_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const NFLVERSE_TO_SLEEPER_TEAM = { LA: "LAR" };
const scheduleCaches = new WeakMap();
/** Calendrier NFL de la saison régulière (nflverse games.csv, gratuit), codes d'équipe Sleeper. Cache 12 h. */
export async function getSchedule({ season = "2026", fetchImpl = fetch } = {}) {
  const hit = scheduleCaches.get(fetchImpl);
  if (hit && hit.season === season && Date.now() - hit.at < 12 * 3600 * 1000) return hit.games;
  const response = await fetchImpl(NFLVERSE_GAMES_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`nflverse games.csv -> HTTP ${response.status}`);
  const [header, ...lines] = (await response.text()).trim().split("\n");
  const columns = header.split(",");
  const at = name => columns.indexOf(name);
  const team = code => NFLVERSE_TO_SLEEPER_TEAM[code] || code;
  const games = lines.map(line => line.split(","))
    .filter(cells => cells[at("season")] === String(season) && cells[at("game_type")] === "REG")
    .map(cells => ({ week: Number(cells[at("week")]), away_team: team(cells[at("away_team")]), home_team: team(cells[at("home_team")]), kickoffAt: easternKickoffIso(cells[at("gameday")], cells[at("gametime")]), completed: cells[at("away_score")] !== "" && cells[at("home_score")] !== "" && Number.isFinite(Number(cells[at("away_score")])) && Number.isFinite(Number(cells[at("home_score")])), source: NFLVERSE_GAMES_URL }));
  scheduleCaches.set(fetchImpl, { at: Date.now(), season, games });
  return games;
}

/** Projections Sleeper d'une semaine (cache 1 h), pour le Start/Sit Advisor. */
export async function getWeeklyProjections({ week, season = "2026", fetchImpl = fetch } = {}) {
  return cachedWeekly(`/projections/nfl/regular/${season}/${week}`, fetchImpl);
}

/**
 * Waiver Wire v2 (docs/prd-waiver-model-v2.md) : Event -> Opportunity -> Roster Fit -> FAAB.
 * Pool = tous les joueurs Sleeper non rostés (pas seulement le catalogue pré-draft), valorisés
 * sur le reste de la saison (projections Sleeper des semaines futures), l'usage réel des 3
 * dernières semaines (snaps, opportunités, red zone) et les événements (titulaire blessé devant
 * eux, explosion de snaps/usage). Avec `team`, ajoute le fit roster et le max FAAB pour cette équipe.
 */
export async function getFreeAgents({
  leagueId = DEFAULT_SLEEPER_LEAGUE_ID,
  fetchImpl = fetch,
  catalogUrl = DEFAULT_CATALOG_URL,
  position = null,
  limitPerPosition = 10,
  team = null,
  forceRefreshInjuryStatuses = false,
  availabilityEvidenceById = null,
  roleEvidenceById = null,
  eventsById = null,
  rosterPreferences = null,
  evidencePath = process.env.DECISION_EVIDENCE_FILE,
  asOf = null,
  onDecisionInputs = null,
  projectionCapturePath = process.env.PROJECTION_COMPARISON_FILE
} = {}) {
  const { catalog } = await loadPlayerCatalog(catalogUrl);
  const catalogById = new Map((catalog.players || []).map(player => [player.sleeperId, player]));
  let rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
  let ownershipAsOf = new Date().toISOString();
  let rosteredIds = new Set(rosters.flatMap(roster => roster.players || []));

  let week = 1;
  let nflState = {};
  try {
    nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}
  const season = nflState?.season || "2026";
  const lastCompletedWeek = resolveLastCompletedWeek(nflState);
  const [storedEvidence, schedule] = await Promise.all([
    loadDecisionEvidence({ path: evidencePath, leagueId, season, week }),
    getSchedule({ season, fetchImpl }).catch(() => [])
  ]);
  availabilityEvidenceById ??= storedEvidence.availabilityById;
  roleEvidenceById ??= storedEvidence.rolesById;
  eventsById ??= storedEvidence.eventsById ?? {};
  rosterPreferences ??= storedEvidence.rosterPreferences;
  const transactionsByWeek = [];
  for (let w = 1; w <= week; w++) {
    try {
      const transactions = await sleeperGet(`/league/${leagueId}/transactions/${w}`, { fetchImpl });
      if (Array.isArray(transactions)) transactionsByWeek.push({ week: w, transactions });
    } catch {}
  }
  const transactionsFetchedAt = new Date().toISOString();
  let ownershipRechecked = false;
  try {
    rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
    rosteredIds = new Set(rosters.flatMap(roster => roster.players || []).map(String));
    ownershipAsOf = new Date().toISOString();
    ownershipRechecked = true;
  } catch {}
  asOf ??= new Date().toISOString();
  const allTransactions = transactionsByWeek.flatMap(batch => batch.transactions);
  const latestTransactionAt = id => Math.max(0, ...allTransactions.filter(t => t.status === "complete" &&
    (Object.hasOwn(t.adds || {}, id) || Object.hasOwn(t.drops || {}, id))).map(t => Number(t.status_updated ?? t.created) || 0));
  const snapshotIssues = ["OWNERSHIP_AND_TRANSACTIONS_FETCHED_SEPARATELY", ...storedEvidence.issues];
  if (!ownershipRechecked) snapshotIssues.push("OWNERSHIP_RECHECK_FAILED");
  if (transactionsByWeek.length !== week) snapshotIssues.push("INCOMPLETE_TRANSACTIONS");
  const kickoffFor = player => schedule.find(game => game.week === week && [game.away_team, game.home_team].includes(player.nflTeam));
  const recentDrops = findRecentDrops(allTransactions, { asOf });
  const availabilityFor = player => {
    const game = kickoffFor(player);
    return resolveAcquisitionAvailability({ playerId: player.sleeperId, rosters,
      evidence: availabilityEvidenceById[player.sleeperId], kickoffAt: game?.kickoffAt,
      kickoffSource: game?.source, asOf, week, season, leagueId, latestTransactionAt: latestTransactionAt(player.sleeperId),
      recentDrop: recentDrops.get(String(player.sleeperId)) ?? null });
  };
  const horizonFor = player => nextWeekHorizon({ schedule, week, nflTeam: player.nflTeam });

  let index = new Map();
  try {
    index = await getPlayersIndex({ fetchImpl, forceRefresh: forceRefreshInjuryStatuses });
  } catch {}

  const projectionsByWeek = {};
  await Promise.all(Array.from({ length: Math.max(0, LAST_REGULAR_WEEK - week + 1) }, (_, i) => week + i).map(async w => {
    try { projectionsByWeek[w] = await cachedWeekly(`/projections/nfl/regular/${season}/${w}`, fetchImpl); } catch {}
  }));
  const statsByWeek = [];
  for (let w = Math.max(1, lastCompletedWeek - 2); w <= lastCompletedWeek && lastCompletedWeek > 0; w++) {
    try { statsByWeek.push({ week: w, stats: await cachedWeekly(`/stats/nfl/regular/${season}/${w}`, fetchImpl) }); } catch {}
  }

  const expectedProjectionWeeks = Math.max(0, LAST_REGULAR_WEEK - week + 1);
  const coverage = {
    projectionWeeks: `${Object.keys(projectionsByWeek).length}/${expectedProjectionWeeks}`,
    statsWeeks: `${statsByWeek.length}/${lastCompletedWeek > 0 ? Math.min(3, lastCompletedWeek) : 0}`,
    playersIndex: index.size > 0
  };
  const degraded = Object.keys(projectionsByWeek).length < expectedProjectionWeeks || !coverage.playersIndex ||
    statsByWeek.length < (lastCompletedWeek > 0 ? Math.min(3, lastCompletedWeek) : 0);

  const fetchedAtByPath = Object.fromEntries([...weeklyCaches.get(fetchImpl) || []].map(([path, entry]) => [path, new Date(entry.at).toISOString()]));
  const { rows, rosFor, meta, rosterPlayerFor, poolCoverage } = extractDecisionFeatures({ index, catalog, rosters, nflState, projectionsByWeek, statsByWeek, fetchedAtByPath, roleEvidenceById, eventsById, allTransactions, asOf, week, lastCompletedWeek, season, leagueId });

  const market = evaluateMarket({ rows, week });
  let users = [];
  try { users = await sleeperGet(`/league/${leagueId}/users`, { fetchImpl }); } catch {}
  let fitContext = null;
  if (team) {
    const { roster } = findRosterByTeam(rosters, users, team);
    rosterPreferences = normalizeRosterPreferences(rosterPreferences, { asOf, rosterId: roster.roster_id }).filter(row => (roster.players || []).includes(row.playerId));
    const myPlayers = (roster.players || []).map(rosterPlayerFor);
    const fallback = restOfSeasonEstimate(week);
    const paceOf = player => player.effectivePpg ?? rosFor(player.sleeperId, player) ?? fallback(player);
    const replacementByPosition = Object.fromEntries(FANTASY_POSITIONS.map(pos => [pos, market.find(row => row.position === pos)?.replacementPpg ?? 0]));
    const protectedIds = new Set([...(roster.reserve || [])].filter(id => id && id !== "0").map(String));
    const starterIds = new Set((roster.starters || []).map(String));
    const lockedIds = new Set(myPlayers.filter(p => {
      if (BYE_WEEKS_2026[p.nflTeam] === week) return false;
      const kickoff = availabilityFor(p).kickoffAt;
      return !kickoff || Date.parse(kickoff) <= Date.parse(asOf);
    }).map(p => String(p.sleeperId)));
    const occurrences = {};
    const frozenSlots = Object.fromEntries((roster.starters || []).map((id, i) => {
      const position = STARTER_SLOT_ORDER[i];
      occurrences[position] = (occurrences[position] || 0) + 1;
      const slot = ROSTER_SETTINGS_2026.starters[position] > 1 ? `${position}${occurrences[position]}` : position;
      return [slot, id];
    }).filter(([slot, id]) => slot && lockedIds.has(String(id))));
    const weeklyPaceOf = (player, w) => BYE_WEEKS_2026[player.nflTeam] === w || SEVERITY_BY_STATUS[player.injuryStatus] === "ALERT" && w === week ? 0 : projectionsByWeek[w]?.[player.sleeperId]?.pts_ppr ?? null;
    const projectionCovered = (player, w) => Number.isFinite(weeklyPaceOf(player, w));
    const activeCount = myPlayers.filter(p => !protectedIds.has(String(p.sleeperId))).length;
    const hasOpenRosterSlot = activeCount < STARTER_SLOT_ORDER.length + ROSTER_SETTINGS_2026.benchSlots;
    fitContext = { rosterPreferences, myPlayers, paceOf, weeklyPaceOf, projectionCovered, frozenSlots, hasOpenRosterSlot, starterTeId: (roster.starters || [])[STARTER_SLOT_ORDER.indexOf("TE")] ?? null, starterIds, lockedIds, protectedIds, reserveIds: new Set(protectedIds), replacementByPosition, faabRemaining: calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, roster.settings?.waiver_budget_used) };
  }

  const withWaiver = createWaiverEvaluator({ fitContext, week, availabilityFor, ownershipRechecked, transactionsComplete: transactionsByWeek.length === week, horizonFor });

  const normalizedPosition = position ? String(position).toUpperCase() : null;
  const byPosition = {};
  for (const row of market) {
    if (normalizedPosition && row.position !== normalizedPosition) continue;
    if (!byPosition[row.position]) byPosition[row.position] = [];
    // The per-position limit never hides a recent cut or a sourced event.
    if (byPosition[row.position].length >= limitPerPosition && !row.poolEntry?.pinned) continue;
    byPosition[row.position].push(withWaiver(row));
  }
  const board = Object.values(byPosition).flat();
  const boardCoverage = { ...poolCoverage, evaluated: market.length, returned: board.length, limitPerPosition,
    pinnedOnBoard: board.filter(row => row.poolEntry?.pinned).map(row => ({ playerId: row.sleeperId, name: row.name, reasons: row.poolEntry.reasons, availability: row.availability?.availability ?? "UNKNOWN" })) };

  // Signaux de marché de la ligue (benchmark Fantasy Life, lot 1) : enchères gagnées + trending Sleeper.
  const rosterNameById = new Map(listRosterIdentities(rosters, users).map(({ roster, teamName }) => [String(roster.roster_id), teamName]));
  const rosterOfPlayer = new Map(rosters.flatMap(roster => (roster.players || []).map(id => [id, rosterNameById.get(String(roster.roster_id)) || null])));
  const faabHistory = buildFaabHistory(transactionsByWeek, { playerMeta: meta, rosterName: rosterId => rosterNameById.get(String(rosterId)) || null });
  let trendingRaw = [];
  try { trendingRaw = await cachedWeekly("/players/nfl/trending/add?lookback_hours=48&limit=25", fetchImpl); } catch {}
  const marketById = new Map(market.map(row => [row.sleeperId, row]));
  const trending = buildTrendingAdds(trendingRaw || [], {
    rosteredIds,
    rosterOf: id => rosterOfPlayer.get(id) || null,
    playerMeta: meta,
    modelRowOf: id => marketById.has(id) ? withWaiver(marketById.get(id)) : null
  });

  const acquisitionPlan = fitContext ? buildAcquisitionPlan({
    candidates: Object.values(byPosition).flat(), myPlayers: fitContext.myPlayers,
    faabRemaining: fitContext.faabRemaining,
    rosterCapacity: STARTER_SLOT_ORDER.length + ROSTER_SETTINGS_2026.benchSlots + fitContext.protectedIds.size,
    evaluateCandidate: withWaiver
  }) : null;
  // Sanity checks before publication: computed on what is actually returned.
  const coherence = buildCoherenceWarnings({ boardRows: board, marketRows: market, myPlayers: fitContext?.myPlayers ?? [] });
  const projectionCapture = await loadProjectionCapture(projectionCapturePath);
  const projectionComparison = buildProjectionComparison({ capture: projectionCapture, season, week, asOf,
    players: [...index].map(([sleeperId, player]) => ({ ...player, sleeperId })), schedule });
  if (onDecisionInputs) {
    const evaluatedPlayers = [...market, ...(fitContext?.myPlayers || [])];
    const paceById = Object.fromEntries(evaluatedPlayers.map(player => [player.sleeperId, fitContext?.paceOf(player) ?? null]));
    const weeklyPaceById = Object.fromEntries(evaluatedPlayers.map(player => [player.sleeperId, Object.fromEntries(Array.from({ length: LAST_REGULAR_WEEK - week + 1 }, (_, i) => [week + i, fitContext?.weeklyPaceOf(player, week + i) ?? null]))]));
    const { paceOf, weeklyPaceOf, projectionCovered, ...serialFit } = fitContext || {};
    await onDecisionInputs(JSON.parse(JSON.stringify({ version: 2, featureExtractionVersion: 2, lastCompletedWeek, capturedAt: new Date().toISOString(), leagueId, season, week, asOf, team, position, limitPerPosition,
      ownershipRechecked, transactionsComplete: transactionsByWeek.length === week,
      marketRows: rows, availabilityById: Object.fromEntries(market.map(player => [player.sleeperId, availabilityFor(player)])),
      fitContext: fitContext ? { ...serialFit, protectedIds: [...fitContext.protectedIds], reserveIds: [...fitContext.reserveIds], lockedIds: [...fitContext.lockedIds], starterIds: [...fitContext.starterIds], paceById, weeklyPaceById } : null,
      raw: { projectionCapture, projectionsByWeek, statsByWeek, fetchedAtByPath, schedule, rosters, catalog, nflState, users, playersIndex: Object.fromEntries(index), availabilityEvidenceById, roleEvidenceById, eventsById, allTransactions },
      playerIndexFetchedAt: playersIndexCaches.get(fetchImpl)?.at ? new Date(playersIndexCaches.get(fetchImpl).at).toISOString() : null
    })));
  }
  const transactionSummary = summarizeRecentTransactions(allTransactions, { asOf, playerMeta: meta, rosters,
    availabilityOf: playerId => { const player = meta(playerId); return player ? availabilityFor({ ...player, sleeperId: playerId }) : null; },
    rosterMeta: rosterId => {
      const roster = rosters.find(row => String(row.roster_id) === String(rosterId));
      const user = users.find(row => row.user_id === roster?.owner_id);
      return { teamName: user?.metadata?.team_name ?? user?.display_name ?? null, manager: user?.display_name ?? null };
    }, relevantIds: new Set([...(fitContext?.myPlayers.map(row => row.sleeperId) || rosteredIds), ...market.map(row => row.sleeperId)]) });
  return {
    rosterProvenance: (fitContext?.myPlayers || []).map(player => ({ playerId: player.sleeperId, provenance: player.provenance })),
    playerIndexProvenance: { source: `${SLEEPER_API}/players/nfl`, fetchedAt: playersIndexCaches.get(fetchImpl)?.at ? new Date(playersIndexCaches.get(fetchImpl).at).toISOString() : null, fallback: index.size ? null : "CATALOG_FALLBACK" },
    decisionScope: { leagueId, season, targetWeek: week, roster: team, asOf },
    season, leagueId, provenanceVersion: 1, evaluatedCandidateCount: market.length, returnedCandidateCount: Object.values(byPosition).flat().length,
    projectionComparison, acquisitionPlan, rosterPreferences: fitContext?.rosterPreferences ?? [], poolCoverage: boardCoverage, coherence,
    ...transactionSummary, availabilityAsOf: asOf, ownershipAsOf, transactionsFetchedAt, ownershipRechecked, snapshotSynchronized: false,
    transactionCoverage: `${transactionsByWeek.length}/${week}`,
    snapshotIssues,
    generatedAt: new Date().toISOString(), week, lastCompletedWeek, rankingModel: "WAIVER_V2", degraded, coverage,
    pricePerPoint: PRICE_PER_POINT, team: team || null, faabRemaining: fitContext?.faabRemaining ?? null, byPosition,
    faabHistory: faabHistory.slice(0, 30), faabByPosition: summarizeFaabByPosition(faabHistory), trending
  };
}

const formatDropCost = components => components ? ` · Coût de coupe : usage ${components.usagePremiumPerWeek} + buy-low ${components.buyLowPremiumPerWeek} + upside proj. ${components.projectionUpsidePerWeek} ; option ${components.optionTotal} sur ${components.horizonWeeks} sem ; perte après rôle ${components.postRoleLineupLossTotal ?? "n/d"}${components.missingInputs.length ? ` ; manquant ${components.missingInputs.join(",")}` : ""}` : "";
const formatEntry = player => {
  const entry = player.poolEntry;
  if (!entry) return "";
  const ripple = (player.ripple || []).map(row => `${row.triggerName || `#${row.triggerPlayerId}`} ${row.triggerStatus || row.type} (${row.group})`);
  const emerging = player.emergingRole;
  const profile = (player.roleProfile?.profile ? ` · Profil de rôle ${player.roleProfile.profile} (${player.roleProfile.basis.join(",")}, seuils non calibrés)` : "") +
    (emerging?.comparable ? ` · Tendance S${emerging.weeksCompared.join("/")} : snaps ${emerging.snapShareDelta ?? "n/d"}, cibles ${emerging.targetsDelta ?? "n/d"}, opportunités ${emerging.opportunitiesDelta ?? "n/d"}, xFP ${emerging.xfpDelta ?? "n/d"}, routes n/d → ${emerging.progression}${emerging.progressionSource ? ` (${emerging.progressionSource})` : ""}` : "") +
    (["NOT_JUSTIFIED", "UNPRICED", "JUSTIFIED"].includes(player.waiver?.fit?.progressionGuard) ? ` · Coupe d'une progression organique : ${player.waiver.fit.progressionGuard} (sacrifice ${player.waiver.fit.progressionSacrificeTotal ?? "n/d"} pts vs net ${player.waiver.fit.netGainTotal ?? "n/d"})` : "");
  return `${profile} · Entrée ${entry.reasons.join("+") || "n/d"}${entry.valuationCovered ? "" : " · projection absente : aucun gain chiffré"}` +
    (entry.recentDrop ? ` · coupé le ${entry.recentDrop.droppedAt}, déblocage non vérifié` : "") +
    (ripple.length ? ` · Ripple à réévaluer (aucune part attribuée) : ${ripple.join(" ; ")}` : "");
};
const formatNextUnlock = scenario => !scenario ? "" : scenario.status !== "EVALUATED"
  ? ` · Prochain déblocage : ${scenario.status}`
  : ` · Prochain déblocage (scénario, non exécutable) : S${scenario.startWeek}, ${scenario.unlockVerified ? `déblocage ${scenario.unlockAt}` : "déblocage non vérifié"}, horizon ${scenario.horizonWeeks} sem, net ${scenario.netGainTotal ?? "n/d"} pts, coupe ${scenario.dropCandidate?.name || "n/d"}, plafond indicatif ${scenario.indicativeMaxBid ?? "n/d"} $`;
export function formatPoolCoverage(pool) {
  const excluded = Object.entries(pool.excluded || {}).map(([reason, count]) => `${reason} ${count}`).join(", ");
  const reasons = Object.entries(pool.entryReasons || {}).map(([reason, count]) => `${reason} ${count}`).join(", ");
  return [`Pool (${pool.source}) : ${pool.considered} considérés, ${pool.included} évalués, ${pool.returned ?? "n/d"} affichés (limite ${pool.limitPerPosition ?? "n/d"}/poste), ${pool.unvalued} sans valorisation.`,
    `Motifs d'entrée : ${reasons || "n/d"} · Exclusions : ${excluded || "n/d"}.`,
    ...(pool.pinnedOnBoard?.length ? [`Maintenus au board (coupe récente / événement sourcé) : ${pool.pinnedOnBoard.map(row => `${row.name} [${row.reasons.join("+")}] ${row.availability}`).join(" ; ")}`] : []),
    ...(pool.rippleIssues?.length ? [`Événements non propagés : ${pool.rippleIssues.map(row => `${row.code} #${row.playerId}`).join(", ")}`] : [])];
}

/** Rend la liste de free agents en un bulletin texte, groupé par poste. */
export function formatWaiverReport({ byPosition, week, faabRemaining = null, degraded = false, coverage = null, recentTransactions = [], transactionsTruncatedCount = 0, availabilityAsOf = null, snapshotIssues = [], acquisitionPlan = null, rosterPreferences = [], poolCoverage = null, coherence = null }) {
  const lines = [`📋 WAIVER WIRE REPORT — ADINEU${week ? ` (Semaine ${week})` : ""}`];
  if (Number.isFinite(faabRemaining)) lines.push(`FAAB restant : ${faabRemaining} $ / ${GENERAL_SETTINGS_2026.waiver.budget} $`);
  if (degraded) lines.push(`Couverture dégradée : projections ${coverage?.projectionWeeks || "n/d"}, usage ${coverage?.statsWeeks || "n/d"}.`);

  lines.push(`Disponibilité au ${availabilityAsOf || "n/d"} · transactions 72 h : ${recentTransactions.length} (${transactionsTruncatedCount} non affichées).`, ...snapshotIssues);
  if (recentTransactions.length) lines.push(...formatRecentTransactions(recentTransactions));
  if (poolCoverage) lines.push(...formatPoolCoverage(poolCoverage));
  if (coherence) lines.push(...formatCoherenceWarnings(coherence));
  lines.push("Scénarios alternatifs : une même coupe ne peut pas financer deux acquisitions.");
  if (rosterPreferences.length) lines.push("Préférences temporaires :", JSON.stringify(rosterPreferences));
  if (acquisitionPlan) {
    lines.push(`Plan conditionnel : ${acquisitionPlan.steps.length} étape(s), ${acquisitionPlan.reservedFaab} $ réservés. Vérifier après chaque résultat ; suppose les succès précédents.`);
    lines.push(...formatClaimPortfolio(acquisitionPlan));
    for (const step of acquisitionPlan.steps) lines.push(`${step.name} · coupe ${step.dropCandidate?.name || "place libre"} · ${step.suggestedBid} $ · budget après ${step.budgetAfter} $ · gain marginal ${step.netGainTotal} pts`);
  }

  for (const pos of POSITION_ORDER) {
    const players = byPosition[pos] || [];
    if (players.length === 0) continue;
    lines.push("", pos);
    players.forEach((player, index) => {
      const rank = Number.isFinite(player.quality?.expertRank) ? ` · ECR #${player.quality.expertRank}` : "";
      const adp = Number.isFinite(player.market?.sleeperAdp) ? ` · ADP ${player.market.sleeperAdp}` : "";
      const note = player.adineu?.thesis ? ` — ${player.adineu.thesis}` : "";
      const waiver = player.waiver
        ? ` · ${player.waiver.category} · S${week} ${player.weekProjection ?? player.waiver.projectedPpg ?? "n/d"} · ROS ${player.waiver.rosPpg ?? "n/d"} · FAAB marché ${player.waiver.faabMarket?.join("–") || "n/d"} $` +
          (player.waiver.decision ? ` · Disponibilité ${player.availability?.availability || "UNKNOWN"} · Action ${player.waiver.decision.recommendedAction} · Classe ${player.waiver.decision.decisionClass} · Immédiat ${player.waiver.decision.immediateValue} · Stratégique ${player.waiver.decision.strategicUpside}` : "") +
          (Number.isFinite(player.waiver.usageScore) ? ` · Usage ${player.waiver.usageScore}${player.waiver.usageSignal ? ` ${player.waiver.usageSignal}` : ""}` : "") +
          (player.waiver.fit ? ` · Priorité ${player.waiver.fit.priorityScore} · Capture ${player.waiver.fit.fitScore}% · Delta S${week} ${player.waiver.fit.targetWeekDelta ?? "n/d"} · Gain brut ${player.waiver.fit.grossGainTotal ?? "n/d"} sur ${player.waiver.fit.horizonWeeks} sem · Gain net total ${player.waiver.fit.netGainTotal ?? "n/d"} · Gain net moyen ROS ${player.waiver.fit.netGainPerWeek ?? "n/d"} pts/sem · Coupe ${player.waiver.fit.dropCandidate?.name || "n/d"} (${player.waiver.fit.dropCostPerWeek ?? "n/d"} pts/sem) · Max ${player.waiver.fit.faabMaxForMe} $${player.waiver.fit.cutSelection ? ` · Sélection coupe ${player.waiver.fit.cutSelection}` : ""}${formatDropCost(player.waiver.fit.dropCostComponents)}` : "") +
          formatEntry(player) + formatNextUnlock(player.nextUnlockScenario) + (player.teRosterUtility ? ` · ${formatTeRosterUtility(player.teRosterUtility)}` : '') +
          ` · Enchère proposée ${player.waiver.suggestedBid ?? "n/d"} $ · % initial ${player.waiver.bidPctInitial ?? "n/d"} · % restant ${player.waiver.bidPctRemaining ?? "n/d"}` +
          (player.waiver.duration ? ` · Durée ${player.waiver.duration}` : "") +
          (player.waiver.newsOverride ? ` · ⚡ ${player.waiver.reasons.join(" ; ")}` : "")
        : "";
      lines.push(`${index + 1}. ${player.name} (${player.nflTeam || "FA"})${waiver}${rank}${adp}${note}`);
    });
  }

  if (!Object.values(byPosition).some(players => players.length)) lines.push("", "Aucun free agent disponible pour ce filtre.");

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--free-agents")) {
    const position = (args.find(arg => arg.startsWith("--position=")) || "").split("=")[1] || null;
    const limit = Number((args.find(arg => arg.startsWith("--limit=")) || "").split("=")[1]) || 10;
    const report = await getFreeAgents({ position, limitPerPosition: limit });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatWaiverReport(report));
    return;
  }

  const team = (args.find(arg => arg.startsWith("--team=")) || "--team=t0z").split("=")[1];
  const context = await getLeagueContext({ team });
  console.log(args.includes("--json") ? JSON.stringify(context, null, 2) : formatContextText(context));
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch(error => {
    console.error("Erreur d'exécution :", error.message);
    process.exitCode = 1;
  });
}
