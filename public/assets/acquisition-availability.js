/** A drop never proves waiver clearance. Evidence must belong to this week and still be current. */
export function isCurrentEvidence(evidence, { asOf, week, season, leagueId } = {}) {
  const now = Date.parse(asOf);
  const observed = Date.parse(evidence?.observedAt);
  const expires = Date.parse(evidence?.expiresAt);
  return Boolean(evidence?.source && Number.isFinite(now) && Number.isFinite(observed) && observed <= now &&
    Number.isFinite(expires) && expires > now && expires > observed &&
    (week === undefined || evidence.targetWeek === week) &&
    (season === undefined || String(evidence.season) === String(season)) &&
    (leagueId === undefined || String(evidence.leagueId) === String(leagueId)));
}

/** Latest complete movement per player inside the window, kept only when it is a DROP.
 * A later ADD by any roster supersedes it. The result never proves waiver clearance. */
export function findRecentDrops(transactions, { asOf, windowHours = 72 } = {}) {
  const now = Date.parse(asOf);
  const latest = new Map();
  for (const t of transactions || []) {
    const at = Number(t.status_updated ?? t.created);
    if (t.status !== "complete" || !Number.isFinite(at) || !Number.isFinite(now) || at > now || at < now - windowHours * 3600 * 1000) continue;
    for (const [action, moves] of [["ADD", t.adds], ["DROP", t.drops]]) {
      for (const [playerId, rosterId] of Object.entries(moves || {})) {
        const previous = latest.get(playerId);
        // Within one transaction the ADD wins: the player ends up rostered.
        if (!previous || at > previous.at || (at === previous.at && action === "ADD")) latest.set(playerId, { action, at, rosterId, transactionId: t.transaction_id ?? null });
      }
    }
  }
  return new Map([...latest].filter(([, move]) => move.action === "DROP").map(([playerId, move]) =>
    [playerId, { droppedAt: new Date(move.at).toISOString(), droppedByRosterId: move.rosterId, transactionId: move.transactionId }]));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** UTC instant of a wall-clock time in an IANA zone (Intl handles daylight saving). */
function zonedInstant(day, time, timeZone) {
  const localAsUtc = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(localAsUtc)) return null;
  let offset;
  try { offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(localAsUtc)).find(part => part.type === "timeZoneName")?.value; } catch { return null; }
  const match = offset === "GMT" ? ["", "+", "00", "00"] : offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  return localAsUtc - (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1) * 60_000;
}

const SLEEPER_WAIVER_TIME_ZONE = "America/Los_Angeles";
const localParts = (at, timeZone) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", hourCycle: "h23" })
  .formatToParts(new Date(at)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));

/** Weekly waiver rule read from Sleeper's league settings, accepted only when the league's own
 * waiver history confirms it. Sleeper does not document the day numbering or the time zone, so the
 * reading (day 0 = Monday, hour in Pacific time) is a hypothesis: at least `minimumBatches` past
 * weekly batches must have processed within the hour after the derived instant, and none of the
 * large batches may contradict it. Anything else is ambiguous and returns null. */
export function deriveWaiverRules({ leagueSettings, transactions = [], minimumBatches = 2 }) {
  const s = leagueSettings || {};
  if (s.waiver_type !== 2 || s.daily_waivers !== 0 || ![s.waiver_day_of_week, s.daily_waivers_hour, s.waiver_clear_days].every(Number.isInteger) ||
      s.waiver_day_of_week < 0 || s.waiver_day_of_week > 6 || s.daily_waivers_hour < 0 || s.daily_waivers_hour > 23 || s.waiver_clear_days < 0) return null;
  const clearDay = WEEKDAYS[(s.waiver_day_of_week + 1) % 7];
  const batches = new Map();
  for (const t of transactions) {
    if (t.type !== "waiver" || t.status !== "complete" || !Number.isFinite(Number(t.status_updated))) continue;
    const key = Math.floor(Number(t.status_updated) / 3_600_000);
    batches.set(key, (batches.get(key) || 0) + 1);
  }
  // A weekly run settles several claims at once; single claims are the rolling clearance of drops.
  const weekly = [...batches].filter(([, count]) => count >= 3).map(([key]) => key * 3_600_000);
  const matches = weekly.filter(at => { const local = localParts(at, SLEEPER_WAIVER_TIME_ZONE); return local.weekday === clearDay && Number(local.hour) === s.daily_waivers_hour; });
  if (matches.length < minimumBatches || matches.length !== weekly.length) return null;
  // Results land a few minutes after the nominal hour: until then the run is in progress.
  const delays = matches.map(at => Math.max(...transactions.filter(t => t.type === "waiver" && t.status === "complete" && Math.floor(Number(t.status_updated) / 3_600_000) * 3_600_000 === at)
    .map(t => (Number(t.status_updated) - at) / 60_000)));
  const processingMinutes = Math.ceil(Math.max(...delays)) + 5;
  return { clearDay, clearTime: `${String(s.daily_waivers_hour).padStart(2, "0")}:00 ${SLEEPER_WAIVER_TIME_ZONE}`, clearDays: s.waiver_clear_days, processingMinutes,
    source: "SLEEPER_LEAGUE_SETTINGS", validation: { confirmedWeeklyBatches: matches.length, observedWeeklyBatches: weekly.length, latestConfirmedAt: new Date(Math.max(...matches)).toISOString() } };
}

