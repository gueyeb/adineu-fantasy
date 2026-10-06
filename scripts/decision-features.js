import { buildPlayerWeeks, calculateUsageScores, expectedPoints } from '../public/assets/usage-score.js';
import { buildEmergingRole, classifyRoleProfile } from '../public/assets/role-profile.js';
import { usageAdjustedRosPpg } from '../public/assets/rest-of-season.js';
import { estimateBaselineProjectedPpg } from '../public/assets/trade-value.js';
import { FANTASY_POSITIONS, computeRosPpg, buildOpportunitySignals, detectEvents, effectivePpg } from '../public/assets/waiver-model.js';
import { resolveRoleEvidence, findRecentDrops } from '../public/assets/acquisition-availability.js';
import { buildTeamPositionRipple } from '../public/assets/team-position-ripple.js';
import { buildDecisionProvenance } from './decision-provenance.js';
export const SEVERITY_BY_STATUS = {
  Questionable: "WATCH",
  Doubtful: "ALERT",
  Out: "ALERT",
  IR: "ALERT",
  PUP: "ALERT",
  Sus: "ALERT",
  NA: "ALERT"
};

/** Shared source-to-feature extraction, pure and scoped to the archived decision time. */
export function extractDecisionFeatures({ index, catalog, rosters, nflState, projectionsByWeek, statsByWeek, fetchedAtByPath, roleEvidenceById, eventsById = {}, allTransactions = [], asOf, week, lastCompletedWeek, season, leagueId }) {
  const catalogById = new Map((catalog.players || []).map(player => [player.sleeperId, player]));
  const rosteredIds = new Set(rosters.flatMap(roster => roster.players || []).map(String));
  const seasonStart = Date.parse(nflState?.season_start_date || "2026-09-09");
  const teamOf = (id, playedWeek) => {
    const player = index.get(id);
    const weekEnd = seasonStart + playedWeek * 7 * 24 * 3600 * 1000;
    if (!player?.nflTeam || (Number.isFinite(player.teamChangedAt) && player.teamChangedAt > weekEnd && player.teamChangedAt > seasonStart)) return null;
    return player.nflTeam;
  };
  const usageRows = buildPlayerWeeks(statsByWeek, { teamOf, positionOf: id => index.get(id)?.position });
  const usageResult = calculateUsageScores(usageRows);
  const usageById = new Map(usageResult.players.map(player => [player.playerId, player]));
  // Expected points per played week, from the same refit volume model as the usage signals.
  const xfpByWeekById = new Map();
  for (const row of usageRows) {
    const model = usageResult.models[row.position];
    if (!model) continue;
    if (!xfpByWeekById.has(row.playerId)) xfpByWeekById.set(row.playerId, {});
    xfpByWeekById.get(row.playerId)[row.week] = Number(expectedPoints(row, model).toFixed(2));
  }

  const meta = id => index.get(id) || (catalogById.has(id) ? { id, name: catalogById.get(id).name, position: catalogById.get(id).position, nflTeam: catalogById.get(id).nflTeam, active: true } : null);
  // The decision engine never prices a player Sleeper does not project: a value built from
  // recent volume alone is not a projection, so it is dropped here (rank fallback or null).
  const projectedOnly = detail => detail && detail.projectedWeeks > 0 ? detail : null;
  const rosDetailFor = (id, player) => projectedOnly(usageAdjustedRosPpg({
    playerId: id,
    position: player?.position,
    nflTeam: player?.nflTeam,
    projectionsByWeek,
    week,
    xfp: usageById.get(id)?.xfp
  }));
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

  // Team/position ripple: Sleeper snapshot statuses + dated operator events. Fantasy-league
  // transactions are deliberately not an input: an acquisition never changes an NFL depth chart.
  const ripple = buildTeamPositionRipple({ players: [...candidateIds].map(id => ({ ...meta(id), id })).filter(player => player.nflTeam),
    eventsById, asOf, week, season, leagueId });
  // A teammate ranked behind a player opens nothing for him. Unknown ranks stay possible.
  const isAheadOf = (id, entry) => {
    const own = meta(id)?.searchRank;
    const other = meta(entry.triggerPlayerId)?.searchRank;
    return !(Number.isFinite(own) && Number.isFinite(other)) || other < own;
  };
  const lastStatsWeek = statsByWeek.at(-1);
  const playedLastWeek = id => { const row = lastStatsWeek?.stats?.[id]; return Boolean(row && (row.off_snp > 0 || row.gp > 0)); };
  // An absence explains a rise only if it was already true while the rise was measured: a
  // teammate who played the last completed week and got hurt afterwards explains nothing.
  const absencesAhead = (id, entries) => entries.filter(entry => entry.certainty !== "POSSIBLE_ABSENCE" && isAheadOf(id, entry) && !playedLastWeek(entry.triggerPlayerId));
  // Shown and acted on: sourced events, and snapshot statuses of teammates ahead only.
  const relevantRipple = id => (ripple.byPlayerId.get(String(id)) ?? []).filter(entry => entry.trigger === "SOURCED_EVENT" || isAheadOf(id, entry));
  const recentDrops = findRecentDrops(allTransactions, { asOf });
  const exclusions = { ROSTERED: 0, INACTIVE_OR_NO_NFL_TEAM: 0, NON_FANTASY_POSITION: 0, STATUS_ALERT: 0, NO_PROJECTION_OR_STATS: 0 };
  const entryReasonCounts = {};

  const provenanceFor = (id, player, rosSource) => buildDecisionProvenance({ playerId: id, nflTeam: player.nflTeam, position: player.position, week, lastCompletedWeek, season, projectionsByWeek, statsByWeek, fetchedAtByPath, rosSource });
  const rows = [];
  for (const id of candidateIds) {
    if (rosteredIds.has(id)) { exclusions.ROSTERED++; continue; }
    const player = meta(id);
    if (!player?.active || !player.nflTeam) { exclusions.INACTIVE_OR_NO_NFL_TEAM++; continue; }
    if (!FANTASY_POSITIONS.includes(player.position)) { exclusions.NON_FANTASY_POSITION++; continue; }
    // Un événement sourcé et daté, ou une coupe récente, justifie l'analyse même sans projection :
    // le joueur entre dans le pool, jamais dans un gain chiffré.
    const sourcedEvent = ripple.sourcedEventPlayerIds.has(String(id));
    const recentDrop = recentDrops.get(String(id)) ?? null;
    const statusAlert = SEVERITY_BY_STATUS[player.injuryStatus] === "ALERT";
    // Jamais recommandé s'il ne peut pas jouer (IR/Out/Doubtful/PUP/Sus/NA), même sévérité que le Start/Sit.
    if (statusAlert && !sourcedEvent && !recentDrop) { exclusions.STATUS_ALERT++; continue; }
    const catalogEntry = catalogById.get(id) || {};
    // Repli étiqueté : sans couverture de projections futures, estimation par rang (ECR catalogue).
    const rosDetail = rosDetailFor(id, player);
    const projectedRos = rosDetail?.ppg ?? computeRosPpg({ playerId: id, nflTeam: player?.nflTeam, projectionsByWeek, week });
    const rankFallback = projectedRos === null && Number.isFinite(catalogEntry.quality?.expertRank ?? catalogEntry.market?.sleeperAdp)
      ? estimateBaselineProjectedPpg({ ...catalogEntry, projectedPpg: undefined, projection: undefined }) : null;
    const rosPpg = projectedRos ?? rankFallback;
    const signals = buildOpportunitySignals(id, statsByWeek);
    const weekProjection = projectionsByWeek[week]?.[id]?.pts_ppr ?? null;
    const roleEvidenceCurrent = resolveRoleEvidence(roleEvidenceById[id], { asOf, week, season, leagueId }).roleConfirmation === "CONFIRMED";
    const entryReasons = [
      ...(projectedRos !== null ? ["PROJECTION"] : []), ...(rankFallback !== null ? ["RANK_FALLBACK"] : []),
      ...(signals.gamesPlayed ? ["RECENT_STATS"] : []), ...(sourcedEvent ? ["SOURCED_EVENT"] : []),
      ...(roleEvidenceCurrent ? ["ROLE_EVIDENCE"] : []), ...(recentDrop ? ["RECENT_DROP"] : [])
    ];
    if (!entryReasons.length) { exclusions.NO_PROJECTION_OR_STATS++; continue; }
    for (const reason of entryReasons) entryReasonCounts[reason] = (entryReasonCounts[reason] || 0) + 1;
    const valuationCovered = rosPpg !== null || Number.isFinite(weekProjection);
    const teammates = byTeamPosition.get(`${player.nflTeam}:${player.position}`) || [];
    const events = detectEvents({ player: { ...player, id, rosPpg }, teammates, signals });
    const roleEvidence = resolveRoleEvidence(roleEvidenceById[id], { asOf, week, season, leagueId });
    if (player.position === "QB" && roleEvidence.roleConfirmation === "CONFIRMED") {
      const otherStarters = teammates.filter(mate => mate.id !== id && resolveRoleEvidence(roleEvidenceById[mate.id], { asOf, week, season, leagueId }).announcedRole === "STARTING_QB");
      if (roleEvidence.announcedRole !== "STARTING_QB" || otherStarters.length) {
        roleEvidence.roleConfirmation = "UNCONFIRMED";
        roleEvidence.evidence = [];
        roleEvidence.roleWeeks = null;
        events.reasons.push(otherStarters.length ? "Conflicting starting-QB confirmations" : "Starting-QB role not confirmed");
      }
    }
    if (events.flags.includes("PROMOTION") || roleEvidence.roleConfirmation === "CONFIRMED") {
      Object.assign(events, roleEvidence);
    }
    const playerRipple = relevantRipple(id);
    const emergingRole = buildEmergingRole({ series: signals.series, xfpByWeek: xfpByWeekById.get(id), absenceTriggers: absencesAhead(id, playerRipple) });
    const roleProfile = classifyRoleProfile({ flags: events.flags, signals, emergingRole });
    const pace = effectivePpg({ rosPpg, weekProjection, duration: events.duration, week, confirmedRoleWeeks: roleEvidence.roleWeeks });
    rows.push({
      ...catalogEntry,
      poolEntry: { reasons: entryReasons, statusAlert, valuationCovered, recentDrop,
        // Kept on the board beyond the per-position limit: the limit must not hide them.
        pinned: sourcedEvent || roleEvidenceCurrent || Boolean(recentDrop) },
      valuationCovered,
      ripple: playerRipple,
      emergingRole,
      roleProfile,
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
      effectivePpg: valuationCovered ? pace.effective : null,
      signals,
      usageDiagnostic: usageById.has(id) ? { sampleGames: usageById.get(id).games, actualWeightedPpg: usageById.get(id).ppg, xfpWeightedPpg: usageById.get(id).xfp, actualMinusXfp: usageById.get(id).gap, trend: usageById.get(id).trend, trendUnit: "COMPOSITE_DIFFERENCE_TIMES_100", recencyWeights: [0.5, 0.3, 0.2], model: usageResult.models[player.position], method: "VOLUME_LINEAR_REGRESSION", opportunityQualityMeasured: false } : null,
      provenance: provenanceFor(id, player, projectedRos !== null ? (rosDetail?.source || "SLEEPER_PROJECTIONS") : rankFallback !== null ? "RANK_ESTIMATE" : "NONE"),
      marketEstimate: { method: pace.method, roleWindowSource: pace.roleWindowSource, recentScoresUsed: pace.recentScoresUsed, inferredShareUsed: pace.inferredShareUsed, contingencyValue: pace.contingencyValue, calibrated: pace.calibrated },
      events: { ...events, rolePpg: pace.rolePpg, roleWeeks: pace.roleWeeks }
    });
  }


  /** One roster player with every input its cut cost reads; shared by live and recomputed fits. */
  const rosterPlayerFor = id => {
    const player = meta(id) || { name: `Player #${id}`, position: "FLEX" };
    const usage = usageById.get(id);
    const signals = buildOpportunitySignals(id, statsByWeek);
    const playerRipple = relevantRipple(id);
    return {
      ...(catalogById.get(id) || {}), ...player, sleeperId: id,
      provenance: provenanceFor(id, player, rosDetailFor(id, player)?.source ?? "NONE"),
      projectedPpg: projectionsByWeek[week]?.[id]?.pts_ppr,
      injuryStatus: player.injuryStatus,
      rosPpg: rosFor(id, player),
      signals,
      emergingRole: buildEmergingRole({ series: signals.series, xfpByWeek: xfpByWeekById.get(id), absenceTriggers: absencesAhead(id, playerRipple) }),
      usageScore: usage?.usageScore ?? null,
      usageSignal: usage?.signal ?? null,
      usageTrend: usage?.trend ?? null,
      xfp: usage?.xfp ?? null,
      ripple: playerRipple
    };
  };
  const poolCoverage = { source: index.size ? "SLEEPER_PLAYERS_INDEX" : "CATALOG_FALLBACK", considered: candidateIds.size,
    included: rows.length, excluded: exclusions, entryReasons: entryReasonCounts,
    unvalued: rows.filter(row => !row.valuationCovered).length, pinned: rows.filter(row => row.poolEntry.pinned).length,
    rippleIssues: ripple.issues };

  return { rows, usageById, rosFor, rosDetailFor, meta, provenanceFor, rosterPlayerFor, poolCoverage, recentDrops, ripple };
}
