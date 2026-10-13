/**
 * Adineu Fantasy — Waiver War Room (docs/prd-waiver-war-room.md).
 * The review loop between "spotted during the games" and "entered in Sleeper": a user-curated,
 * dated watchlist, the claims competing for one cut, bid revisions and the order to type in.
 * Pure and read-only: no DOM, no network, nothing is ever submitted.
 */
export const WATCHLIST_LIMIT = 40;
export const REASON_MAX = 200;
const HISTORY_POINTS = 6;
const HISTORY_DAYS = 21;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ACTIONABLE = new Set(["ADD_NOW", "CLAIM_IF_CHEAP"]);

export const warRoomStorageKey = (kind, { season, leagueId, rosterId }) => `adineu:war-room-${kind}:${season}:${leagueId}:${rosterId}`;

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const money = value => Number.isFinite(value) ? value : null;

/** Explicit user entries only: dated, with a reason, bounded. Newest first. */
export function normalizeWatchlist(input) {
  if (!Array.isArray(input)) return [];
  const byId = new Map();
  for (const row of input) {
    const playerId = String(row?.playerId ?? "");
    const reason = text(row?.reason, REASON_MAX);
    if (!PLAYER_ID.test(playerId) || !reason || !Number.isFinite(Date.parse(row.addedAt)) || byId.has(playerId)) continue;
    byId.set(playerId, { playerId, name: text(row.name, 80) || playerId, position: text(row.position, 8) || null,
      addedAt: new Date(Date.parse(row.addedAt)).toISOString(), week: Number.isInteger(row.week) ? row.week : null, reason });
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).slice(0, WATCHLIST_LIMIT);
}

/** Adding a player already followed keeps the original date and replaces the reason. */
export function addToWatchlist(list, player, { reason, now, week = null }) {
  const current = normalizeWatchlist(list);
  const playerId = String(player?.playerId ?? player?.sleeperId ?? "");
  const existing = current.find(row => row.playerId === playerId);
  return normalizeWatchlist([{ playerId, name: player?.name, position: player?.position,
    addedAt: existing?.addedAt ?? now, week: existing?.week ?? week, reason },
    ...current.filter(row => row.playerId !== playerId)]);
}

export const removeFromWatchlist = (list, playerId) => normalizeWatchlist(list).filter(row => row.playerId !== String(playerId));

/** Only ids travel to the server; reasons and dates stay in the browser. */
export const watchIdsHeader = list => normalizeWatchlist(list).map(row => row.playerId).join(",");
export function parseWatchIds(header) {
  if (typeof header !== "string") return [];
  return [...new Set(header.split(",").map(id => id.trim()).filter(id => PLAYER_ID.test(id)))].slice(0, WATCHLIST_LIMIT);
}

function collectLines({ rows, acquisitionPlan }) {
  const lines = new Map();
  const put = line => { if (!lines.has(line.playerId)) lines.set(line.playerId, line); return lines.get(line.playerId); };
  (acquisitionPlan?.steps ?? []).forEach((step, index) => put({ playerId: String(step.playerId), name: step.name, position: step.position,
    action: step.recommendedAction, role: "PLAN", planIndex: index, fallbackOf: null, bid: money(step.suggestedBid), maxBid: money(step.personalMaxBid),
    drop: step.dropCandidate ?? null, weeklyDeltas: step.weeklyLineupDeltas ?? [], netGainTotal: step.netGainTotal ?? null,
    horizonWeeks: step.horizonWeeks ?? null, availability: step.availability ?? null }));
  for (const group of acquisitionPlan?.alternativeClaimGroups ?? []) {
    for (const claim of group.claims.slice(1)) put({ playerId: String(claim.playerId), name: claim.name, position: claim.position,
      action: claim.recommendedAction, role: "FALLBACK", planIndex: null, fallbackOf: String(group.primaryPlayerId), bid: money(claim.suggestedBid),
      maxBid: money(claim.personalMaxBid), drop: claim.dropCandidate ?? group.dropCandidate ?? null, weeklyDeltas: [],
      netGainTotal: claim.netGainTotal ?? null, horizonWeeks: claim.horizonWeeks ?? null, availability: claim.availability ?? null });
  }
  for (const row of rows ?? []) {
    const playerId = String(row.sleeperId);
    const known = lines.get(playerId);
    // The plan recalculates each step on the assumed roster: its numbers win over the standalone row.
    if (known) { if (!known.weeklyDeltas.length) known.weeklyDeltas = row.weeklyLineupDeltas ?? []; known.nflTeam = row.nflTeam ?? null; continue; }
    put({ playerId, name: row.name, position: row.position, nflTeam: row.nflTeam ?? null, action: row.recommendedAction ?? null, role: "OUT_OF_PLAN",
      planIndex: null, fallbackOf: null, bid: money(row.suggestedBid),
      // An undetermined ceiling is not a founded 0 $.
      maxBid: row.maxBidStatus && row.maxBidStatus !== "DETERMINED" ? null : money(row.maxForTeam), drop: row.dropCandidate ?? null,
      weeklyDeltas: row.weeklyLineupDeltas ?? [], netGainTotal: row.netGainTotal ?? null, horizonWeeks: row.horizonWeeks ?? null,
      availability: row.availability ?? null, note: row.note ?? row.interpretation ?? null });
  }
  return lines;
}

