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

let pageContextProvider = null;
export function registerPageAiContext(provider) { pageContextProvider = provider; }
export function getPageAiContext() { return pageContextProvider ? pageContextProvider() : null; }

// Safari (and Chrome once the tab loses focus) drop the click's permission while a slow fetch runs:
// a ClipboardItem built synchronously in the click keeps it, writeText is the fallback.
export async function copyTextFrom(textPromise) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = Promise.resolve(textPromise).then(text => new Blob([text], { type: "text/plain" }));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return;
    } catch (error) {
      await blob; // a failed fetch must surface as itself, not as a clipboard error
      if (error?.name !== "NotAllowedError" && error?.name !== "TypeError") throw error;
    }
  }
  await navigator.clipboard.writeText(await textPromise);
}
