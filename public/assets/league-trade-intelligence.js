import { listRosterIdentities, buildStarterSlotOrder } from "./roster-view.js?v=120de9d74d";
import { BYE_WEEKS_2026, ROSTER_SETTINGS_2026 } from "./league-settings.js?v=f6d1bf5212";
import { buildProjectedLineup, restOfSeasonEstimate, scoreTradeRecommendation } from "./trade-score.js?v=8773b08bd5";
import { diagnoseRoster, classifyTradeProposal } from "./trade-recommender.js?v=2c7f958555";
import { playerKey, preferenceAdjustment } from "./trade-preferences.js?v=c5fec5ce56";

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
 * One-for-one examples only; a partner score is a lineup fit, never acceptance odds. */
export function buildLeagueTradeIntelligence({ snapshot, targetRosterId, week = null, playerPreferences = {}, preferredPosition = null } = {}) {
  if (!snapshot) return { status: "UNAVAILABLE", teams: [], partners: [], topPartners: [] };
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
  const partners = teams.filter(team => team !== mine).map(team => {
    const blockers = [...mine.coverage.issues, ...team.coverage.issues];
    const examples = [];
    if (!blockers.length) for (const give of mine.players.filter(player => tradePositions.has(player.position) && preferenceAdjustment([player], playerPreferences) !== null)) {
      for (const receive of team.players.filter(player => tradePositions.has(player.position) && (!preferredPosition || player.position === preferredPosition))) {
        const recommendationScore = scoreTradeRecommendation({ myPlayers: mine.players, theirPlayers: team.players, give: [give], receive: [receive], week });
        if (recommendationScore.my_lineup_delta <= 0 || recommendationScore.their_lineup_delta <= 0 || recommendationScore.market_value.gapPct > 18) continue;
        const proposal = { give: [give], receive: [receive], recommendationScore };
        const selection = classifyTradeProposal(proposal, { playerPreferences });
        if (selection.group === "EXPLORATION") continue;
        examples.push({ give: { playerId: playerKey(give), name: give.name, position: give.position }, receive: { playerId: playerKey(receive), name: receive.name, position: receive.position },
          myDeltaPerWeek: recommendationScore.my_lineup_delta, theirDeltaPerWeek: recommendationScore.their_lineup_delta,
          confidence: recommendationScore.confidence, group: selection.group,
          fitScore: Math.min(recommendationScore.my_lineup_delta, recommendationScore.their_lineup_delta) });
      }
    }
    examples.sort((a, b) => b.fitScore - a.fitScore || b.myDeltaPerWeek - a.myDeltaPerWeek || a.give.playerId.localeCompare(b.give.playerId));
    return { rosterId: team.rosterId, teamName: team.teamName, status: blockers.length ? "INCOMPLETE" : examples.length ? "MUTUAL_FIT" : "NO_QUALIFIED_ONE_FOR_ONE",
      fitScore: examples[0]?.fitScore ?? null, examples: examples.slice(0, 3), blockers,
      reason: examples.length ? "Les deux lineups optimales gagnent des points estimés ; équité marché contrôlée." : "Aucun échange simple qualifié démontré ; les packages ne sont pas évalués ici." };
  }).sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || String(a.rosterId).localeCompare(String(b.rosterId)));
  return { status: "AVAILABLE", source: snapshot.source, asOf: snapshot.asOf, week, horizon: Number.isFinite(week) ? "ROS_WEEKLY_AVERAGE" : "WEEK",
    method: "BILATERAL_ONE_FOR_ONE_V1", preferredPosition, teams, partners, topPartners: partners.filter(partner => partner.status === "MUTUAL_FIT").slice(0, 3) };
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
  lines.push("PARTNERS — mutual lineup fit (one-for-one screen only)");
  for (const partner of report.partners) {
    lines.push(`${partner.teamName}: ${partner.status}${partner.blockers.length ? ` (${partner.blockers.join(",")})` : ""}`);
    for (const example of partner.examples) lines.push(`Give ${example.give.name} → receive ${example.receive.name}; own +${example.myDeltaPerWeek}, partner +${example.theirDeltaPerWeek} pts/week; ${example.group}; confidence=${example.confidence}`);
  }
  return lines;
}
