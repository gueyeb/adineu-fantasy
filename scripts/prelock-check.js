#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { buildPrelockCheck } from "../public/assets/prelock-check.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";
import { diagnoseLineup, compareWithOptimalLineup, formatReplacement } from "./lineup-advisor.js";
import { getLeagueContext, getInjuryStatuses, getWeeklyProjections, getSchedule, getFreeAgents } from "./league-context.js";

export async function getPrelockCheck({ team = process.env.COACH_TEAM || "t0z", now = new Date(),
  getContext = getLeagueContext, getStatuses = getInjuryStatuses, getProjections = getWeeklyProjections,
  loadSchedule = getSchedule, loadFreeAgents = getFreeAgents } = {}) {
  const context = await getContext({ team });
  const [playerStatuses, projections, schedule, market] = await Promise.all([
    getStatuses({ forceRefresh: true }), getProjections({ week: context.week, maxAgeMs: 0 }),
    loadSchedule({ season: String(context.season || 2026) }), loadFreeAgents({ team, limitPerPosition: 5 })
  ]);
  return buildPrelockCheck({ week: context.week, myTeam: context.myTeam, playerStatuses, projections, schedule, now,
    byeWeeks: BYE_WEEKS_2026, freeAgentsByPosition: market.byPosition }, { diagnoseLineup, compareWithOptimalLineup, formatReplacement });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const team = args.find(arg => arg.startsWith("--team="))?.slice(7) || process.env.COACH_TEAM || "t0z";
  getPrelockCheck({ team }).then(report => console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : report.message))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
