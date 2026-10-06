import { extractDecisionFeatures } from './decision-features.js';
import { resolveAcquisitionAvailability, findRecentDrops, nextWeekHorizon } from '../public/assets/acquisition-availability.js';
import { BYE_WEEKS_2026 } from '../public/assets/league-settings.js';
import { restOfSeasonEstimate } from '../public/assets/trade-score.js';
import { evaluateMarket } from '../public/assets/waiver-model.js';
import { GENERAL_SETTINGS_2026, ROSTER_SETTINGS_2026 } from '../public/assets/league-settings.js';
import { calculateFaabRemaining } from '../public/assets/team-metrics.js';
import { findRosterByTeam } from '../public/assets/roster-view.js';
import { normalizeRosterPreferences } from '../public/assets/roster-preferences.js';
import { buildStarterSlotOrder } from '../public/assets/roster-view.js';
import { buildAcquisitionPlan } from '../public/assets/waiver-plan.js';
import { createWaiverEvaluator } from './waiver-evaluator.js';

/** Recalculate market, roster fit, actions and conditional plan from captured model inputs.
 * Version 2 reconstructs event, usage/xFP and ROS features from source inputs. No live fetch allowed. */
export function recomputeDecisionInputs(inputs) {
  if (![1,2].includes(inputs?.version) || !Number.isInteger(inputs.week) || !Array.isArray(inputs.marketRows)) throw Error('Invalid calculation inputs');
  let marketRows = inputs.marketRows;
  let sourceFeatures = null;
  let availabilityById = inputs.availabilityById;
  const recentDrops = findRecentDrops(inputs.raw?.allTransactions || [], { asOf:inputs.asOf });
  if (inputs.version === 2) {
    const raw = inputs.raw;
    if (![1,2].includes(inputs.featureExtractionVersion) || !Array.isArray(raw?.schedule) || !Array.isArray(raw?.allTransactions) || !raw?.playersIndex || !raw.catalog || !raw.projectionsByWeek || !raw.statsByWeek || !raw.rosters || !raw.roleEvidenceById || !raw.availabilityEvidenceById) throw Error('Raw feature inputs required');
    sourceFeatures = extractDecisionFeatures({ ...inputs, ...raw, index:new Map(Object.entries(raw.playersIndex)) });
    marketRows = sourceFeatures.rows;
    availabilityById = Object.fromEntries(marketRows.map(player => {
      const game = raw.schedule.find(game => game.week === inputs.week && [game.away_team, game.home_team].includes(player.nflTeam));
      const latestTransactionAt = Math.max(0,...raw.allTransactions.filter(t=>t.status === 'complete' && (Object.hasOwn(t.adds || {},player.sleeperId) || Object.hasOwn(t.drops || {},player.sleeperId))).map(t=>Number(t.status_updated ?? t.created) || 0));
      return [player.sleeperId,resolveAcquisitionAvailability({ playerId:player.sleeperId, rosters:raw.rosters, evidence:raw.availabilityEvidenceById[player.sleeperId],kickoffAt:game?.kickoffAt,kickoffSource:game?.source,asOf:inputs.asOf,week:inputs.week,season:inputs.season,leagueId:inputs.leagueId,latestTransactionAt,recentDrop:recentDrops.get(String(player.sleeperId)) ?? null })];
    }));
  }
  const market = evaluateMarket({ rows:marketRows, week:inputs.week, budget:GENERAL_SETTINGS_2026.waiver.budget });
  let fitContext = null;
  if (inputs.fitContext) {
    let fit = inputs.fitContext;
    if (sourceFeatures) {
      const { roster } = findRosterByTeam(inputs.raw.rosters, inputs.raw.users, inputs.team);
      const myPlayers = (roster.players || []).map(sourceFeatures.rosterPlayerFor);
      const fallback = restOfSeasonEstimate(inputs.week);
      const players = [...marketRows,...myPlayers];
      const paceById = Object.fromEntries(players.map(player=>[player.sleeperId,player.effectivePpg ?? sourceFeatures.rosFor(player.sleeperId,player) ?? fallback(player)]));
      const weeklyPaceById = Object.fromEntries(players.map(player=>[player.sleeperId,Object.fromEntries(Object.keys(inputs.raw.projectionsByWeek).map(w=>[w,BYE_WEEKS_2026[player.nflTeam] === Number(w) || ['Out','Doubtful','IR','PUP','Sus','NA'].includes(player.injuryStatus) && Number(w) === inputs.week ? 0 : inputs.raw.projectionsByWeek[w]?.[player.sleeperId]?.pts_ppr ?? null]))]));
      const protectedIds = (roster.reserve || []).filter(id=>id && id !== '0').map(String);
      const lockedIds = myPlayers.filter(player=>{
        if (BYE_WEEKS_2026[player.nflTeam] === inputs.week) return false;
        const game=inputs.raw.schedule.find(game=>game.week === inputs.week && [game.away_team,game.home_team].includes(player.nflTeam));
        const latestTransactionAt=Math.max(0,...inputs.raw.allTransactions.filter(t=>t.status === 'complete' && (Object.hasOwn(t.adds || {},player.sleeperId) || Object.hasOwn(t.drops || {},player.sleeperId))).map(t=>Number(t.status_updated ?? t.created) || 0));
        const resolved=resolveAcquisitionAvailability({playerId:player.sleeperId,rosters:inputs.raw.rosters,evidence:inputs.raw.availabilityEvidenceById[player.sleeperId],kickoffAt:game?.kickoffAt,asOf:inputs.asOf,week:inputs.week,season:inputs.season,leagueId:inputs.leagueId,latestTransactionAt});
        return !resolved.kickoffAt || Date.parse(resolved.kickoffAt) <= Date.parse(inputs.asOf);
      }).map(player=>String(player.sleeperId));
      const slots=buildStarterSlotOrder(ROSTER_SETTINGS_2026);
      const occurrences={};
      const frozenSlots=Object.fromEntries((roster.starters || []).map((id,i)=>{
        const position=slots[i];
        occurrences[position]=(occurrences[position] || 0)+1;
        const slot=ROSTER_SETTINGS_2026.starters[position] > 1 ? `${position}${occurrences[position]}` : position;
        return [slot,id];
      }).filter(([slot,id])=>slot && lockedIds.includes(String(id))));
      const rosterPreferences=normalizeRosterPreferences(fit.rosterPreferences,{asOf:inputs.asOf,rosterId:roster.roster_id}).filter(row=>(roster.players || []).includes(row.playerId));
      fit = { ...fit, myPlayers, paceById, weeklyPaceById, protectedIds, reserveIds:protectedIds, lockedIds, starterIds:(roster.starters || []).map(String), frozenSlots, rosterPreferences,
        faabRemaining:calculateFaabRemaining(GENERAL_SETTINGS_2026.waiver.budget,roster.settings?.waiver_budget_used),
        hasOpenRosterSlot:myPlayers.filter(player=>!protectedIds.includes(String(player.sleeperId))).length < slots.length + ROSTER_SETTINGS_2026.benchSlots,
        replacementByPosition:Object.fromEntries(['QB','RB','WR','TE','K','DEF'].map(position=>[position,market.find(row=>row.position === position)?.replacementPpg ?? 0])) };

    }
    const paceOf = player => fit.paceById[player.sleeperId] ?? null;
    const weeklyPaceOf = (player, week) => fit.weeklyPaceById[player.sleeperId]?.[week] ?? null;
    fitContext = { ...fit, protectedIds:new Set(fit.protectedIds), reserveIds:new Set(fit.reserveIds || []), lockedIds:new Set(fit.lockedIds), starterIds:new Set(fit.starterIds),
      paceOf, weeklyPaceOf, projectionCovered:(player,week)=>Number.isFinite(weeklyPaceOf(player,week)) };
  }
  const evaluate = createWaiverEvaluator({ fitContext, week:inputs.week, availabilityFor:row=>availabilityById[row.sleeperId],
    ownershipRechecked:inputs.ownershipRechecked, transactionsComplete:inputs.transactionsComplete,
    horizonFor:player=>nextWeekHorizon({ schedule:inputs.raw?.schedule || [], week:inputs.week, nflTeam:player.nflTeam }) });
  const byPosition = {};
  for (const row of market) {
    if (inputs.position && row.position !== inputs.position.toUpperCase()) continue;
    byPosition[row.position] ??= [];
    if (byPosition[row.position].length < inputs.limitPerPosition || row.poolEntry?.pinned) byPosition[row.position].push(evaluate(row));
  }
  const acquisitionPlan = fitContext ? buildAcquisitionPlan({ candidates:Object.values(byPosition).flat(), myPlayers:fitContext.myPlayers,
    faabRemaining:fitContext.faabRemaining, rosterCapacity:buildStarterSlotOrder(ROSTER_SETTINGS_2026).length + ROSTER_SETTINGS_2026.benchSlots + fitContext.protectedIds.size,
    evaluateCandidate:evaluate }) : null;
  return { byPosition, acquisitionPlan };
}