/** Latest reading taken before the last completed week of games, else the first one on the same data. */
function reviseBid(line, points, dataThroughWeek) {
  const valid = (points ?? []).filter(point => Number.isFinite(Date.parse(point?.at)));
  const earlier = Number.isInteger(dataThroughWeek) ? valid.filter(point => Number.isInteger(point.dataThroughWeek) && point.dataThroughWeek < dataThroughWeek) : [];
  const before = earlier.at(-1) ?? valid[0] ?? null;
  if (!before) return null;
  const delta = (now, then) => Number.isFinite(now) && Number.isFinite(then) ? now - then : null;
  return { basis: earlier.length ? "BEFORE_LAST_GAMES" : "SAME_DATA", at: before.at, dataThroughWeek: before.dataThroughWeek ?? null,
    bidBefore: money(before.bid), maxBefore: money(before.max), bidDelta: delta(line.bid, before.bid), maxDelta: delta(line.maxBid, before.max),
    changed: money(before.bid) !== line.bid || money(before.max) !== line.maxBid };
}

/** Appends a reading when a line's bid, ceiling or data week changed. Returns a new history. */
export function recordBids(history, lines, { now, dataThroughWeek = null }) {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) return history ?? {};
  const cutoff = at - HISTORY_DAYS * 86_400_000;
  const next = {};
  for (const [id, points] of Object.entries(history && typeof history === "object" ? history : {})) {
    const kept = (Array.isArray(points) ? points : []).filter(point => Date.parse(point?.at) >= cutoff);
    if (PLAYER_ID.test(id) && kept.length) next[id] = kept;
  }
  for (const line of lines) {
    const points = next[line.playerId] ?? [];
    const last = points.at(-1);
    if (last && money(last.bid) === line.bid && money(last.max) === line.maxBid && (last.dataThroughWeek ?? null) === dataThroughWeek) continue;
    next[line.playerId] = [...points, { at: new Date(at).toISOString(), dataThroughWeek, bid: line.bid, max: line.maxBid }].slice(-HISTORY_POINTS);
  }
  return next;
}

/**
 * @param watchlist user entries (browser) · rows/missing: server evaluation of those ids
 * @param history   previous readings from recordBids — read before recording the current one
 */
