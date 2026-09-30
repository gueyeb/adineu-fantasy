#!/usr/bin/env node
/**
 * Adineu Fantasy — Contexte IA & Waiver Wire Report
 *
 * Usage :
 *   node scripts/league-context.js --team=t0z
 *   node scripts/league-context.js --free-agents
 *   node scripts/league-context.js --free-agents --position=RB
 */

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
import { usageAdjustedRosPpg } from "../public/assets/rest-of-season.js";
import { calculateFaabRemaining } from "../public/assets/team-metrics.js";
import { restOfSeasonEstimate } from "../public/assets/trade-score.js";
import { estimateBaselineProjectedPpg } from "../public/assets/trade-value.js";
import {
  FANTASY_POSITIONS,
  LAST_REGULAR_WEEK,
  PRICE_PER_POINT,
  buildOpportunitySignals,
  computeRosPpg,
  detectEvents,
  effectivePpg,
  evaluateMarket,
  evaluateRosterFit
} from "../public/assets/waiver-model.js";

export const DEFAULT_SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1392715510830878721";
const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_CATALOG_URL = new URL("../public/data/players-catalog.json", import.meta.url);
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
const STARTER_SLOT_ORDER = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
const INJURY_STATUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // le dump Sleeper /players/nfl pèse ~15 Mo, on ne le refetch pas à chaque requête

