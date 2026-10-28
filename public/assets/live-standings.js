import { leaguePoints } from "./weekly-leaders.js?v=0a2bab24a3";
import { buildStarterSlotOrder } from "./roster-view.js?v=120de9d74d";
import { ROSTER_SETTINGS_2026 } from "./league-settings.js?v=886f353394";

const slots = buildStarterSlotOrder(ROSTER_SETTINGS_2026);
const round = n => Number(n.toFixed(2));
const numeric = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n)) ? Number(n) : null;
const teamCode = code => ({ WSH: "WAS", JAC: "JAX", LA: "LAR", LVR: "LV" })[code] || code;
export const matchupScore = row => numeric(row?.custom_points) ?? numeric(row?.points);

/** ESPN is a clock/status source only; fantasy points always come from Sleeper. */
export function parseNflLiveGames(body, { season, week, fetchedAt }) {
  if (Number(body?.season?.year) !== Number(season) || Number(body?.week?.number) !== Number(week) || Number(body?.season?.type) !== 2) {
    return { available: false, games: [], byes: [], fetchedAt, reason: "NFL_PERIOD_MISMATCH" };
  }
  const games = (body.events || []).filter(event => Number(event.season?.year) === Number(season) && Number(event.week?.number) === Number(week)).map(event => {
    const competition = event.competitions?.[0];
    const sides = competition?.competitors || [];
    const home = sides.find(side => side.homeAway === "home");
    const away = sides.find(side => side.homeAway === "away");
    const status = event.status || competition?.status || {};
    const state = status.type?.completed === true ? "FINAL" : status.type?.state === "pre" && status.type?.name === "STATUS_SCHEDULED" ? "PREGAME" : status.type?.state === "in" ? "LIVE" : "UNKNOWN";
    const period = numeric(status.period);
    const clock = numeric(status.clock);
    let remainingFraction = state === "FINAL" ? 0 : state === "PREGAME" ? 1 : null;
    if (state === "LIVE" && Number.isInteger(period) && period >= 1 && period <= 4 && clock !== null && clock >= 0 && clock <= 900) {
      const tiedAtEnd = period === 4 && clock === 0 && numeric(home?.score) === numeric(away?.score);
      if (!tiedAtEnd) remainingFraction = ((4 - period) * 900 + clock) / 3600;
    }
    return { id: event.id, home: teamCode(home?.team?.abbreviation), away: teamCode(away?.team?.abbreviation),
      homeScore: numeric(home?.score), awayScore: numeric(away?.score), state, period, clock: status.displayClock || null,
      remainingFraction, kickoffAt: event.date || competition?.date || null, label: status.type?.shortDetail || status.type?.description || state };
  }).filter(game => game.home && game.away);
  return { available: games.length > 0, games, byes: (body.week?.teamsOnBye || []).map(team => teamCode(team.abbreviation)), fetchedAt,
    source: "ESPN scoreboard", reason: games.length ? null : "NFL_GAMES_UNAVAILABLE" };
}

function pairRows(rows, ids) {
  if (!Array.isArray(rows) || rows.length !== ids.size || new Set(rows.map(row => String(row.roster_id))).size !== ids.size) return null;
  const groups = new Map();
  for (const row of rows) {
    if (!ids.has(String(row.roster_id)) || row.matchup_id === null || row.matchup_id === undefined || matchupScore(row) === null) return null;
    const key = String(row.matchup_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].every(pair => pair.length === 2) ? [...groups.values()] : null;
}

function ranked(rows) {
  const sorted = rows.map(row => ({ ...row, pointsFor: round(row.pointsFor) })).sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor || a.teamName.localeCompare(b.teamName, "fr") || a.rosterId - b.rosterId);
  return sorted.map((row, i) => ({ ...row, rank: i > 0 && row.wins === sorted[i - 1].wins && row.pointsFor === sorted[i - 1].pointsFor ? sorted.findIndex(other => other.wins === row.wins && other.pointsFor === row.pointsFor) + 1 : i + 1 }));
}

