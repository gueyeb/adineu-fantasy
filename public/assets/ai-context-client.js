/** Appends browser-only Trade Finder preferences to the server-generated decision context. */
export function appendManagerPreferences(message, context, preferences = {}) {
  const players = [
    ...(context?.myTeam?.starters || []).map(entry => entry.player),
    ...(context?.myTeam?.bench || []),
    ...(context?.myTeam?.ir || [])
  ].filter(Boolean);
  const nameByKey = new Map(players.map(player => [String(player.sleeperId || player.name), player.name]));
  const groups = { KEEP: [], SHOP: [], UNTOUCHABLE: [] };
  for (const [key, status] of Object.entries(preferences || {})) {
    if (groups[status] && nameByKey.has(key)) groups[status].push(nameByKey.get(key));
  }
  if (!Object.values(groups).some(list => list.length)) return message;
  return [
    message,
    "",
    "MANAGER PREFERENCES — browser saved",
    `KEEP: ${groups.KEEP.join(", ") || "none"}`,
    `SHOP: ${groups.SHOP.join(", ") || "none"}`,
    `UNTOUCHABLE: ${groups.UNTOUCHABLE.join(", ") || "none"}`
  ].join("\n");
}