/** Last and next weekly waiver runs around `asOf`, from a rule { clearDay, clearTime: "HH:MM <IANA zone>" }. */
export function weeklyWaiverRuns({ asOf, clearDay, clearTime }) {
  const now = Date.parse(asOf);
  const [time, timeZone] = String(clearTime || "").split(" ");
  const weekday = WEEKDAYS.indexOf(clearDay);
  if (!Number.isFinite(now) || weekday < 0 || !/^\d{2}:\d{2}$/.test(time || "") || !timeZone) return null;
  const runs = [];
  for (let offset = -9; offset <= 9; offset++) {
    const day = new Date(now + offset * 86_400_000);
    if (day.getUTCDay() !== weekday) continue;
    const at = zonedInstant(day.toISOString().slice(0, 10), time, timeZone);
    if (at !== null) runs.push(at);
  }
  const last = runs.filter(at => at <= now).at(-1);
  const next = runs.find(at => at > now);
  return Number.isFinite(last) && Number.isFinite(next) ? { lastRunAt: new Date(last).toISOString(), nextRunAt: new Date(next).toISOString() } : null;
}

/** Waiver state deduced from the league's rules, never observed. Three rules, each consistent with
 * this league's 2026 transaction history: (1) a player whose team has kicked off since the last
 * weekly run is locked until the next run; (2) a dropped player stays on waivers for `clearDays`;
 * (3) otherwise he is a free agent. Returns null when the schedule or the rule is missing. */
export function inferWaiverState({ nflTeam, schedule = [], asOf, recentDrop = null, waiverRules = null }) {
  const now = Date.parse(asOf);
  const runs = waiverRules ? weeklyWaiverRuns({ asOf, clearDay: waiverRules.clearDay, clearTime: waiverRules.clearTime }) : null;
  if (!runs || !nflTeam || !schedule.length || !Number.isFinite(now)) return null;
  const kickoffs = schedule.filter(game => [game.away_team, game.home_team].includes(nflTeam)).map(game => Date.parse(game.kickoffAt)).filter(at => Number.isFinite(at) && at <= now);
  // During the minutes the run takes, its results are not published: nobody is declared free yet.
  const processingUntil = Date.parse(runs.lastRunAt) + (Number.isFinite(waiverRules.processingMinutes) ? waiverRules.processingMinutes : 0) * 60_000;
  const processing = now < processingUntil;
  const reference = processing ? Date.parse(runs.lastRunAt) - 7 * 86_400_000 : Date.parse(runs.lastRunAt);
  const lockedByGame = kickoffs.length > 0 && Math.max(...kickoffs) > reference;
  const dropClearsAt = recentDrop && Number.isFinite(waiverRules.clearDays) ? Date.parse(recentDrop.droppedAt) + waiverRules.clearDays * 86_400_000 : null;
  const lockedByDrop = Number.isFinite(dropClearsAt) && dropClearsAt > now;
  const processesAt = Math.max(lockedByGame ? (processing ? processingUntil : Date.parse(runs.nextRunAt)) : 0, lockedByDrop ? dropClearsAt : 0);
  return { availability: lockedByGame || lockedByDrop ? "WAIVER_LOCKED" : "FREE_AGENT",
    waiverProcessesAt: processesAt ? new Date(processesAt).toISOString() : null,
    processing: processing && lockedByGame,
    rule: lockedByGame && processing ? "WEEKLY_RUN_IN_PROGRESS" : lockedByGame ? "KICKOFF_SINCE_LAST_WEEKLY_RUN" : lockedByDrop ? "RECENT_DROP_CLEAR_DAYS" : "CLEARED_AT_LAST_WEEKLY_RUN",
    lastRunAt: runs.lastRunAt, nextRunAt: runs.nextRunAt, approximate: true };
}