function addResult(a, b, scoreA, scoreB) {
  a.pointsFor += scoreA; b.pointsFor += scoreB;
  if (scoreA > scoreB) { a.wins++; b.losses++; }
  else if (scoreA < scoreB) { b.wins++; a.losses++; }
  else { a.ties++; b.ties++; }
}

function describeTeam(row, identity, { players, projections, scoring, nfl }) {
  const gameByTeam = new Map(nfl.games.flatMap(game => [[game.home, game], [game.away, game]]));
  const byes = new Set(nfl.byes);
  const gaps = [];
  const describe = (id, slot = null) => {
    if (!id || id === "0") return { playerId: null, slot, name: "Slot vide", position: null, actual: 0, projection: 0, estimate: 0, state: "EMPTY" };
    id = String(id);
    const meta = players.get?.(id) || players[id];
    const game = gameByTeam.get(meta?.nflTeam);
    const state = game?.state || (byes.has(meta?.nflTeam) ? "BYE" : "UNKNOWN");
    const actual = numeric(row.players_points?.[id]);
    const projection = projections[id] && scoring && Object.keys(scoring).some(key => key in projections[id]) ? leaguePoints(projections[id], scoring) : null;
    let remaining = state === "BYE" || state === "FINAL" ? 0 : game?.remainingFraction ?? null;
    if (["Out", "IR", "PUP", "NFI", "NA", "Sus"].includes(meta?.injuryStatus) && state === "PREGAME") remaining = 0;
    if (["BYE", "PREGAME"].includes(state) && actual !== null && actual !== 0) remaining = null;
    const remainingPoints = remaining === 0 ? 0 : remaining !== null && projection !== null ? projection * remaining : null;
    return { playerId: id, slot, name: meta?.name || `Joueur #${id}`, position: meta?.position || null, nflTeam: meta?.nflTeam || null,
      actual, projection, remainingPoints, estimate: remainingPoints !== null && (actual !== null || state === "PREGAME" || state === "BYE") ? round((actual ?? 0) + remainingPoints) : null,
      state, period: game?.period ?? null, clock: game?.clock ?? null };
  };
  const starters = slots.map((slot, i) => describe(row.starters?.[i], slot));
  if (!Array.isArray(row.starters) || row.starters.length !== slots.length || starters.some(player => player.state === "EMPTY")) gaps.push("LINEUP_INCOMPLETE");
  const starterIds = (row.starters || []).filter(id => id && id !== "0").map(String);
  if (new Set(starterIds).size !== starterIds.length) gaps.push("DUPLICATE_STARTER");
  for (const player of starters) if (player.playerId && player.remainingPoints === null) gaps.push(`LIVE_PROJECTION_UNAVAILABLE:${player.playerId}`);
  const started = starters.some(player => ["LIVE", "FINAL"].includes(player.state)) || matchupScore(row) !== 0;
  const finished = starters.every(player => ["FINAL", "BYE", "EMPTY"].includes(player.state));
  const score = matchupScore(row);
  const estimate = gaps.length || score === null ? null : round(score + starters.reduce((sum, player) => sum + player.remainingPoints, 0));
  return { ...identity, points: score, customScore: numeric(row.custom_points) !== null, starters, bench: (row.players || []).filter(id => !starterIds.includes(String(id))).map(id => describe(id)),
    started, finished, estimate, projectionGaps: gaps, pregameTotal: starters.every(player => player.projection !== null && player.playerId) ? round(starters.reduce((sum, player) => sum + player.projection, 0)) : null };
}