// Statuts Sleeper connus : Questionable, Doubtful, Out, IR, PUP, Sus, NA.
export const SEVERITY_BY_STATUS = {
  Questionable: "WATCH",
  Doubtful: "ALERT",
  Out: "ALERT",
  IR: "ALERT",
  PUP: "ALERT",
  Sus: "ALERT",
  NA: "ALERT"
};

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
  const [rosters, users, matchupRows, projections] = await Promise.all([
    sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/users`, { fetchImpl }),
    sleeperGet(`/league/${leagueId}/matchups/${week}`, { fetchImpl }),
    getWeeklyProjections({ week, fetchImpl }).catch(() => ({}))
  ]);
  const mine = findRosterByTeam(rosters, users, team);
  const myRow = matchupRows.find(row => row.roster_id === mine.roster.roster_id);
  if (!myRow || myRow.matchup_id === null || myRow.matchup_id === undefined) return null;
  const opponentRow = matchupRows.find(row => row.matchup_id === myRow.matchup_id && row.roster_id !== myRow.roster_id);
  if (!opponentRow) return null;
  const opponent = listRosterIdentities(rosters, users).find(entry => entry.roster.roster_id === opponentRow.roster_id);
  if (!opponent) return null;
  const projected = roster => {
    const starterIds = (roster.starters || []).filter(id => id && id !== "0");
    const values = starterIds.map(id => projections[id]?.pts_ppr).filter(Number.isFinite);
    return {
      total: values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(1)) : null,
      coverage: `${values.length}/${starterIds.length}`
    };
  };
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
    myProjection: projected(mine.roster),
    opponentProjection: projected(opponent.roster),
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
    .map(cells => ({ week: Number(cells[at("week")]), away_team: team(cells[at("away_team")]), home_team: team(cells[at("home_team")]) }));
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
  forceRefreshInjuryStatuses = false
} = {}) {
  const { catalog } = await loadPlayerCatalog(catalogUrl);
  const catalogById = new Map((catalog.players || []).map(player => [player.sleeperId, player]));
  const rosters = await sleeperGet(`/league/${leagueId}/rosters`, { fetchImpl });
  const rosteredIds = new Set(rosters.flatMap(roster => roster.players || []));

  let week = 1;
  let nflState = {};
  try {
    nflState = await sleeperGet("/state/nfl", { fetchImpl });
    week = resolveOperationalWeek(nflState);
  } catch {}
  const season = nflState?.season || "2026";
  const lastCompletedWeek = resolveLastCompletedWeek(nflState);

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

  const seasonStart = Date.parse(nflState?.season_start_date || "2026-09-09");
  const teamOf = (id, playedWeek) => {
    const player = index.get(id);
    const weekEnd = seasonStart + playedWeek * 7 * 24 * 3600 * 1000;
    if (!player?.nflTeam || (Number.isFinite(player.teamChangedAt) && player.teamChangedAt > weekEnd && player.teamChangedAt > seasonStart)) return null;
    return player.nflTeam;
  };
  const usageRows = buildPlayerWeeks(statsByWeek, { teamOf, positionOf: id => index.get(id)?.position });
  const usageById = new Map(calculateUsageScores(usageRows).players.map(player => [player.playerId, player]));

  const meta = id => index.get(id) || (catalogById.has(id) ? { id, name: catalogById.get(id).name, position: catalogById.get(id).position, nflTeam: catalogById.get(id).nflTeam, active: true } : null);
  const rosDetailFor = (id, player) => usageAdjustedRosPpg({
    playerId: id,
    position: player?.position,
    nflTeam: player?.nflTeam,
    projectionsByWeek,
    week,
    xfp: usageById.get(id)?.xfp
  });
  const rosFor = (id, player) => rosDetailFor(id, player)?.ppg ?? computeRosPpg({ playerId: id, nflTeam: player?.nflTeam, projectionsByWeek, week });

  // Pool : index Sleeper complet (ou catalogue en repli), postes fantasy, équipe NFL active.
  // Le catalogue pré-draft ne sert de pool que si l'index Sleeper est indisponible.
  const candidateIds = new Set(index.size ? index.keys() : catalogById.keys());
  const byTeamPosition = new Map();
  for (const id of candidateIds) {
    const player = meta(id);
    if (!player?.nflTeam || !FANTASY_POSITIONS.includes(player.position)) continue;
    const key = `${player.nflTeam}:${player.position}`;
    if (!byTeamPosition.has(key)) byTeamPosition.set(key, []);
    byTeamPosition.get(key).push({ ...player, id, rosPpg: rosFor(id, player) });
  }

  const rows = [];
  for (const id of candidateIds) {
    if (rosteredIds.has(id)) continue;
    const player = meta(id);
    if (!player?.active || !player.nflTeam || !FANTASY_POSITIONS.includes(player.position)) continue;
    // Jamais recommandé s'il ne peut pas jouer (IR/Out/Doubtful/PUP/Sus/NA), même sévérité que le Start/Sit.
    if (SEVERITY_BY_STATUS[player.injuryStatus] === "ALERT") continue;
    const catalogEntry = catalogById.get(id) || {};
    // Repli étiqueté : sans couverture de projections futures, estimation par rang (ECR catalogue).
    const rosDetail = rosDetailFor(id, player);
    const projectedRos = rosDetail?.ppg ?? computeRosPpg({ playerId: id, nflTeam: player?.nflTeam, projectionsByWeek, week });
    const rankFallback = projectedRos === null && Number.isFinite(catalogEntry.quality?.expertRank ?? catalogEntry.market?.sleeperAdp)
      ? estimateBaselineProjectedPpg({ ...catalogEntry, projectedPpg: undefined, projection: undefined }) : null;
    const rosPpg = projectedRos ?? rankFallback;
    const signals = buildOpportunitySignals(id, statsByWeek);
    const weekProjection = projectionsByWeek[week]?.[id]?.pts_ppr ?? null;
    if (rosPpg === null && !signals.gamesPlayed) continue;
    const teammates = byTeamPosition.get(`${player.nflTeam}:${player.position}`) || [];
    const events = detectEvents({ player: { ...player, id, rosPpg }, teammates, signals });
    // Last game counts as role evidence only if he actually had the role (≥ 60 % of the snaps).
    const lastRolePoints = signals.last?.snapShare >= 0.6 ? signals.last.points : null;
    const pace = effectivePpg({ rosPpg, weekProjection, recentPpg: signals.recentPpg, lastRolePoints, duration: events.duration, share: events.share, week });
    rows.push({
      ...catalogEntry,
      sleeperId: id,
      name: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      injuryStatus: player.injuryStatus,
      rosPpg,
      rosSource: projectedRos !== null ? (rosDetail?.source || "SLEEPER_PROJECTIONS") : rankFallback !== null ? "RANK_ESTIMATE" : "NONE",
      usageScore: usageById.get(id)?.usageScore ?? null,
      usageSignal: usageById.get(id)?.signal ?? null,
      xfp: usageById.get(id)?.xfp ?? null,
      weekProjection: Number.isFinite(weekProjection) ? Number(weekProjection.toFixed(1)) : null,
      effectivePpg: pace.effective,
      signals,
      events: { ...events, rolePpg: pace.rolePpg, roleWeeks: pace.roleWeeks }
    });
  }

  const market = evaluateMarket({ rows, week });
  let users = [];
  try { users = await sleeperGet(`/league/${leagueId}/users`, { fetchImpl }); } catch {}
  let fitContext = null;
  if (team) {
    const { roster } = findRosterByTeam(rosters, users, team);
    const myPlayers = (roster.players || []).map(id => {
      const player = meta(id) || { name: `Player #${id}`, position: "FLEX" };
      const usage = usageById.get(id);
      return {
        ...(catalogById.get(id) || {}), ...player, sleeperId: id,
        projectedPpg: projectionsByWeek[week]?.[id]?.pts_ppr,
        injuryStatus: player.injuryStatus,
        usageScore: usage?.usageScore ?? null,
        usageSignal: usage?.signal ?? null,
        xfp: usage?.xfp ?? null
      };
    });
    const fallback = restOfSeasonEstimate(week);
    const paceOf = player => player.effectivePpg ?? rosFor(player.sleeperId, player) ?? fallback(player);
    const replacementByPosition = Object.fromEntries(FANTASY_POSITIONS.map(pos => [pos, market.find(row => row.position === pos)?.replacementPpg ?? 0]));
    const protectedIds = new Set([...(roster.starters || []), ...(roster.reserve || [])].filter(id => id && id !== "0").map(String));
    fitContext = { myPlayers, paceOf, protectedIds, replacementByPosition, faabRemaining: calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget, roster.settings?.waiver_budget_used) };
  }

  const withWaiver = row => {
    const fit = fitContext ? evaluateRosterFit({ marketRow: row, week, ...fitContext }) : null;
    const positionWeight = ({ RB: 1.2, WR: 1.15, TE: 1, QB: 0.65, K: 0.45, DEF: 0.5 })[row.position] || 1;
    const durationWeight = ({ SEASON_LONG: 1.2, BREAKOUT: 1.15, SHORT_2_4W: 0.9, RENTAL_1W: 0.65, UNCERTAIN: 0.75 })[row.events.duration] || 0.85;
    const priorityScore = fit ? Math.round(Math.max(0, Math.min(100,
      18 * Math.max(0, fit.netGainPerWeek) * positionWeight +
      0.35 * row.marketScore * durationWeight * positionWeight
    ))) : null;
    return {
      ...row,
      waiver: {
        score: row.marketScore,
        category: row.category,
        projectedPpg: row.weekProjection ?? row.rosPpg,
        rosPpg: row.rosPpg,
        rosSource: row.rosSource,
        recentPpg: row.signals.recentPpg,
        faabPct: row.faabPct,
        faabMarket: row.faabMarket,
        newsOverride: row.events.newsOverride,
        flags: row.events.flags,
        reasons: row.events.reasons,
        duration: row.events.duration,
        snapShare: row.signals.last?.snapShare ?? null,
        opportunities: row.signals.last?.opportunities ?? null,
        usageScore: row.usageScore,
        usageSignal: row.usageSignal,
        xfp: row.xfp,
        ...(fit ? { fit: { ...fit, priorityScore } } : {})
      }
    };
  };

  const normalizedPosition = position ? String(position).toUpperCase() : null;
  const byPosition = {};
  for (const row of market) {
    if (normalizedPosition && row.position !== normalizedPosition) continue;
    if (!byPosition[row.position]) byPosition[row.position] = [];
    if (byPosition[row.position].length >= limitPerPosition) continue;
    byPosition[row.position].push(withWaiver(row));
  }

  // Signaux de marché de la ligue (benchmark Fantasy Life, lot 1) : enchères gagnées + trending Sleeper.
  const rosterNameById = new Map(listRosterIdentities(rosters, users).map(({ roster, teamName }) => [String(roster.roster_id), teamName]));
  const rosterOfPlayer = new Map(rosters.flatMap(roster => (roster.players || []).map(id => [id, rosterNameById.get(String(roster.roster_id)) || null])));
  const transactionsByWeek = [];
  for (let w = 1; w <= week; w++) {
    try { transactionsByWeek.push({ week: w, transactions: await cachedWeekly(`/league/${leagueId}/transactions/${w}`, fetchImpl) }); } catch {}
  }
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

  return {
    generatedAt: new Date().toISOString(), week, lastCompletedWeek, rankingModel: "WAIVER_V2", degraded, coverage,
    pricePerPoint: PRICE_PER_POINT, team: team || null, faabRemaining: fitContext?.faabRemaining ?? null, byPosition,
    faabHistory: faabHistory.slice(0, 30), faabByPosition: summarizeFaabByPosition(faabHistory), trending
  };
}

