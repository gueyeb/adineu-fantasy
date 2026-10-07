import { isCurrentEvidence } from "./acquisition-availability.js?v=b05f3e356e";

export const RIPPLE_EVENT_TYPES = ["INJURY", "RETURN", "ROLE_CHANGE", "NFL_TRANSACTION"];
// Questionable is only a possible absence: it asks for a second look, nothing more.
const SNAPSHOT_TRIGGER_STATUSES = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "Questionable"]);
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

const teamOf = value => typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Team/position ripple: which players must be re-evaluated because something happened in their NFL group.
 * Only two inputs count: the Sleeper players snapshot (rostered AND unrostered) and dated operator events.
 * Fantasy-league transactions (adds, drops, trades) are not an input at all: a fantasy acquisition does not
 * change an NFL depth chart. A shared name, or a shared team without a sourced position, proves no group.
 * The output only says REEVALUATE: never a target share, a successor or a duration.
 *
 * players: iterable of { id, name, position, nflTeam, injuryStatus, active }.
 * eventsById: operator evidence keyed by trigger player id
 *   ({ type, nflTeam, positions, source, observedAt, expiresAt } + the scope stamped by loadDecisionEvidence).
 * Returns { byPlayerId: Map<string, RippleEntry[]>, sourcedEventPlayerIds: Set<string>, issues: [] }.
 */
export function buildTeamPositionRipple({ players, eventsById = {}, asOf, week, season, leagueId }) {
  const snapshot = new Map();
  const groups = new Map();
  for (const player of players || []) {
    if (!player || player.id === undefined || player.id === null) continue;
    const id = String(player.id);
    const nflTeam = teamOf(player.nflTeam);
    const row = { ...player, id, nflTeam };
    snapshot.set(id, row);
    if (!nflTeam || !FANTASY_POSITIONS.has(player.position)) continue;
    const group = `${nflTeam}:${player.position}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }

  const entries = new Map();
  const ripple = (group, triggerPlayerId, entry) => {
    for (const player of groups.get(group) || []) {
      if (player.id === triggerPlayerId || player.active === false) continue;
      if (!entries.has(player.id)) entries.set(player.id, []);
      entries.get(player.id).push({ ...entry, triggerPlayerId, group, effect: "REEVALUATE", shareAttributed: null, successionInferred: false });
    }
  };

  for (const player of snapshot.values()) {
    if (!SNAPSHOT_TRIGGER_STATUSES.has(player.injuryStatus) || !player.nflTeam || !FANTASY_POSITIONS.has(player.position)) continue;
    ripple(`${player.nflTeam}:${player.position}`, player.id, { trigger: "SNAPSHOT_STATUS", triggerName: player.name ?? null,
      triggerStatus: player.injuryStatus, certainty: player.injuryStatus === "Questionable" ? "POSSIBLE_ABSENCE" : "REPORTED_ABSENCE",
      type: null, observedAt: null, source: "SLEEPER_PLAYERS_SNAPSHOT" });
  }

  const issues = [];
  const sourcedEventPlayerIds = new Set();
  for (const [rawId, event] of Object.entries(eventsById || {})) {
    const playerId = String(rawId);
    if (!isCurrentEvidence(event, { asOf, week, season, leagueId })) { issues.push({ code: "EVENT_EVIDENCE_NOT_CURRENT", playerId }); continue; }
    if (!RIPPLE_EVENT_TYPES.includes(event.type)) { issues.push({ code: "EVENT_TYPE_UNSUPPORTED", playerId }); continue; }
    const nflTeam = teamOf(event.nflTeam);
    const positions = Array.isArray(event.positions) ? [...new Set(event.positions)] : [];
    if (!nflTeam || !positions.length || !positions.every(position => FANTASY_POSITIONS.has(position))) {
      issues.push({ code: "EVENT_GROUP_UNSOURCED", playerId });
      continue;
    }
    const known = snapshot.get(playerId);
    if (known && known.nflTeam !== nflTeam) { issues.push({ code: "EVENT_TEAM_MISMATCH", playerId }); continue; }
    sourcedEventPlayerIds.add(playerId);
    for (const position of positions) {
      ripple(`${nflTeam}:${position}`, playerId, { trigger: "SOURCED_EVENT", triggerName: known?.name ?? null,
        triggerStatus: null, certainty: "SOURCED_EVENT", type: event.type, observedAt: event.observedAt, source: event.source });
    }
  }

  const byPlayerId = new Map([...entries.keys()].sort(byText).map(id => [id, entries.get(id)
    .sort((a, b) => byText(a.trigger, b.trigger) || byText(a.triggerPlayerId, b.triggerPlayerId))]));
  issues.sort((a, b) => byText(a.playerId, b.playerId) || byText(a.code, b.code));
  return { byPlayerId, sourcedEventPlayerIds: new Set([...sourcedEventPlayerIds].sort(byText)), issues };
}