/** Descriptive standings only. Rebuild the baseline, never add a result to already-updated W/L. */
export function buildLiveStandings({ league, state, rosters = [], users = [], history = [], currentRows = [], players = new Map(), projections = {}, nfl = { games: [], byes: [] }, asOf }) {
  const week = Number(state?.week);
  const season = String(league?.season || "");
  const startWeek = Number(league?.settings?.start_week ?? 1);
  const lastWeek = Number(league?.settings?.playoff_week_start ?? 15) - 1;
  const userById = new Map(users.map(user => [user.user_id, user]));
  const identities = rosters.map(roster => {
    const user = userById.get(roster.owner_id);
    return { rosterId: Number(roster.roster_id), teamName: user?.metadata?.team_name || user?.display_name || `Roster ${roster.roster_id}`, manager: user?.display_name || null,
      account: user?.display_name || null, publicTeamName: user?.metadata?.team_name || null };
  });
  const ids = new Set(identities.map(team => String(team.rosterId)));
  const pairs = pairRows(currentRows, ids);
  const detailById = new Map(currentRows.map(row => {
    const identity = identities.find(team => team.rosterId === Number(row.roster_id));
    return [String(row.roster_id), describeTeam(row, identity || { rosterId: Number(row.roster_id), teamName: "Équipe inconnue" }, { players, projections, scoring: league?.scoring_settings, nfl })];
  }));
  const matchups = pairs?.map(pair => ({ matchupId: pair[0].matchup_id, teams: pair.map(row => detailById.get(String(row.roster_id))) })) || [];
  const base = { ready: false, week, season, asOf, baselineThroughWeek: week - 1, matchups, nfl, baseline: [], live: [], projected: [],
    projectionMethod: "ACTUAL_PLUS_PREGAME_REMAINING_CLOCK_V1", projectionNote: "Estimation Adineu : points acquis + projection avant-match × fraction du temps réglementaire restant. Rythme uniforme non calibré ; prolongations et couverture inconnue suspendent l’estimation.",
    standingsRule: "Victoires, puis points marqués cumulés ; égalités de rang conservées.", snapshotAtomic: false };
  if (!Number.isInteger(startWeek) || startWeek < 1 || !Number.isInteger(lastWeek) || !Number.isInteger(week) || week < startWeek || week > lastWeek || state?.season_type !== "regular" || String(state?.season) !== season) return { ...base, reason: "OUTSIDE_REGULAR_SEASON" };
  if (league?.settings?.league_average_match || Number(league?.settings?.divisions ?? 0) > 0 || Number(league?.settings?.playoff_seed_type ?? 0) !== 0) return { ...base, reason: "UNSUPPORTED_STANDINGS_RULE" };
  if (identities.length !== Number(league?.total_rosters) || ids.size !== identities.length || !pairs) return { ...base, reason: "INCOMPLETE_MATCHUPS" };
  const tallies = new Map(identities.map(team => [String(team.rosterId), { ...team, wins: 0, losses: 0, ties: 0, pointsFor: 0 }]));
  for (let w = startWeek; w < week; w++) {
    const rows = history.find(entry => entry.week === w)?.rows;
    const completedPairs = pairRows(rows, ids);
    if (!completedPairs) return { ...base, reason: "INCOMPLETE_HISTORY", missingWeek: w };
    for (const [a, b] of completedPairs) addResult(tallies.get(String(a.roster_id)), tallies.get(String(b.roster_id)), matchupScore(a), matchupScore(b));
  }
  const baseline = ranked([...tallies.values()]);
  const baselineRanks = new Map(baseline.map(team => [team.rosterId, team.rank]));
  const scenario = projected => {
    const rows = new Map([...tallies].map(([id, row]) => [id, { ...row }]));
    for (const [a, b] of pairs) {
      const left = detailById.get(String(a.roster_id)); const right = detailById.get(String(b.roster_id));
      if (!projected && !left.started && !right.started) continue;
      addResult(rows.get(String(a.roster_id)), rows.get(String(b.roster_id)), projected ? left.estimate : left.points, projected ? right.estimate : right.points);
    }
    return ranked([...rows.values()]).map(team => ({ ...team, baselineRank: baselineRanks.get(team.rosterId), rankChange: baselineRanks.get(team.rosterId) - team.rank,
      weekPoints: projected ? detailById.get(String(team.rosterId)).estimate : detailById.get(String(team.rosterId)).points }));
  };
  const projectionComplete = [...detailById.values()].every(team => team.estimate !== null);
  return { ...base, ready: true, reason: "READY", baseline, live: scenario(false), projected: projectionComplete ? scenario(true) : [],
    projectionComplete, projectionMissingTeams: [...detailById.values()].filter(team => team.estimate === null).map(team => team.rosterId),
    completed: [...detailById.values()].every(team => team.finished), started: [...detailById.values()].some(team => team.started) };
}
