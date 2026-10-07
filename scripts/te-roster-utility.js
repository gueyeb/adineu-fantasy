import { BYE_WEEKS_2026, ROSTER_SETTINGS_2026, SCORING_SETTINGS_2026 } from '../public/assets/league-settings.js';

/** Explain the chosen fit, never reprice it or infer future injury insurance. */
export function buildTeRosterUtility({ row, rosterContext, fit, week }) {
  if (row.position !== 'TE' || !rosterContext || !fit) return null;
  const active = rosterContext.myPlayers.filter(player => !rosterContext.reserveIds?.has(String(player.sleeperId)));
  const owned = active.filter(player => player.position === 'TE');
  const starters = owned.filter(player => rosterContext.starterIds?.has(String(player.sleeperId)));
  const declared = owned.find(player => String(player.sleeperId) === String(rosterContext.starterTeId));
  const reference = declared ?? (starters.length === 1 ? starters[0] : owned.length === 1 ? owned[0] : null);
  const referenceByeWeek = BYE_WEEKS_2026[reference?.nflTeam] ?? null;
  const candidateByeWeek = BYE_WEEKS_2026[row.nflTeam] ?? null;
  const cutId = fit.dropCandidate?.sleeperId;
  const retained = owned.filter(player => String(player.sleeperId) !== String(cutId));
  const covered = fit.horizonCovered && fit.legalTransaction;
  const weeklyUsage = fit.weeklyLineupDeltas.map(delta => {
    const unavailable = candidateByeWeek === delta.week || delta.week === week && ['Out', 'Doubtful', 'IR', 'PUP', 'Sus', 'NA'].includes(row.injuryStatus);
    const verified = Boolean(covered && delta.covered);
    return { week: delta.week, covered: verified, slot: verified && !unavailable ? delta.slot : null,
      lineupDelta: verified ? delta.delta : null, weight: delta.weight,
      candidateUnavailable: unavailable, teBefore: verified ? delta.teUsage?.before ?? null : null,
      teAfter: verified ? delta.teUsage?.after ?? null : null,
      previousTeSlotAfter: verified ? delta.teUsage?.previousTeSlotAfter ?? null : null };
  });
  const teWeeks = weeklyUsage.filter(value => value.slot === 'TE').map(value => value.week);
  const flexWeeks = weeklyUsage.filter(value => value.slot === 'FLEX').map(value => value.week);
  const byeUsage = weeklyUsage.find(value => value.week === referenceByeWeek);
  const byeStatus = !reference ? 'REFERENCE_UNDETERMINED' : String(cutId) === String(reference.sleeperId) ? 'REFERENCE_REPLACED'
    : referenceByeWeek === null ? 'REFERENCE_BYE_UNKNOWN' : referenceByeWeek < week ? 'BYE_PASSED'
      : !byeUsage ? 'OUTSIDE_ROLE_WINDOW' : candidateByeWeek === referenceByeWeek ? 'SAME_BYE'
        : candidateByeWeek === null ? 'CANDIDATE_CALENDAR_UNVERIFIED' : !byeUsage.covered ? 'COMPARISON_UNVERIFIED'
          : byeUsage.slot === 'TE' ? 'PROJECTED_TE_USE_ON_BYE' : 'NO_PROJECTED_TE_USE_ON_BYE';
  return { method: 'CHOSEN_FIT_LINEUP_SLOTS_V1', context: !owned.length ? 'TE_SLOT_FILL' : !retained.length ? 'TE_REPLACEMENT' : 'ADDITIONAL_TE',
    status: !covered ? 'UNVERIFIED' : teWeeks.length || flexWeeks.length ? 'PROJECTED_LINEUP_USE' : 'NO_PROJECTED_START',
    scoring: { teSlots: ROSTER_SETTINGS_2026.starters.TE, tightEndBonus: SCORING_SETTINGS_2026.receiving.tightEndBonus },
    reference: reference ? { playerId: String(reference.sleeperId), name: reference.name, byeWeek: referenceByeWeek,
      method: declared ? 'DECLARED_TE_SLOT' : starters.length === 1 ? 'DECLARED_STARTER' : 'ONLY_ACTIVE_ROSTERED_TE' } : null,
    assumesPriorAcquisitions: active.filter(player => player.plannedRoleWindow).map(player => String(player.sleeperId)),
    activeOwnedTeCount: owned.length, candidateByeWeek, horizonWeeks: fit.horizonWeeks, startWeek: week,
    teWeeks, flexWeeks, weeklyUsage, byeCoverage: { status: byeStatus, week: referenceByeWeek,
      lineupDelta: byeStatus === 'PROJECTED_TE_USE_ON_BYE' ? byeUsage.lineupDelta : null },
    grossGainTotal: fit.grossGainTotal, cutOptionCostTotal: fit.dropCostTotal,
    postRoleCutCostTotal: fit.postRoleCutCostTotal, netGainTotal: fit.netGainTotal,
    netAssessment: fit.netGainTotal === null ? 'UNVERIFIED' : fit.netGainTotal > 0 ? 'POSITIVE' : 'NON_POSITIVE',
    cutCandidate: fit.dropCandidate, lineupLossAlreadyIncluded: true,
    benchSpace: fit.cutSelection === 'OPEN_ROSTER_SLOT' ? 'USES_FREE_ROSTER_SPOT' : fit.dropCandidate ? 'REQUIRES_CUT' : 'TRANSACTION_UNVERIFIED',
    alternativeAcquisitionValue: null, insuranceValue: null, insuranceMethod: 'FUTURE_INJURY_NOT_ASSUMED',
    coverageIssues: fit.coverageIssues, changesDecisionModel: false };
}

