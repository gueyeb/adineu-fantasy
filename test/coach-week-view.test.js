import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWeeklyRoster, renderWeeklyMoves } from '../public/assets/coach-week-view.js';
const player = (id,name) => ({sleeperId:id,name,position:'WR',weekProjection:10,rosPpg:9,usageScore:70});
test('suggested roster moves a bench player into the numbered WR slot and returns the cut to bench', () => {
  const old=player('old','Wicks'), stay=player('stay','Downs'), incoming=player('new','Puka');
  const plan={week:5,roster:{starters:[{slot:'WR',player:old},{slot:'WR',player:stay}],bench:[incoming],ir:[]},
    lineup:{optimal:{changes:[{slot:'WR1',in:incoming,out:old}]}}};
  const html=renderWeeklyRoster(plan,true);
  assert.match(html, /WR1<\/td><td><strong>Puka/);
  assert.equal((html.match(/<strong>Wicks/g)||[]).length,1);
  assert.match(html, /Banc[\s\S]*<strong>Wicks/);
});
test('unpriced ceilings stay unknown and unsafe names are escaped', () => {
  const html=renderWeeklyMoves({waiverActions:{CLAIM_IF_CHEAP:[{name:'<script>bad</script>',dropCandidate:{name:'RB',sleeperId:'r'},suggestedBid:null,maxForTeam:null,dropCostComponents:{unpricedCutPotential:true}}]}});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Claim · non déterminé/);
  assert.match(html, /Potentiel de la coupe non chiffré/);
});
test('missing projections distinguish a bye from source failure and absent player', () => {
  const html=renderWeeklyMoves({projectionDiagnostics:[{name:'P',week:7,cause:'PLAYER_MISSING'},{name:'Q',week:8,cause:'LOAD_FAILED'}]});
  assert.match(html,/joueur absent des projections publiées/);
  assert.match(html,/chargement de la source échoué/);
});

test('moves show fallback claims once and retain injury alerts', () => {
  const primary={playerId:'a',name:'A'}, fallback={playerId:'b',name:'B'};
  const html=renderWeeklyMoves({acquisitionPlan:{steps:[primary],claimPortfolio:{alternativeClaimGroups:[{claims:[primary,fallback]}]}},lineup:{alerts:[{slot:'RB',reason:'Questionable',advice:'Surveiller Love'}]}});
  assert.equal((html.match(/<strong>A<\/strong>/g)||[]).length,1);
  assert.match(html,/<strong>B<\/strong>/);
  assert.match(html,/choisir un seul ajout/);
  assert.match(html,/Surveiller Love/);
});
