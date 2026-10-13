/**
 * Adineu Fantasy — stockage serveur du Waiver War Room (docs/prd-waiver-war-room.md).
 * Une ligne Supabase par saison / ligue / roster, lue et écrite avec la clé secrète uniquement
 * (table sans policy publique). Tout ce qui entre est renormalisé : le navigateur n'est pas cru.
 */
import { LEAGUE_METADATA_2026 } from "../public/assets/league-settings.js";
import { normalizeBidHistory, normalizeWatchlist } from "../public/assets/war-room.js";
import { createSupabaseFromEnv } from "./model-tracking.js";

const TABLE = "coach_war_room";

export function createWarRoomStore({ getSupabase = createSupabaseFromEnv, season = LEAGUE_METADATA_2026.season, leagueId = LEAGUE_METADATA_2026.leagueId } = {}) {
  let client = null;
  const supabase = async () => (client ||= await getSupabase());
  const key = rosterId => ({ season, league_id: String(leagueId), roster_id: rosterId });
  return {
    async load(rosterId) {
      const { data, error } = await (await supabase()).from(TABLE).select("watchlist, bid_history, updated_at").match(key(rosterId)).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { watchlist: normalizeWatchlist(data.watchlist), bidHistory: normalizeBidHistory(data.bid_history), updatedAt: data.updated_at } : null;
    },
    async save(rosterId, { watchlist, bidHistory }) {
      const row = { ...key(rosterId), watchlist: normalizeWatchlist(watchlist), bid_history: normalizeBidHistory(bidHistory), updated_at: new Date().toISOString() };
      const { error } = await (await supabase()).from(TABLE).upsert(row, { onConflict: "season,league_id,roster_id" });
      if (error) throw new Error(error.message);
      return { watchlist: row.watchlist, bidHistory: row.bid_history, updatedAt: row.updated_at };
    }
  };
}