/** Rend la liste de free agents en un bulletin texte, groupé par poste. */
export function formatWaiverReport({ byPosition, week, faabRemaining = null, degraded = false, coverage = null }) {
  const lines = [`📋 WAIVER WIRE REPORT — ADINEU${week ? ` (Semaine ${week})` : ""}`];
  if (Number.isFinite(faabRemaining)) lines.push(`FAAB restant : ${faabRemaining} $ / ${GENERAL_SETTINGS_2026.waiver.budget} $`);
  if (degraded) lines.push(`Couverture dégradée : projections ${coverage?.projectionWeeks || "n/d"}, usage ${coverage?.statsWeeks || "n/d"}.`);

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
          (Number.isFinite(player.waiver.usageScore) ? ` · Usage ${player.waiver.usageScore}${player.waiver.usageSignal ? ` ${player.waiver.usageSignal}` : ""}` : "") +
          (player.waiver.fit ? ` · Priorité ${player.waiver.fit.priorityScore} · Capture ${player.waiver.fit.fitScore}% · Gain net ${player.waiver.fit.netGainPerWeek} pts/sem · Coupe ${player.waiver.fit.dropCandidate?.name || "n/d"} (${player.waiver.fit.dropCostPerWeek} pts/sem) · Max ${player.waiver.fit.faabMaxForMe} $` : "") +
          (player.waiver.duration ? ` · Durée ${player.waiver.duration}` : "") +
          (player.waiver.newsOverride ? ` · ⚡ ${player.waiver.reasons.join(" ; ")}` : "")
        : "";
      lines.push(`${index + 1}. ${player.name} (${player.nflTeam || "FA"})${waiver}${rank}${adp}${note}`);
    });
  }

  if (lines.length === 1) lines.push("", "Aucun free agent disponible pour ce filtre.");

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
