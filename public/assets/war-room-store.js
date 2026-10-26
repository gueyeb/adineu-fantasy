/** Browser persistence of the Waiver War Room: one watchlist and one bid history per roster.
 * localStorage first, so every page works offline and signed out; a signed-in Coach session also
 * mirrors it on the server (`/api/coach/war-room`) to follow the user across devices. Every access
 * tolerates a blocked storage, and a failed sync never blocks a local write. */
import { LEAGUE_METADATA_2026 } from "./league-settings.js?v=886f353394";
import { mergeBidHistory, normalizeBidHistory, normalizeWatchlist, warRoomStorageKey } from "./war-room.js?v=e9eae48675";

const key = (kind, rosterId) => warRoomStorageKey(kind, { season: LEAGUE_METADATA_2026.season, leagueId: LEAGUE_METADATA_2026.leagueId, rosterId });
function read(kind, rosterId, fallback) {
  if (rosterId === undefined || rosterId === null) return fallback;
  try { return JSON.parse(localStorage.getItem(key(kind, rosterId)) ?? "null") ?? fallback; } catch { return fallback; }
}
function write(kind, rosterId, value) {
  if (rosterId === undefined || rosterId === null) return false;
  try { localStorage.setItem(key(kind, rosterId), JSON.stringify(value)); return true; } catch { return false; }
}

export const loadWatchlist = rosterId => normalizeWatchlist(read("watchlist", rosterId, []));
export function loadBidHistory(rosterId) {
  return normalizeBidHistory(read("bids", rosterId, {}));
}

/** Best effort: only a signed-in Coach session is accepted; anything else leaves the roster dirty. */
async function push(rosterId) {
  try {
    const response = await fetch("/api/coach/war-room", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rosterId: Number(rosterId), watchlist: loadWatchlist(rosterId), bidHistory: loadBidHistory(rosterId) }) });
    if (response.ok) write("dirty", rosterId, false);
    return response.ok;
  } catch { return false; }
}

function saveLocal(kind, rosterId, value) {
  const saved = write(kind, rosterId, value);
  if (saved) { write("dirty", rosterId, true); push(rosterId); }
  return saved;
}
export const saveWatchlist = (rosterId, list) => saveLocal("watchlist", rosterId, normalizeWatchlist(list));
export const saveBidHistory = (rosterId, history) => saveLocal("bids", rosterId, normalizeBidHistory(history));

/**
 * Reconciles this browser with the server copy (Coach page, signed in). Unsent local changes win
 * for the watchlist; otherwise the server copy replaces it. Bid readings are always merged.
 * Returns "PULLED" | "PUSHED" | "UNAVAILABLE".
 */
export async function syncWarRoom(rosterId) {
  let remote;
  try {
    const response = await fetch(`/api/coach/war-room?roster=${encodeURIComponent(rosterId)}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return "UNAVAILABLE";
    remote = (await response.json()).state;
  } catch { return "UNAVAILABLE"; }
  const dirty = read("dirty", rosterId, false) === true;
  const localBids = loadBidHistory(rosterId);
  const bids = mergeBidHistory(remote?.bidHistory, localBids);
  write("bids", rosterId, bids);
  const adopt = remote && !dirty;
  if (adopt) write("watchlist", rosterId, normalizeWatchlist(remote.watchlist));
  const bidsDiffer = JSON.stringify(bids) !== JSON.stringify(normalizeBidHistory(remote?.bidHistory));
  if (!adopt || bidsDiffer) return (await push(rosterId)) ? "PUSHED" : "UNAVAILABLE";
  write("dirty", rosterId, false);
  return "PULLED";
}
