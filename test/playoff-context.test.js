import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlayoffDecisionContext } from '../scripts/playoff-context.js';
const rosters=Array.from({length:12},(_,i)=>({roster_id:i+1,owner_id:`u${i}`,starters:Array.from({length:9},(_,j)=>`p${i}-${j}`)}));
const users=rosters.map((row,i)=>({user_id:row.owner_id,display_name:`Manager ${i}`,metadata:{team_name:`Team ${i}`}}));
const matchups=rosters.map((row,i)=>({...row,matchup_id:Math.floor(i/2),points:100+i,players_points:{}}));
const projections=rosters.flatMap((row,i)=>row.starters.map(id=>({player_id:id,stats:{pass_yd:200+i}})));
function fetchFixture({missingLineup=false,missingPair=false}={}) {return async url=>({ok:true,json:async()=>url.endsWith('/rosters') ? missingLineup ? rosters.map((row,i)=>i?row:{...row,starters:row.starters.slice(1)}) : rosters : url.endsWith('/users') ? users : url.includes('/matchups/') ? missingPair ? matchups.slice(1) : matchups : projections});}
test('server reuses existing Monte Carlo and exposes coverage, seed and assumptions',async()=>{
  const result=await getPlayoffDecisionContext({week:3,rosterId:1,leagueId:'fixture',fetchImpl:fetchFixture()});
  assert.equal(result.ready,true);
  assert.equal(result.model,'ADINEU_EXISTING_MONTE_CARLO');
  assert.ok(result.probability>=0 && result.probability<=1);
  assert.equal(result.coveragePct,100);
  assert.equal(result.seed,1);
  assert.equal(result.playoffSpots,8);
  assert.ok(result.assumptions.includes('CURRENT_LINEUPS_FROZEN'));
});
test('playoff context keeps activation and suppresses incomplete lineup or schedule',async()=>{
  assert.equal((await getPlayoffDecisionContext({week:2,rosterId:1,fetchImpl:()=>{throw Error('must not fetch');}})).ready,false);
  await assert.rejects(getPlayoffDecisionContext({week:3,rosterId:1,leagueId:'fixture',fetchImpl:fetchFixture({missingLineup:true})}),/lineup coverage/);
  await assert.rejects(getPlayoffDecisionContext({week:3,rosterId:1,leagueId:'fixture',fetchImpl:fetchFixture({missingPair:true})}),/schedule coverage/);
});
