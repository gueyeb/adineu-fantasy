import { leaguePoints, LEADER_POSITIONS } from "./weekly-leaders.js?v=0a2bab24a3";
import { boomBust } from "./boom-bust.js?v=25ff15b13a";
import { matchupFor } from "./defense-vs-position.js?v=aa50fb77c1";
import { buildTiers } from "./value-tiers.js?v=32f5359873";

export const RANKINGS_LIMITS = { QB: 24, RB: 48, WR: 60, TE: 24, K: 16, DEF: 16, FLEX: 100 };
const ABSENT = new Set(["Out", "IR", "PUP", "Sus", "NA", "NFI"]);

/** League-wide pregame rankings. Unknown projections remain unranked, after priced rows. */
export function buildWeeklyRankings({ players = new Map(), projections = {}, scoring, statuses = new Map(), owners = new Map(), opponents = new Map(), dvp = { byDefense: new Map() }, calibration, byeWeeks = {}, week, limits = {} }) {
  const rows = [];
  for (const [sleeperId, player] of players instanceof Map ? players : Object.entries(players)) {
    if (!LEADER_POSITIONS.includes(player.position) || (!projections[sleeperId] && !owners.has(sleeperId))) continue;
    const injuryStatus = statuses.get(sleeperId) ?? player.injuryStatus ?? null;
    const bye = byeWeeks[player.nflTeam] === week;
    const unavailable = bye || ABSENT.has(injuryStatus);
    const projection = unavailable ? 0 : leaguePoints(projections[sleeperId], scoring);
    const owner = owners.get(sleeperId);
    const distribution = boomBust({ position: player.position, projection, injuryStatus: unavailable ? "Out" : injuryStatus,
      calibration: calibration?.positions ?? calibration, volatility: calibration?.volatility?.[sleeperId] ?? 1 });
    const matchup = matchupFor({ team: player.nflTeam, position: player.position, week, opponents, dvp });
    if (!matchup.opponent && !bye) matchup.label = "INCONNU";
    rows.push({ sleeperId, name: player.name, position: player.position, nflTeam: player.nflTeam ?? null,
      holder: owner?.teamName ?? null, holderRosterId: owner?.rosterId ?? null, projection,
      floor: distribution?.floor ?? null, ceiling: distribution?.ceiling ?? null,
      boomPct: distribution?.boomPct ?? null, bustPct: distribution?.bustPct ?? null,
      matchup,
      injuryStatus: bye ? "BYE" : injuryStatus });
  }
  const rank = (pool, position) => {
    const sorted = buildTiers([...pool].sort((a, b) => a.name.localeCompare(b.name) || a.sleeperId.localeCompare(b.sleeperId)), { value: row => row.projection });
    let previous = null;
    let place = null;
    return sorted.map((row, index) => {
      if (Number.isFinite(row.projection) && (place === null || row.projection !== previous)) place = index + 1;
      previous = row.projection;
      return { ...row, rank: Number.isFinite(row.projection) ? place : null };
    }).flatMap((row, index) => index < (limits[position] ?? RANKINGS_LIMITS[position]) ? [row]
      // Rostered players past the cut stay available (with their real rank) for per-team views only.
      : row.holderRosterId !== null ? [{ ...row, beyondLimit: true }] : []);
  };
  return { week, byPosition: Object.fromEntries(LEADER_POSITIONS.map(position => [position, rank(rows.filter(row => row.position === position), position)])),
    flex: rank(rows.filter(row => ["RB", "WR", "TE"].includes(row.position)), "FLEX") };
}