export function resolveAcquisitionAvailability({ playerId, rosters, evidence = {}, kickoffAt = null, kickoffSource = null, asOf, week, season, leagueId, latestTransactionAt = null, recentDrop = null,
  nflTeam = null, schedule = null, waiverRules = null }) {
  const owner = rosters.find(roster => (roster.players || []).map(String).includes(String(playerId)));
  const current = isCurrentEvidence(evidence, { asOf, week, season, leagueId }) &&
    (!latestTransactionAt || Date.parse(evidence.observedAt) >= Number(latestTransactionAt));
  const kickoffValue = kickoffAt || (current ? evidence.kickoffAt : null);
  // An observation made before the team's latest kickoff describes a state that game has ended.
  const lastKickoff = nflTeam && schedule ? Math.max(0, ...schedule.filter(game => [game.away_team, game.home_team].includes(nflTeam))
    .map(game => Date.parse(game.kickoffAt)).filter(at => Number.isFinite(at) && at <= Date.parse(asOf))) : 0;
  const supersededByKickoff = current && lastKickoff > Date.parse(evidence.observedAt);
  const kickoff = Date.parse(kickoffValue);
  const now = Date.parse(asOf);
  const observed = current && !supersededByKickoff && ["FREE_AGENT", "WAIVER_LOCKED"].includes(evidence.availability);
  const gameLocked = Number.isFinite(kickoff) && kickoff <= now;
  // Operator evidence wins; without it the league's own waiver rules give a deduced state.
  const inferred = owner || observed ? null : inferWaiverState({ nflTeam, schedule: schedule || [], asOf, recentDrop, waiverRules });
  const processesValue = observed && evidence.waiverProcessesAt ? evidence.waiverProcessesAt : inferred?.waiverProcessesAt ?? null;
  const processes = Date.parse(processesValue);
  const availability = owner ? "ROSTERED" : gameLocked ? "GAME_LOCKED" : observed ? evidence.availability : inferred?.availability ?? "UNKNOWN";
  const availabilitySource = owner ? "CURRENT_OWNERSHIP" : gameLocked ? "SCHEDULE" : observed ? "OPERATOR_EVIDENCE" : inferred ? "LEAGUE_RULES_INFERRED" : "NONE";
  const canAddNow = availability === "FREE_AGENT";
  const canStartTargetWeek = owner || availability === "GAME_LOCKED" ? false : Number.isFinite(kickoff)
    ? canAddNow ? true : availability === "WAIVER_LOCKED" && Number.isFinite(processes) ? processes > now && processes < kickoff : null : null;
  const coverageIssues = [];
  if (availability === "UNKNOWN") coverageIssues.push("WAIVER_STATE_UNVERIFIED");
  if (availabilitySource === "LEAGUE_RULES_INFERRED") coverageIssues.push("AVAILABILITY_INFERRED_NOT_VERIFIED");
  if (!Number.isFinite(kickoff)) coverageIssues.push("KICKOFF_UNVERIFIED");
  if (availability === "WAIVER_LOCKED" && (!Number.isFinite(processes) || processes <= now)) coverageIssues.push("WAIVER_PROCESSING_UNVERIFIED");
  // A recent cut is a reason to analyse the player, never a proof that he can be added.
  const unclearedDrop = !owner && recentDrop && availability !== "FREE_AGENT" ? recentDrop : null;
  if (unclearedDrop && availability !== "WAIVER_LOCKED" && !inferred) coverageIssues.push("RECENT_DROP_CLEARANCE_UNVERIFIED");
  return { availability, availabilitySource, verified: availabilitySource !== "LEAGUE_RULES_INFERRED" && availabilitySource !== "NONE",
    inference: inferred ? { rule: inferred.rule, processing: inferred.processing, lastRunAt: inferred.lastRunAt, nextRunAt: inferred.nextRunAt, rulesSource: waiverRules?.source ?? null, approximate: true } : null, recentDrop: owner ? null : recentDrop ?? null, ownerRosterId: owner?.roster_id ?? null, ownerId: owner?.owner_id ?? null, canAddNow, canStartTargetWeek,
    waiverProcessesAt: processesValue, waiverProcessesAtSource: processesValue ? (observed && evidence.waiverProcessesAt ? "OPERATOR_EVIDENCE" : "LEAGUE_RULES_INFERRED") : null, kickoffAt: Number.isFinite(kickoff) ? kickoffValue : null,
    kickoffSource: kickoffSource || (current && evidence.kickoffAt ? evidence.source : null), availabilityAsOf: asOf,
    evidence: current ? [evidence] : [], coverageIssues };
}

