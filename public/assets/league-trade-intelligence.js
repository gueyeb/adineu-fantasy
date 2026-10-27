import { normalizeTradeIntent, targetWeekTradeImpact, compareTargetWeekImpacts } from "./trade-target.js?v=e8117b11e7";
import { listRosterIdentities, buildStarterSlotOrder } from "./roster-view.js?v=120de9d74d";
import { BYE_WEEKS_2026, ROSTER_SETTINGS_2026 } from "./league-settings.js?v=886f353394";
import { buildProjectedLineup, restOfSeasonEstimate } from "./trade-score.js?v=716e1880af";
import { diagnoseRoster, findTradeProposals } from "./trade-recommender.js?v=6ba13bae8e";
import { playerKey } from "./trade-preferences.js?v=c5fec5ce56";

const positions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const tradePositions = new Set(["QB", "RB", "WR", "TE"]);
const slotOrder = buildStarterSlotOrder(ROSTER_SETTINGS_2026);

/** Preserve official ownership and slots; never export private owner/platform IDs. */
export function buildLeagueRosterSnapshot({ rosters = [], users = [], playerFor, asOf = null }) {
  return {
    source: "Sleeper league rosters/users", asOf,
    teams: listRosterIdentities(rosters, users).map(({ roster, ownerName, teamName }) => {
      const ids = (roster.players || []).map(String);
      const owned = new Set(ids);
      const starterIds = (roster.starters || []).map(String);
      const reserveIds = (roster.reserve || []).map(String).filter(id => owned.has(id));
      const issues = [];
      const nonEmptyStarters = starterIds.filter(id => id !== "0");
      if (new Set(nonEmptyStarters).size !== nonEmptyStarters.length) issues.push("DUPLICATE_STARTER");
      if (nonEmptyStarters.some(id => reserveIds.includes(id))) issues.push("STARTER_ON_RESERVE");
      if (!Array.isArray(roster.players)) issues.push("OWNERSHIP_UNAVAILABLE");
      if (!Array.isArray(roster.starters) || starterIds.length !== slotOrder.length) issues.push("DECLARED_LINEUP_INCOMPLETE");
      if (ids.length !== owned.size) issues.push("DUPLICATE_PLAYER");
      if (starterIds.some(id => id !== "0" && !owned.has(id))) issues.push("STALE_STARTER");
      if ((roster.reserve || []).some(id => !owned.has(String(id)))) issues.push("STALE_RESERVE");
      const players = [...owned].map(id => {
        const info = playerFor(id);
        if (!info || !positions.has(info.position)) issues.push(`PLAYER_METADATA_UNAVAILABLE:${id}`);
        return { ...info, sleeperId: id, name: info?.name || `Player #${id}`, position: info?.position || null };
      });
      return { rosterId: roster.roster_id, owner: ownerName, teamName, players, reserveIds,
        declaredStarters: slotOrder.map((slot, index) => ({ slot, playerId: owned.has(starterIds[index]) ? starterIds[index] : null })),
        issues };
    })
  };
}

/** Pure mutual-fit screen, using the same lineup, confidence and selection rules as the Finder.
 * Finder packages are evaluated before any output cap; fit is never acceptance odds. */
