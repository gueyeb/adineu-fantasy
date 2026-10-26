import { weeklyWaiverRuns } from "./acquisition-availability.js?v=795bedcaa2";

export const WAIVER_DISPLAY_TIME_ZONE = "Europe/Paris";

/** The same history-validated league rule as availability; still inference, not a posted run. */
export function buildWaiverSchedule({ waiverRules = null, asOf = null } = {}) {
  const base = { status: "UNAVAILABLE", asOf, timeZone: WAIVER_DISPLAY_TIME_ZONE, nextRunAt: null, currentRunAt: null, processingEndsAt: null };
  if (!waiverRules || waiverRules.validation?.confirmedWeeklyBatches < 2 || !Number.isFinite(waiverRules.validation?.confirmedWeeklyBatches)) return base;
  const runs = weeklyWaiverRuns({ asOf, clearDay: waiverRules.clearDay, clearTime: waiverRules.clearTime });
  if (!runs) return base;
  const processingEnd = Date.parse(runs.lastRunAt) + (waiverRules.processingMinutes || 0) * 60_000;
  const processing = Date.parse(asOf) < processingEnd;
  return { ...base, status: processing ? "PROCESSING_INFERRED" : "RULES_INFERRED", ...runs,
    currentRunAt: processing ? runs.lastRunAt : null, processingEndsAt: processing ? new Date(processingEnd).toISOString() : null,
    source: waiverRules.source, rule: { clearDay: waiverRules.clearDay, clearTime: waiverRules.clearTime }, validation: waiverRules.validation };
}

export function formatWaiverSchedule(schedule) {
  const unavailable = "Horaire de passage non vérifié — confirmer dans Sleeper.";
  if (!schedule || !["RULES_INFERRED", "PROCESSING_INFERRED"].includes(schedule.status)) return unavailable;
  const date = value => {
    if (!Number.isFinite(Date.parse(value))) return null;
    return new Intl.DateTimeFormat("fr-FR", { timeZone: WAIVER_DISPLAY_TIME_ZONE,
      weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  };
  if (schedule.status === "PROCESSING_INFERRED") {
    const start = date(schedule.currentRunAt);
    const end = date(schedule.processingEndsAt);
    return start && end ? `Traitement estimé depuis ${start} ; fin estimée ${end} (Europe/Paris). Confirmer dans Sleeper.` : unavailable;
  }
  const next = date(schedule.nextRunAt);
  return next ? `Prochain passage estimé : ${next} (Europe/Paris), déduit des règles et de l’historique. Confirmer dans Sleeper.` : unavailable;
}