export function resolveRoleEvidence(evidence, context) {
  if (!isCurrentEvidence(evidence, context) || evidence.roleConfirmation !== "CONFIRMED" || !evidence.announcedRole) {
    return { roleConfirmation: "UNCONFIRMED", evidence: [], announcedRole: null };
  }
  return { roleConfirmation: "CONFIRMED", evidence: [evidence], announcedRole: evidence.announcedRole,
    roleWeeks: Number.isInteger(evidence.roleWeeks) && evidence.roleWeeks > 0 ? evidence.roleWeeks : null };
}

export function summarizeRecentTransactions(transactions, { asOf, relevantIds = new Set(), limit = 30, playerMeta = () => null, rosterMeta = () => null, rosters = [], availabilityOf = () => null } = {}) {
  const cutoff = Date.parse(asOf) - 72 * 3600 * 1000;
  const recent = [...new Map(transactions.map(t => [t.transaction_id, t])).values()]
    .filter(t => Number(t.status_updated ?? t.created) >= cutoff && Number(t.status_updated ?? t.created) <= Date.parse(asOf))
    .sort((a, b) => Number(b.status_updated ?? b.created) - Number(a.status_updated ?? a.created));
  return { recentTransactions: recent.slice(0, limit).map(t => ({ ...t,
    movements: ['ADD', 'DROP'].flatMap(action => Object.entries(action === 'ADD' ? t.adds || {} : t.drops || {}).map(([playerId, rosterId]) => {
      const player = playerMeta(playerId);
      const identity = rosterMeta(rosterId);
      const owner = rosters.find(roster => (roster.players || []).some(id => String(id) === playerId));
      return { action, playerId, playerName: player?.name ?? null, rosterId,
        teamName: identity?.teamName ?? null, manager: identity?.manager ?? null,
        status: t.status ?? 'UNKNOWN', currentOwnerRosterId: owner?.roster_id ?? null,
        availability: owner ? 'ROSTERED' : availabilityOf(playerId)?.availability ?? 'UNKNOWN',
        availabilitySource: owner ? 'CURRENT_OWNERSHIP' : availabilityOf(playerId)?.availabilitySource ?? 'NONE' };
    })),
    relevant: [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})].some(id => relevantIds.has(id)) })), transactionsTruncated: recent.length > limit, transactionsTruncatedCount: Math.max(0, recent.length - limit) };
}

export function formatRecentTransactions(transactions) {
  return transactions.flatMap(t => (t.movements || []).map(m =>
    `${m.playerName || `UNKNOWN player #${m.playerId}`} → ${m.action} par ${m.teamName || `UNKNOWN roster #${m.rosterId}`} (${m.manager || 'UNKNOWN manager'}) [${m.status}] · disponibilité actuelle : ${m.availability}${m.availabilitySource === 'LEAGUE_RULES_INFERRED' ? ' (déduite des règles de la ligue)' : ''}`));
}

/** Next week's horizon for one NFL team from the loaded schedule: known only when that week is
 * actually present in it. A bye is a known horizon with no kickoff. */
export function nextWeekHorizon({ schedule = [], week, nflTeam }) {
  const startWeek = week + 1;
  const games = schedule.filter(game => game.week === startWeek);
  if (!games.length || !nflTeam) return null;
  const game = games.find(row => [row.away_team, row.home_team].includes(nflTeam));
  return { startWeek, firstKickoffAt: game?.kickoffAt ?? null, bye: !game, source: (game ?? games[0]).source ?? null };
}