export function buildLeagueTradeIntelligence({ snapshot, targetRosterId, week = null, playerPreferences = {}, preferredPosition = null, targetWeek = null, projectionsByWeek = {}, timingContext = null } = {}) {
  if (!snapshot) return { status: "UNAVAILABLE", teams: [], partners: [], topPartners: [] };
  const intent = normalizeTradeIntent({ preferredPosition, targetWeek }, week);
  preferredPosition = intent.preferredPosition;
  targetWeek = intent.targetWeek;
  const estimate = restOfSeasonEstimate(week);
  const owners = new Map();
  for (const team of snapshot.teams) for (const player of team.players) {
    const id = playerKey(player);
    if (!owners.has(id)) owners.set(id, new Set());
    owners.get(id).add(String(team.rosterId));
  }
  const teams = snapshot.teams.map(team => {
    const players = team.players.map(player => ({ ...player, byeWeek: BYE_WEEKS_2026[player.nflTeam] ?? null }));
    const byId = new Map(players.map(player => [playerKey(player), player]));
    const declared = new Set(team.declaredStarters.map(slot => slot.playerId).filter(Boolean));
    const reserve = new Set(team.reserveIds);
    const optimalLineup = buildProjectedLineup(players, { estimate });
    const starters = new Set(optimalLineup.slots.map(slot => slot.sleeperId).filter(Boolean));
    const diagnosis = diagnoseRoster(players);
    const issues = [...team.issues];
    for (const player of players) if (owners.get(playerKey(player)).size > 1) issues.push(`OWNERSHIP_CONFLICT:${playerKey(player)}`);
    const missingProjectionIds = players.filter(player => !Number.isFinite(player.projectedPpg)).map(playerKey);
    return { rosterId: team.rosterId, owner: team.owner, teamName: team.teamName, players,
      declaredStarters: team.declaredStarters.map(slot => ({ slot: slot.slot, player: byId.get(slot.playerId) || null })),
      bench: players.filter(player => !declared.has(playerKey(player)) && !reserve.has(playerKey(player))),
      ir: players.filter(player => reserve.has(playerKey(player))),
      optimalLineup, diagnosis: { counts: diagnosis.counts, needs: diagnosis.deficits, surplus: diagnosis.surpluses, method: "MARKET_THRESHOLDS_HEURISTIC" },
      depth: [...tradePositions].map(position => ({ position,
        players: players.filter(player => player.position === position).sort((a, b) => estimate(b) - estimate(a)).map(player => ({ playerId: playerKey(player), name: player.name, estimatedPpg: estimate(player), inOptimalLineup: starters.has(playerKey(player)) })) })),
      coverage: { issues, missingProjectionIds, ownershipVerified: !issues.some(issue => /OWNERSHIP|DUPLICATE/.test(issue)) } };
  });
  const mine = teams.find(team => String(team.rosterId) === String(targetRosterId));
  if (!mine) return { status: "TARGET_UNAVAILABLE", source: snapshot.source, asOf: snapshot.asOf, teams, partners: [], topPartners: [] };
  const eligibleTeams = teams.filter(team => !team.coverage.issues.length);
  const proposals = mine.coverage.issues.length ? [] : findTradeProposals({ targetRosterId,
    rosters: eligibleTeams.map(team => ({ roster_id: team.rosterId, name: team.teamName, players: team.players })),
    currentWeek: week, playerPreferences, view: "ALL", limit: null });
  const brief = player => ({ playerId: playerKey(player), name: player.name, position: player.position });
  const partners = teams.filter(team => team !== mine).map(team => {
    const blockers = [...mine.coverage.issues, ...team.coverage.issues];
    const examples = proposals.filter(proposal => String(proposal.partnerRosterId) === String(team.rosterId) &&
      proposal.selection.group !== "EXPLORATION" && proposal.recommendationScore.their_lineup_delta > 0 &&
      (!preferredPosition || proposal.receive.some(player => player.position === preferredPosition))).map(proposal => {
      const score = proposal.recommendationScore;
      return { proposalId: proposal.id, give: proposal.give.map(brief), receive: proposal.receive.map(brief),
        myDeltaPerWeek: score.my_lineup_delta, theirDeltaPerWeek: score.their_lineup_delta,
        confidence: score.confidence, group: proposal.selection.group,
        fitScore: Math.min(score.my_lineup_delta, score.their_lineup_delta),
        targetWeekImpact: targetWeekTradeImpact({ myPlayers: mine.players, theirPlayers: team.players,
          give: proposal.give, receive: proposal.receive, currentWeek: week, targetWeek, projectionsByWeek, timingContext }) };
    });
    // A configured target prioritizes demonstrable immediate gains, then mutual ROS fit.
    // Unknown target-week gains are kept distinct and never treated as a numerical zero.
    examples.sort((a, b) => targetWeek !== null
      ? compareTargetWeekImpacts(a.targetWeekImpact, b.targetWeekImpact) || b.fitScore - a.fitScore || b.myDeltaPerWeek - a.myDeltaPerWeek
      : b.fitScore - a.fitScore || b.myDeltaPerWeek - a.myDeltaPerWeek);
    return { rosterId: team.rosterId, teamName: team.teamName, status: blockers.length ? "INCOMPLETE" : examples.length ? "MUTUAL_FIT" : "NO_QUALIFIED_TRADE",
      fitScore: examples[0]?.fitScore ?? null, targetWeekDelta: examples[0]?.targetWeekImpact.myDelta ?? null,
      examples: examples.slice(0, 3), blockers,
      reason: examples.length ? "Les deux lineups optimales gagnent des points estimés ; équité marché contrôlée." : "Aucun échange qualifié démontré parmi les propositions du Finder." };
  }).sort((a, b) => (targetWeek !== null ? compareTargetWeekImpacts({ myDelta: a.targetWeekDelta }, { myDelta: b.targetWeekDelta }) : 0) ||
    (b.fitScore ?? -1) - (a.fitScore ?? -1) || String(a.rosterId).localeCompare(String(b.rosterId)));
  return { status: "AVAILABLE", source: snapshot.source, asOf: snapshot.asOf, week, horizon: Number.isFinite(week) ? "ROS_WEEKLY_AVERAGE" : "WEEK",
    method: "SHARED_FINDER_PACKAGES_V2", preferredPosition, targetWeek, intentExpired: intent.expired, teams, partners, topPartners: partners.filter(partner => partner.status === "MUTUAL_FIT").slice(0, 3) };
}

