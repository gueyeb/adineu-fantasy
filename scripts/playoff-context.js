import { readFile } from 'node:fs/promises';
import { buildSharedPlayoffContext } from '../public/assets/playoff-context.js';
import { simulatePlayoffProbabilities, NEAR_WEEKS, FAR_WEEK_SHRINK, DEFAULT_SIMULATIONS } from '../public/assets/playoff-probabilities.js';
import { GENERAL_SETTINGS_2026 } from '../public/assets/league-settings.js';
import { listRosterIdentities } from '../public/assets/roster-view.js';

/** Read-only bridge to the existing Monte Carlo engine and shared browser pipeline. */
export async function getPlayoffDecisionContext({ week, rosterId, leagueId = process.env.SLEEPER_LEAGUE_ID || '1392715510830878721', season='2026', fetchImpl=fetch }={}) {
  if (!Number.isInteger(week) || week<3 || week>GENERAL_SETTINGS_2026.regularSeasonWeeks) return {ready:false,reason:'ACTIVATION_GATE_OR_SEASON_ENDED'};
  const cache=new Map();
  const loadResource=path=>{
    if (!cache.has(path)) cache.set(path,(async()=>{
      const response=await fetchImpl(`https://api.sleeper.app/v1${path}`,{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('Playoff source unavailable');
      return response.json();
    })());
    return cache.get(path);
  };
  const loadProjections=async w=>{
    const response=await fetchImpl(`https://api.sleeper.app/projections/nfl/${season}/${w}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`,{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Playoff projections unavailable');
    return new Map((await response.json()).map(row=>[String(row.player_id),row.stats || null]));
  };
  const [rosters,users,batches,catalog]=await Promise.all([loadResource(`/league/${leagueId}/rosters`),loadResource(`/league/${leagueId}/users`),Promise.all(Array.from({length:week-1},(_,i)=>loadResource(`/league/${leagueId}/matchups/${i+1}`))),readFile(new URL('../public/data/players-catalog.json',import.meta.url),'utf8').then(JSON.parse)]);
  if (rosters.length !== GENERAL_SETTINGS_2026.teams) return {ready:false,reason:"INCOMPLETE_LEAGUE_ROSTERS"};
  const identities=listRosterIdentities(rosters,users);
  const managerById=new Map(identities.map(row=>[row.roster.roster_id,row.ownerName]));
  const rows=batches.flatMap((batch,i)=>batch.flatMap(entry=>{
    const opponent=batch.find(other=>other.matchup_id===entry.matchup_id && other.roster_id!==entry.roster_id);
    if (!opponent || !Number.isFinite(entry.points) || !Number.isFinite(opponent.points)) return [];
    return [{week:i+1,manager:managerById.get(entry.roster_id),team:identities.find(row=>row.roster.roster_id===entry.roster_id)?.teamName,points:entry.points,opponentPoints:opponent.points,isPlayoff:false}];
  }));
  const expectedManagers=identities.map(row=>row.ownerName);
  const context=await buildSharedPlayoffContext(week,rows,expectedManagers,{loadResource,loadProjections,loadPositions:async()=>new Map(catalog.players.map(player=>[String(player.sleeperId),player.position])),leagueId});
  const result=simulatePlayoffProbabilities(rows,{currentWeek:week,expectedManagers,playoffSpots:GENERAL_SETTINGS_2026.playoffTeams,...context,nearWeeks:NEAR_WEEKS,farWeekShrink:FAR_WEEK_SHRINK,simulations:DEFAULT_SIMULATIONS,seed:1,modelDate:new Date().toISOString()});
  const manager=managerById.get(rosterId);
  const team=result.probabilities.find(row=>row.manager===manager);
  return {ready:result.ready && Boolean(team),reason:result.reason,model:'ADINEU_EXISTING_MONTE_CARLO',probability:team?.probability ?? null,coveragePct:team?.coveragePct ?? null,modelDate:result.modelDate,
    simulations:result.simulations,seed:result.seed,playoffSpots:result.playoffSpots,teamStrengthSd:result.teamStrengthSd,nearWeeks:result.nearWeeks,farWeekShrink:result.farWeekShrink,
    assumptions:['CURRENT_LINEUPS_FROZEN','DIRECT_PROJECTION_THEN_SEASON_AVERAGE_THEN_POSITION_REPLACEMENT','WEEKLY_NOISE_AND_PERSISTENT_TEAM_STRENGTH','HISTORICAL_PROJECTIONS_RELOADED_NOT_CERTIFIED_PREGAME','NOT_OFFICIAL_SLEEPER_ODDS'],source:'PUBLIC_SLEEPER',identityMatched:Boolean(manager)};
}
