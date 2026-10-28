/**
 * Change-only Coach bulletin (QC-03): what changed since the last bulletin sent, instead of the
 * whole report every time. Pure functions; the previous state is read/written by the caller.
 *
 * Meaningful = a decision's action or presentation state changed, a blocker was lifted, a role
 * signal changed, a new lineup move appeared, the plan's publishability changed, or a proposed
 * lineup move involves a game kicking off soon. Gains moving by a few tenths are not a change.
 */
import { teamOwnerLabel } from "../public/assets/manager-identity.js";
import { classifyCompactWaiverPresentation } from "../public/assets/waiver-decision-view.js";

export const NEAR_KICKOFF_MS = 3 * 60 * 60 * 1000;
const ACTIONS = ["ADD_NOW", "CLAIM_IF_CHEAP"];
const BUCKET_LABEL = { now: "action possible maintenant", prepare: "à préparer", watch: "à surveiller" };

const slotKey = change => `${change.slot}|${change.in?.sleeperId ?? "-"}|${change.out?.sleeperId ?? "-"}`;

/** The few facts compared from one bulletin to the next, from the plan already computed. */
export function coachDecisionState(plan, { now = Date.now() } = {}) {
  const decisions = {};
  const add = (row, source) => {
    const id = String(row.playerId ?? row.sleeperId ?? "");
    if (!id || decisions[id]) return;
    const presentation = classifyCompactWaiverPresentation(row, { asOf: plan.availabilityAsOf, publishable: plan.publishable, now });
    decisions[id] = { name: row.name ?? null, position: row.position ?? null, nflTeam: row.nflTeam ?? null, source,
      action: row.recommendedAction ?? null, bucket: presentation.bucket, label: presentation.label,
      blockers: [...new Set([...(row.actionBlockers ?? []), ...(row.presentationFacts?.actionBlockers ?? [])])].sort(),
      bid: Number.isFinite(row.suggestedBid) ? row.suggestedBid : null,
      role: row.roleConfirmation ?? null, decisionClass: row.decisionClass ?? null };
  };
  (plan.acquisitionPlan?.steps ?? []).forEach(row => add(row, "PLAN"));
  for (const action of ACTIONS) (plan.waiverActions?.[action] ?? []).forEach(row => add(row, "ACTION"));
  (plan.watchlist ?? []).forEach(row => add(row, "WATCH"));
  const lineup = (plan.lineup?.optimal?.changes ?? []).map(change => ({ key: slotKey(change), slot: change.slot,
    in: change.in ? { id: String(change.in.sleeperId), name: change.in.name, nflTeam: change.in.nflTeam ?? null } : null,
    out: change.out ? { id: String(change.out.sleeperId), name: change.out.name, nflTeam: change.out.nflTeam ?? null } : null }));
  return { week: plan.week ?? null, capturedAt: new Date(now).toISOString(), availabilityAsOf: plan.availabilityAsOf ?? null,
    publishable: plan.publishable ?? null, decisionStatus: plan.coherence?.decisionStatus?.status ?? null,
    decisions, lineup, alerts: (plan.lineup?.alerts ?? []).map(alert => `${alert.slot}|${alert.reason}`).sort(),
    trade: plan.tradeTarget ? `${plan.tradeTarget.partnerName} · ${plan.tradeTarget.title}` : null };
}

/**
 * Events between two states. No previous state, or a new week, is a full bulletin (`reset`).
 * `kickoffOf(nflTeam)` returns the target week's kickoff in ms (or NaN when unknown).
 */
export function diffCoachStates(previous, current, { now = Date.now(), kickoffOf = () => NaN, nearKickoffMs = NEAR_KICKOFF_MS } = {}) {
  if (!previous) return { reset: "NO_PREVIOUS_STATE", events: [], notify: true, since: null };
  if (previous.week !== current.week) return { reset: "NEW_WEEK", events: [], notify: true, since: previous.capturedAt };
  const events = [];
  if (previous.publishable !== current.publishable || previous.decisionStatus !== current.decisionStatus) {
    events.push({ type: "PUBLISHABILITY_CHANGED", from: previous.decisionStatus ?? String(previous.publishable), to: current.decisionStatus ?? String(current.publishable) });
  }
  for (const [id, now_] of Object.entries(current.decisions)) {
    const before = previous.decisions?.[id];
    if (!before) {
      if (ACTIONS.includes(now_.action)) events.push({ type: "NEW_RECOMMENDATION", playerId: id, name: now_.name, action: now_.action, bucket: now_.bucket, bid: now_.bid });
      continue;
    }
    if (now_.bucket === "now" && before.bucket !== "now") events.push({ type: "NEW_ACTIONABLE", playerId: id, name: now_.name, action: now_.action, from: before.bucket });
    else if (before.action !== now_.action || before.bucket !== now_.bucket || before.bid !== now_.bid) {
      events.push({ type: "RECOMMENDATION_CHANGED", playerId: id, name: now_.name, from: { action: before.action, bucket: before.bucket, bid: before.bid }, to: { action: now_.action, bucket: now_.bucket, bid: now_.bid } });
    }
    const lifted = (before.blockers ?? []).filter(code => !now_.blockers.includes(code));
    if (lifted.length) events.push({ type: "BLOCKER_LIFTED", playerId: id, name: now_.name, lifted, remaining: now_.blockers });
    if (before.role !== now_.role || before.decisionClass !== now_.decisionClass) {
      events.push({ type: "ROLE_CHANGED", playerId: id, name: now_.name, from: { role: before.role, decisionClass: before.decisionClass }, to: { role: now_.role, decisionClass: now_.decisionClass } });
    }
  }
  for (const [id, before] of Object.entries(previous.decisions ?? {})) {
    if (!current.decisions[id] && ACTIONS.includes(before.action)) events.push({ type: "RECOMMENDATION_WITHDRAWN", playerId: id, name: before.name, action: before.action });
  }
  const previousLineup = new Set((previous.lineup ?? []).map(row => row.key));
  for (const change of current.lineup) if (!previousLineup.has(change.key)) events.push({ type: "LINEUP_CHANGED", slot: change.slot, in: change.in, out: change.out });
  const previousAlerts = new Set(previous.alerts ?? []);
  for (const alert of current.alerts) if (!previousAlerts.has(alert)) events.push({ type: "LINEUP_ALERT", alert });
  for (const change of current.lineup) {
    const kickoffs = [change.in, change.out].filter(Boolean).map(player => kickoffOf(player.nflTeam)).filter(Number.isFinite);
    const next = kickoffs.filter(time => time > now).sort((a, b) => a - b)[0];
    if (next !== undefined && next - now <= nearKickoffMs) events.push({ type: "NEAR_KICKOFF", slot: change.slot, in: change.in, out: change.out, kickoffAt: new Date(next).toISOString() });
  }
  if (previous.trade !== current.trade && current.trade) events.push({ type: "TRADE_CHANGED", trade: current.trade });
  return { reset: null, events, notify: events.length > 0, since: previous.capturedAt };
}