export function formatTeRosterUtility(utility) {
  if (!utility) return '';
  const byeLabels = {
    PROJECTED_TE_USE_ON_BYE: `TE projeté pendant le bye S${utility.byeCoverage.week}`,
    NO_PROJECTED_TE_USE_ON_BYE: `aucune utilisation TE projetée au bye S${utility.byeCoverage.week}`,
    OUTSIDE_ROLE_WINDOW: `bye S${utility.byeCoverage.week} hors horizon du rôle`,
    SAME_BYE: `même bye S${utility.byeCoverage.week}, aucun remplacement de bye`,
    COMPARISON_UNVERIFIED: 'remplacement de bye non vérifié', CANDIDATE_CALENDAR_UNVERIFIED: 'bye du candidat inconnu',
    BYE_PASSED: 'bye déjà passé', REFERENCE_REPLACED: 'remplace le TE de référence',
    REFERENCE_BYE_UNKNOWN: 'bye de référence inconnu', REFERENCE_UNDETERMINED: 'TE de référence non déterminé'
  };
  const usage = utility.status === 'UNVERIFIED' ? 'utilité de lineup non vérifiée' : utility.status === 'NO_PROJECTED_START'
    ? 'aucune entrée dans la lineup projetée sur cet horizon' : `lineup projetée : TE ${utility.teWeeks.map(week => `S${week}`).join('/') || 'aucune semaine'} ; FLEX ${utility.flexWeeks.map(week => `S${week}`).join('/') || 'aucune semaine'}`;
  const cut = utility.benchSpace === 'USES_FREE_ROSTER_SPOT' ? 'une place de banc utilisée'
    : utility.cutCandidate ? `coupe ${utility.cutCandidate.name}` : 'coupe non déterminée';
  const rotationWeeks = utility.weeklyUsage.filter(row => row.previousTeSlotAfter === 'FLEX').map(row => `S${row.week}`);
  return `${utility.context === 'ADDITIONAL_TE' ? 'TE supplémentaire' : 'Option TE'}${utility.reference ? ` (référence : ${utility.reference.name})` : ''}${utility.assumesPriorAcquisitions.length ? ' (après les acquisitions précédentes supposées réussies)' : ''} : ${usage}${rotationWeeks.length ? ` ; rotation couplée ancien TE vers FLEX ${rotationWeeks.join('/')}` : ''} ; ${byeLabels[utility.byeCoverage.status]}; ${cut} ; gain brut ${utility.grossGainTotal ?? 'n/d'} pts, option de coupe ${utility.cutOptionCostTotal ?? 'n/d'}, perte après rôle ${utility.postRoleCutCostTotal ?? 'n/d'}, net ${utility.netGainTotal ?? 'n/d'} pts sur ${utility.horizonWeeks} sem. Valeur de secours sur blessure future : n/d.`;
}
