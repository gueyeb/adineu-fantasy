/**
 * Adineu Fantasy — Sleeper roster identity & slot-shaping helpers
 *
 * Pure, no network I/O. Isomorphic module (same pattern as league-settings.js):
 * imported by Node scripts (scripts/league-context.js) and by browser modules
 * (public/assets/trade-ui.js, public/assets/teams.js).
 *
 * Scope on purpose: only the identity resolution (owner_id -> ownerName/teamName)
 * and the starters/bench/IR slot split are shared here. trade-ui.js's flat,
 * value-enriched player list is a different shape for a different need and
 * stays where it is — this module does not try to unify everything roster-shaped.
 */

/** Resolves one Sleeper roster's owner/team display identity from the league's users list. */
export function resolveRosterIdentity(roster, userById) {
  const user = userById.get(roster.owner_id);
  const ownerName = user?.display_name || `Manager ${roster.roster_id}`;
  const teamName = user?.metadata?.team_name || ownerName;
  return { ownerName, teamName };
}

/** Attaches { roster, ownerName, teamName } identity to every roster in a league. */
export function listRosterIdentities(rosters, users) {
  const userById = new Map((users || []).map(user => [user.user_id, user]));
  return (rosters || []).map(roster => ({ roster, ...resolveRosterIdentity(roster, userById) }));
}

/** Finds one roster by owner name, team name, or roster_id (case-insensitive). Throws on no match. */
export function findRosterByTeam(rosters, users, team) {
  const normalizedTeam = String(team).trim().toLowerCase();
  const named = listRosterIdentities(rosters, users);
  const found = named.find(entry =>
    entry.ownerName.toLowerCase() === normalizedTeam ||
    entry.teamName.toLowerCase() === normalizedTeam ||
    String(entry.roster.roster_id) === normalizedTeam
  );
  if (!found) throw new Error(`Équipe Sleeper inconnue : ${team}`);
  return found;
}

/** Builds the starter slot order (e.g. QB, RB, RB, WR, WR, TE, FLEX, K, DEF) from roster settings. */
export function buildStarterSlotOrder(rosterSettings) {
  const order = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    for (let i = 0; i < (rosterSettings.starters[pos] || 0); i++) order.push(pos);
  }
  for (let i = 0; i < (rosterSettings.starters.FLEX || 0); i++) order.push("FLEX");
  for (let i = 0; i < (rosterSettings.starters.K || 0); i++) order.push("K");
  for (let i = 0; i < (rosterSettings.starters.DEF || 0); i++) order.push("DEF");
  return order;
}

/** Resolves a Sleeper player id against the catalog, falling back to a labeled placeholder. */
export function resolvePlayer(playerMap, id) {
  return playerMap.get(id) || { sleeperId: id, name: `Player #${id}`, position: "FLEX" };
}

/**
 * Splits one Sleeper roster into titulaires (with slot labels) / banc / IR, resolved
 * against the player catalog.
 * @param {Object} options
 * @param {Object} options.roster Raw Sleeper roster (starters/players/reserve arrays)
 * @param {Map} options.playerMap sleeperId|name -> catalog player
 * @param {string[]} options.starterSlotOrder From buildStarterSlotOrder()
 */
export function buildRosterSlots({ roster, playerMap, starterSlotOrder }) {
  const starterIds = roster.starters || [];
  const reserveIds = new Set(roster.reserve || []);
  const startedIds = new Set(starterIds.filter(id => id && id !== "0"));

  const starters = starterIds.map((id, index) => ({
    slot: starterSlotOrder[index] || "FLEX",
    player: (!id || id === "0") ? null : resolvePlayer(playerMap, id)
  }));

  const bench = (roster.players || [])
    .filter(id => !startedIds.has(id) && !reserveIds.has(id))
    .map(id => resolvePlayer(playerMap, id));

  const ir = [...reserveIds].map(id => resolvePlayer(playerMap, id));

  return { starters, bench, ir };
}
