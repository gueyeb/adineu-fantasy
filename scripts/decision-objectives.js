import { evaluateRosterFit } from "../public/assets/waiver-model.js";

/** Independent roster scenarios, no future execution authorization. */
export function buildObjectiveFits(row, fitContext, week) {
  if (!fitContext) return null;
  return Object.fromEntries([['QUALIFICATION', week, 14], ['PLAYOFFS', Math.max(week, 15), 17],
      ...[15, 16, 17].map(w => [`PLAYOFF_WEEK_${w}`, Math.max(week, w), w])].map(([objective, from, to]) => {
      if (from > to) return [objective, { status: 'HORIZON_ENDED', executableNow: false }];
      const fit = evaluateRosterFit({ ...fitContext, marketRow: { ...row, events: { ...row.events, roleWeeks: 0 } }, week: from, endWeek: to,
        ...(from > week ? { frozenSlots: {}, lockedIds: new Set() } : {}) });
      return [objective, { from, to, netGainTotal: fit.horizonCovered ? fit.netGainTotal : null, horizonCovered: fit.horizonCovered,
        dropCandidate: fit.dropCandidate, coverageIssues: fit.coverageIssues, weeklyLineupDeltas: fit.weeklyLineupDeltas,
        executableNow: false, assumptions: ['FUTURE_ROSTER_SCENARIO', 'REVALIDATE_AVAILABILITY_AND_ROLE', ...fit.assumptions] }];
    }));
}
