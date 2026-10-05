import { buildPlayerWeeks, calculateUsageScores } from '../public/assets/usage-score.js';
import { usageAdjustedRosPpg } from '../public/assets/rest-of-season.js';
import { estimateBaselineProjectedPpg } from '../public/assets/trade-value.js';
import { FANTASY_POSITIONS, computeRosPpg, buildOpportunitySignals, detectEvents, effectivePpg } from '../public/assets/waiver-model.js';
import { resolveRoleEvidence } from '../public/assets/acquisition-availability.js';
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
export function extractDecisionFeatures({ index, catalog, rosters, nflState, projectionsByWeek, statsByWeek, fetchedAtByPath, roleEvidenceById, asOf, week, lastCompletedWeek, season, leagueId }) {
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

  const provenanceFor = (id, player, rosSource) => buildDecisionProvenance({ playerId: id, nflTeam: player.nflTeam, position: player.position, week, lastCompletedWeek, season, projectionsByWeek, statsByWeek, fetchedAtByPath, rosSource });
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
    const pace = effectivePpg({ rosPpg, weekProjection, duration: events.duration, week, confirmedRoleWeeks: roleEvidence.roleWeeks });
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
      usageDiagnostic: usageById.has(id) ? { sampleGames: usageById.get(id).games, actualWeightedPpg: usageById.get(id).ppg, xfpWeightedPpg: usageById.get(id).xfp, actualMinusXfp: usageById.get(id).gap, trend: usageById.get(id).trend, trendUnit: "COMPOSITE_DIFFERENCE_TIMES_100", recencyWeights: [0.5, 0.3, 0.2], model: usageResult.models[player.position], method: "VOLUME_LINEAR_REGRESSION", opportunityQualityMeasured: false } : null,
      provenance: provenanceFor(id, player, projectedRos !== null ? (rosDetail?.source || "SLEEPER_PROJECTIONS") : rankFallback !== null ? "RANK_ESTIMATE" : "NONE"),
      marketEstimate: { method: pace.method, roleWindowSource: pace.roleWindowSource, recentScoresUsed: pace.recentScoresUsed, inferredShareUsed: pace.inferredShareUsed, contingencyValue: pace.contingencyValue, calibrated: pace.calibrated },
      events: { ...events, rolePpg: pace.rolePpg, roleWeeks: pace.roleWeeks }
    });
  }


  return { rows, usageById, rosFor, rosDetailFor, meta, provenanceFor };
}
