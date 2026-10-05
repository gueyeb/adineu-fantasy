import { ROSTER_SETTINGS_2026, GENERAL_SETTINGS_2026 } from './league-settings.js?v=f6d1bf5212';
import { listRosterIdentities } from './roster-view.js?v=120de9d74d';
import { projectPlayerFantasyPoints, resolvePlayerProjection, sumTeamProjection, estimateTeamStrengthSd } from './playoff-probabilities.js?v=04b4081b79';

/** Same source preparation for browser and server; no second playoff model. */
export async function buildSharedPlayoffContext(currentWeek, matchupRows = [], expectedManagers = [], { loadResource, loadProjections, loadPositions, leagueId }) {

  const regularSeasonWeeks = GENERAL_SETTINGS_2026.regularSeasonWeeks;
  if (!Number.isFinite(currentWeek) || currentWeek > regularSeasonWeeks) return null;

  const remainingWeeks = [];
  for (let week = currentWeek; week <= regularSeasonWeeks; week += 1) remainingWeeks.push(week);
  const completedWeeks = [];
  for (let week = 1; week < currentWeek; week += 1) completedWeeks.push(week);

  const [rosters, users, positionById, remainingData, completedData] = await Promise.all([
    loadResource(`/league/${leagueId}/rosters`),
    loadResource(`/league/${leagueId}/users`),
    loadPositions(),
    Promise.all(remainingWeeks.map(async week => {
      const [matchups, projections] = await Promise.all([
        loadResource(`/league/${leagueId}/matchups/${week}`),
        loadProjections(week)
      ]);
      return { week, matchups, projections };
    })),
    Promise.all(completedWeeks.map(async week => {
      const [matchups, projections] = await Promise.all([
        loadResource(`/league/${leagueId}/matchups/${week}`),
        loadProjections(week)
      ]);
      return { week, matchups, projections };
    }))
  ]);

  const identities = listRosterIdentities(rosters, users);
  const requiredStarters = Object.values(ROSTER_SETTINGS_2026.starters).reduce((sum,count)=>sum+count,0);
  if (identities.some(entry => (entry.roster.starters || []).filter(id=>id && id !== "0").length !== requiredStarters)) throw new Error("Incomplete playoff lineup coverage");
  // Standings/matchup rows name managers by their canonical Supabase owner ("tOz", "MouhammadAT",
  // "Birama"), not their Sleeper display name ("t0z", "Shiro00", "bmb22"). The public link between
  // both is the team name, synced from Sleeper into Supabase. A mismatch here silently removed
  // those teams from every simulated game (0 % / 100 % odds), so an unmatched team now aborts.
  const managerByTeamName = new Map(matchupRows.filter(row => row.team && row.manager).map(row => [row.team, row.manager]));
  const expected = new Set(expectedManagers);
  const managerByRosterId = new Map(identities.map(entry => {
    const manager = managerByTeamName.get(entry.teamName) ?? (expected.has(entry.ownerName) ? entry.ownerName : null);
    if (!manager) throw new Error(`Équipe Sleeper non rattachée au classement : ${entry.teamName}`);
    return [entry.roster.roster_id, manager];
  }));
  const startersByRosterId = new Map(identities.map(entry =>
    [entry.roster.roster_id, (entry.roster.starters || []).filter(id => id && id !== "0")]));

  // Remaining schedule: Sleeper already assigns matchup_id pairings for future weeks (verified
  // live — see the mini-PRD), so this is read directly rather than simulated or guessed.
  const schedule = new Map();
  for (const { week, matchups } of remainingData) {
    const byMatchupId = new Map();
    for (const entry of matchups) {
      if (!byMatchupId.has(entry.matchup_id)) byMatchupId.set(entry.matchup_id, []);
      byMatchupId.get(entry.matchup_id).push(entry.roster_id);
    }
    const pairs = [];
    for (const rosterIds of byMatchupId.values()) {
      if (rosterIds.length !== 2) continue; // safety: only clean 1v1 pairings
      const [managerA, managerB] = rosterIds.map(id => managerByRosterId.get(id));
      if (managerA && managerB) pairs.push([managerA, managerB]);
    }
    if (pairs.length * 2 !== expectedManagers.length || new Set(pairs.flat()).size !== expectedManagers.length) throw new Error("Incomplete playoff schedule coverage");
    schedule.set(week, pairs);
  }

  // Fallback source (b): each player's own season-average actual score, from Sleeper's raw
  // per-player weekly points already returned alongside every played week's matchups.
  const playerPointTotals = new Map();
  for (const { matchups } of completedData) {
    for (const roster of matchups) {
      for (const [playerId, points] of Object.entries(roster.players_points || {})) {
        if (!playerPointTotals.has(playerId)) playerPointTotals.set(playerId, { sum: 0, count: 0 });
        const entry = playerPointTotals.get(playerId);
        entry.sum += Number(points) || 0;
        entry.count += 1;
      }
    }
  }
  const seasonAverageByPlayerId = new Map();
  for (const [playerId, { sum, count }] of playerPointTotals) {
    seasonAverageByPlayerId.set(playerId, count > 0 ? sum / count : null);
  }

  // Projection error that persists at team level. Historical matchup payloads preserve the
  // lineup that was actually started, so calibration never applies today's roster backwards.
  const residualsByManager = new Map();
  for (const { matchups, projections } of completedData) {
    for (const roster of matchups) {
      const manager = managerByRosterId.get(roster.roster_id);
      if (!manager || !Number.isFinite(roster.points)) continue;
      const starters = (roster.starters || []).filter(id => id && id !== "0");
      const projected = starters.reduce((sum, playerId) => {
        const stats = projections.get(String(playerId));
        return sum + (stats ? projectPlayerFantasyPoints(stats) : 0);
      }, 0);
      if (!(projected > 0)) continue;
      if (!residualsByManager.has(manager)) residualsByManager.set(manager, []);
      residualsByManager.get(manager).push(Number(roster.points) - projected);
    }
  }

  // Fallback source (c): mean Adineu-scored projection across every directly-projected player at
  // that position that week — a reasonably deep pool (Sleeper projects hundreds per position,
  // well past startable depth), used only when neither (a) nor (b) has anything for this player.
  const replacementByWeekPosition = new Map();
  for (const { week, projections } of remainingData) {
    const sums = new Map();
    for (const [playerId, stats] of projections) {
      if (!stats) continue;
      const position = positionById.get(playerId);
      if (!position) continue;
      const points = projectPlayerFantasyPoints(stats);
      if (!sums.has(position)) sums.set(position, { sum: 0, count: 0 });
      const entry = sums.get(position);
      entry.sum += points;
      entry.count += 1;
    }
    for (const [position, { sum, count }] of sums) {
      replacementByWeekPosition.set(`${week}|${position}`, count > 0 ? sum / count : 0);
    }
  }

  const teamProjectionsByWeek = new Map();
  for (const { week, projections } of remainingData) {
    for (const [rosterId, starters] of startersByRosterId) {
      const manager = managerByRosterId.get(rosterId);
      if (!manager) continue;
      const resolutions = starters.map(playerId => {
        const stats = projections.get(playerId);
        const position = positionById.get(playerId);
        return resolvePlayerProjection({
          directPoints: stats ? projectPlayerFantasyPoints(stats) : undefined,
          seasonAveragePoints: seasonAverageByPlayerId.get(playerId) ?? undefined,
          replacementPoints: replacementByWeekPosition.get(`${week}|${position}`)
        });
      });
      teamProjectionsByWeek.set(`${week}|${manager}`, sumTeamProjection(resolutions));
    }
  }

  return {
    remainingWeeks,
    schedule,
    teamProjectionsByWeek,
    teamStrengthSd: estimateTeamStrengthSd(residualsByManager)
  };
}