export function formatLeagueTradeIntelligence(report) {
  if (!report || report.status !== "AVAILABLE") return ["LEAGUE ROSTERS & TRADE FIT", `Unavailable: ${report?.status || "UNAVAILABLE"}`];
  const line = player => player ? `${player.name} ${player.position || "?"} ${player.nflTeam || "?"} | proj=${player.projectedPpg ?? "n/d"} | ROS=${player.rosPpg ?? "n/d"} | status=${player.injuryStatus || "no platform alert"} | bye=${player.byeWeek ?? "n/d"}` : "EMPTY";
  const lines = ["LEAGUE ROSTERS & TRADE FIT", `Source: ${report.source}; roster fetched at ${report.asOf || "unknown"}; horizon=${report.horizon}. Model estimates, no acceptance odds.`,
    "Declared starters are Sleeper selections; optimal lineups and needs are Adineu estimates. IR stays in ROS estimates, not a current eligibility clearance."];
  for (const team of report.teams) {
    lines.push(`TEAM ${team.teamName} (@${team.owner}) | needs=${team.diagnosis.needs.join(",") || "none detected"} | surplus=${team.diagnosis.surplus.join(",") || "none detected"} | issues=${team.coverage.issues.join(",") || "none"}`);
    lines.push(...team.declaredStarters.map(slot => `DECLARED ${slot.slot}: ${line(slot.player)}`), ...team.bench.map(player => `BENCH: ${line(player)}`), ...team.ir.map(player => `IR: ${line(player)}`));
    lines.push(`OPTIMAL (model): ${team.optimalLineup.slots.map(slot => `${slot.slot}=${slot.name}`).join("; ")}`);
  }
  lines.push("PARTNERS — mutual lineup fit (shared Finder packages)");
  lines.push(`Trade intent: position=${report.preferredPosition || "ANY"}; targetWeek=${report.targetWeek ?? "none"}; expired=${report.intentExpired}. Target-week gains require published projections; trade processing time unverified.`);
  for (const partner of report.partners) {
    lines.push(`${partner.teamName}: ${partner.status}${partner.blockers.length ? ` (${partner.blockers.join(",")})` : ""}`);
    for (const example of partner.examples) lines.push(`Give ${example.give.map(player => player.name).join(" + ")} → receive ${example.receive.map(player => player.name).join(" + ")}; ROS average own +${example.myDeltaPerWeek}, partner +${example.theirDeltaPerWeek} pts/week; ${example.group}; confidence=${example.confidence}; target W${report.targetWeek ?? "n/d"}: own ${example.targetWeekImpact.myDelta ?? "n/d"}, partner ${example.targetWeekImpact.theirDelta ?? "n/d"}; ${example.targetWeekImpact.status}`);
  }
  return lines;
}