const parisTime = iso => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const actionLabel = action => action === "ADD_NOW" ? "ajout libre" : action === "CLAIM_IF_CHEAP" ? "claim" : action === "WATCH" ? "surveiller" : action ?? "aucune action";

function eventLine(event) {
  switch (event.type) {
    case "PUBLISHABILITY_CHANGED": return `• État du plan : ${event.from} → ${event.to}`;
    case "NEW_RECOMMENDATION": return `• Nouveau : ${event.name} · ${actionLabel(event.action)}${event.bid !== null ? ` ${event.bid} $` : ""} · ${BUCKET_LABEL[event.bucket] ?? event.bucket}`;
    case "NEW_ACTIONABLE": return `• ${event.name} devient une action possible maintenant (${actionLabel(event.action)}) — vérifier dans Sleeper`;
    case "RECOMMENDATION_CHANGED": return `• ${event.name} : ${actionLabel(event.from.action)}${event.from.bid !== null ? ` ${event.from.bid} $` : ""} (${BUCKET_LABEL[event.from.bucket] ?? event.from.bucket}) → ${actionLabel(event.to.action)}${event.to.bid !== null ? ` ${event.to.bid} $` : ""} (${BUCKET_LABEL[event.to.bucket] ?? event.to.bucket})`;
    case "RECOMMENDATION_WITHDRAWN": return `• Retiré du plan : ${event.name} (${actionLabel(event.action)})`;
    case "BLOCKER_LIFTED": return `• ${event.name} : blocage levé (${event.lifted.join(", ")})${event.remaining.length ? ` ; restent ${event.remaining.join(", ")}` : ""}`;
    case "ROLE_CHANGED": return `• ${event.name} : rôle ${event.from.role ?? "n/d"} → ${event.to.role ?? "n/d"}${event.from.decisionClass !== event.to.decisionClass ? ` · classe ${event.from.decisionClass ?? "n/d"} → ${event.to.decisionClass ?? "n/d"}` : ""}`;
    case "LINEUP_CHANGED": return `• Lineup ${event.slot} : ${event.in?.name ?? "slot vide"} à la place de ${event.out?.name ?? "slot vide"}`;
    case "LINEUP_ALERT": return `• Alerte lineup : ${event.alert.replace("|", " — ")}`;
    case "NEAR_KICKOFF": return `• ⏰ ${event.slot} : ${event.in?.name ?? "?"} / ${event.out?.name ?? "?"} — coup d’envoi ${parisTime(event.kickoffAt)} (Paris), décider avant`;
    case "TRADE_CHANGED": return `• Trade à explorer : ${event.trade}`;
    default: return `• ${event.type}`;
  }
}

/** Telegram text for a non-reset delta; `fullBulletin` is used as-is on a reset. */
export function formatCoachDelta(delta, { team, owner = null, week, fullBulletin, pageUrl = null }) {
  if (delta.reset) return fullBulletin;
  const header = `🧠 COACH ${teamOwnerLabel(String(team).toUpperCase(), owner)}`;
  const since = delta.since ? parisTime(delta.since) : "le dernier bulletin";
  if (!delta.events.length) return `${header} — S${week} : aucun changement utile depuis ${since}. Plan inchangé${pageUrl ? ` (${pageUrl})` : ""}.`;
  return [`${header} — S${week} · changements depuis ${since}`, ...delta.events.map(eventLine),
    "Gains et enchères inchangés par ce résumé ; aucune soumission automatique.", ...(pageUrl ? [`Détail : ${pageUrl}`] : [])].join("\n");
}

/** kickoffOf for diffCoachStates from the shared trade timing context (nflverse schedule). */
export function kickoffLookup(timingContext, week) {
  const games = (timingContext?.games ?? []).filter(game => game.week === week && (timingContext.season == null || game.season === timingContext.season));
  return nflTeam => {
    const matches = games.filter(game => [game.home_team, game.away_team].includes(nflTeam));
    return matches.length === 1 ? Date.parse(matches[0].kickoffAt) : NaN;
  };
}