export function buildWarRoom({ watchlist = [], rows = [], missing = [], acquisitionPlan = null, history = {}, week = null, dataThroughWeek = null }) {
  const entries = normalizeWatchlist(watchlist);
  const lineById = collectLines({ rows, acquisitionPlan });
  const lines = [...lineById.values()].map(line => ({ ...line, revision: reviseBid(line, history?.[line.playerId], dataThroughWeek) }));
  const byId = new Map(lines.map(line => [line.playerId, line]));
  const missingById = new Map(missing.map(row => [String(row.playerId), row]));

  const watch = entries.map(entry => {
    const line = byId.get(entry.playerId) ?? null;
    const gone = missingById.get(entry.playerId);
    return { ...entry, line, rosteredBy: gone?.teamName ?? null,
      state: line ? ({ PLAN: "IN_PLAN", FALLBACK: "FALLBACK" })[line.role] ?? "EVALUATED" : gone?.status ?? "NOT_EVALUATED" };
  });

  const groups = new Map();
  for (const line of lines) {
    if (!line.drop?.sleeperId || !(line.role !== "OUT_OF_PLAN" || ACTIONABLE.has(line.action))) continue;
    const key = String(line.drop.sleeperId);
    if (!groups.has(key)) groups.set(key, { dropPlayerId: key, dropName: line.drop.name ?? key, lines: [] });
    groups.get(key).lines.push(line);
  }
  const roleRank = { PLAN: 0, FALLBACK: 1, OUT_OF_PLAN: 2 };
  const cutGroups = [...groups.values()].map(group => {
    const ordered = group.lines.sort((a, b) => roleRank[a.role] - roleRank[b.role] || (b.netGainTotal ?? -Infinity) - (a.netGainTotal ?? -Infinity) || a.playerId.localeCompare(b.playerId));
    const bids = ordered.map(line => line.bid).filter(Number.isFinite);
    return { ...group, lines: ordered, competing: ordered.length > 1, maximumBid: bids.length ? Math.max(...bids) : null };
  }).sort((a, b) => Number(b.competing) - Number(a.competing) || b.lines.length - a.lines.length || a.dropName.localeCompare(b.dropName));

  const claims = [];
  const freeAdds = [];
  for (const line of lines.filter(row => row.role === "PLAN").sort((a, b) => a.planIndex - b.planIndex)) {
    if (line.action === "ADD_NOW") { freeAdds.push(line); continue; }
    claims.push({ ...line, rank: claims.length + 1, kind: "PRIMARY" });
    for (const fallback of lines.filter(row => row.role === "FALLBACK" && row.fallbackOf === line.playerId)) {
      claims.push({ ...fallback, rank: claims.length + 1, kind: "FALLBACK" });
    }
  }
  const enteredBids = claims.map(claim => claim.bid);
  const claimOrder = { week, claims, freeAdds,
    reservedFaab: acquisitionPlan?.budgetKnown ? acquisitionPlan.reservedFaab : null,
    remainingFaab: acquisitionPlan?.budgetKnown ? acquisitionPlan.remainingFaab : null,
    initialFaab: acquisitionPlan?.initialFaab ?? null,
    maximumReviewedFaabExposure: acquisitionPlan?.claimPortfolio?.maximumReviewedFaabExposure ?? null,
    // Plain sum of what is typed in: what leaves if Sleeper awards every listed claim.
    enteredBidTotal: enteredBids.length && enteredBids.every(Number.isFinite) ? enteredBids.reduce((sum, bid) => sum + bid, 0) : null,
    platformCancellationVerified: false, submitsAutomatically: false };

  return { week, dataThroughWeek, watch, lines, cutGroups, revisions: lines.filter(line => line.revision?.changed), claimOrder };
}

const amount = value => Number.isFinite(value) ? `${value} $` : "non déterminée";

/** The text typed into Sleeper, claim by claim. Read-only: it describes, it submits nothing. */
export function formatClaimOrder(warRoom) {
  const order = warRoom?.claimOrder;
  if (!order || (!order.claims.length && !order.freeAdds.length)) return "Aucun claim à saisir : le plan ne retient aucune acquisition exécutable.";
  const names = new Map(warRoom.lines.map(line => [line.playerId, line.name]));
  const lines = [`ORDRE DES CLAIMS À SAISIR DANS SLEEPER${order.week ? ` — SEMAINE ${order.week}` : ""}`];
  if (order.freeAdds.length) {
    lines.push("", "Ajouts libres (immédiats, sans FAAB) :");
    for (const add of order.freeAdds) lines.push(`• ${add.name} (${add.position}) — couper ${add.drop?.name ?? "personne (place libre)"}`);
  }
  if (order.claims.length) {
    lines.push("", "Claims waivers, dans cet ordre de priorité :");
    for (const claim of order.claims) {
      lines.push(`${claim.rank}. ${claim.name} (${claim.position}) — enchère ${amount(claim.bid)} — couper ${claim.drop?.name ?? "personne (place libre)"}` +
        (claim.kind === "FALLBACK" ? ` — repli de ${names.get(claim.fallbackOf) ?? claim.fallbackOf}, même coupe : un seul des deux` : ""));
    }
    lines.push("", order.reservedFaab === null ? "Budget FAAB inconnu : vérifier le solde avant de saisir."
      : `FAAB réservé par le plan : ${order.reservedFaab} $ · restant après : ${order.remainingFaab} $.`);
    if (order.claims.some(claim => claim.kind === "FALLBACK")) {
      lines.push(`Somme des enchères saisies : ${order.enteredBidTotal === null ? "n/d" : `${order.enteredBidTotal} $`}` +
        `${order.maximumReviewedFaabExposure === null ? "" : ` · maximum si un seul claim par coupe aboutit : ${order.maximumReviewedFaabExposure} $`}.`,
        "Annulation automatique d’un repli non vérifiée côté Sleeper : revalider après chaque résultat.");
    }
  }
  lines.push("", "Lecture seule — rien n’est soumis automatiquement.");
  return lines.join("\n");
}
