/** Browser persistence of the Waiver War Room: one watchlist and one bid history per roster.
 * localStorage only — the server stays stateless. Every access tolerates a blocked storage. */
import { LEAGUE_METADATA_2026 } from "./league-settings.js?v=f6d1bf5212";
import { normalizeWatchlist, warRoomStorageKey } from "./war-room.js?v=8e9a1e2448";

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
export const saveWatchlist = (rosterId, list) => write("watchlist", rosterId, normalizeWatchlist(list));
export function loadBidHistory(rosterId) {
  const history = read("bids", rosterId, {});
  return history && typeof history === "object" && !Array.isArray(history) ? history : {};
}
export const saveBidHistory = (rosterId, history) => write("bids", rosterId, history);
