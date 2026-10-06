#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeTrades, formatTradeBulletin, loadPlayerValues } from "./scripts/analyze-trades.js";
import {
  getLeagueContext,
  getMatchupContext as getMatchupContextDefault,
  formatContextText,
  getFreeAgents as getFreeAgentsDefault,
  getWeeklyProjections as getWeeklyProjectionsDefault,
  getUsageReport as getUsageReportDefault,
  formatWaiverReport
} from "./scripts/league-context.js";
import {
  getInjuryStatuses as getInjuryStatusesDefault,
  diagnoseLineup,
  compareWithOptimalLineup,
  getStartSit as getStartSitDefault,
  formatLineupAdvisory
} from "./scripts/lineup-advisor.js";
import {
  LEAGUE_METADATA_2026,
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026,
  BYE_WEEKS_2026
} from "./public/assets/league-settings.js";
import { getPlayoffDecisionContext } from "./scripts/playoff-context.js";
import { buildCoachPlan, formatCoachPlan, normalizeCoachPreferences } from "./scripts/coach-assistant.js";
import { buildDecisionContext, formatDecisionContext } from "./scripts/ai-context.js";
import { createCoachAuth } from "./scripts/coach-auth.js";
import { createSupabaseFromEnv, getLatestFeedback, runWeeklyJob } from "./scripts/model-tracking.js";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL("./public", import.meta.url));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

/** Automated senders (n8n) must never forward a report that failed its coherence checks.
 * 409 with no `message`: there is nothing to forward. `notice` says why, for an error branch.
 * An absent verdict (no roster context) is not a refusal. Returns true when the response was sent. */
function refuseUnpublishable(response, coherence) {
  if (coherence?.publishable !== false) return false;
  const blocking = (coherence.warnings || []).filter(row => row.category === "CALCULATION_INCONSISTENCY");
  sendJson(response, 409, { error: "REPORT_NOT_PUBLISHABLE", publishable: false, message: null,
    notice: `Bulletin Adineu retenu : ${blocking.length} incohérence(s) de calcul (${blocking.map(row => row.code).join(", ") || "n/d"}). Aucun envoi.`,
    coherence });
  return true;
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(payload);
}

function resolvePublicPath(publicRoot, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath.endsWith("/") ? `${decodedPath}index.html` : decodedPath;
  const filePath = resolve(publicRoot, `.${requestedPath}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) return null;
  return filePath;
}

export function createAppServer({
  publicRoot = DEFAULT_PUBLIC_ROOT,
  analyze = analyzeTrades,
  getContext = getLeagueContext,
  getPlayoffContext = getContext === getLeagueContext ? getPlayoffDecisionContext : async () => null,
  getFreeAgents = getFreeAgentsDefault,
  getInjuryStatuses = getInjuryStatusesDefault,
  getProjections = getWeeklyProjectionsDefault,
  getUsage = getUsageReportDefault,
  getPlayerValues = loadPlayerValues,
  getStartSit = getStartSitDefault,
  getMatchupContext = getMatchupContextDefault,
  modelJobToken = process.env.MODEL_JOB_TOKEN || "",
  runModelJob = async () => runWeeklyJob({ supabase: await createSupabaseFromEnv() }),
  getModelFeedback = () => getLatestFeedback(),
  coachToken = process.env.COACH_API_TOKEN || "",
  coachPassword = process.env.COACH_WEB_PASSWORD || "",
  secureCookies = process.env.NODE_ENV !== "development"
} = {}) {
  const coachAuth = createCoachAuth({ password: coachPassword, secure: secureCookies });
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/coach/") || url.pathname.startsWith("/api/coach")) {
      response.setHeader("x-robots-tag", "noindex, nofollow");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
    if (url.pathname === "/api/coach-session" && request.method === "POST") {
      if (!coachAuth.enabled) return sendJson(response, 503, { error: "Accès privé non configuré." });
      const origin = request.headers.origin;
      if (!origin || !URL.canParse(origin) || new URL(origin).host !== request.headers.host) return sendJson(response, 403, { error: "Forbidden" });
      if (url.searchParams.get("logout") === "1") {
        response.setHeader("set-cookie", coachAuth.logout(request.headers.cookie));
        return sendJson(response, 200, { ok: true });
      }
      try {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) return sendJson(response, 413, { error: "Payload too large" });
        }
        const result = coachAuth.login(JSON.parse(body).password, request.socket.remoteAddress);
        if (result.cookie) response.setHeader("set-cookie", result.cookie);
        if (result.status === 429) response.setHeader("retry-after", "900");
        return sendJson(response, result.status, { ok: result.status === 200 });
      } catch {
        return sendJson(response, 400, { error: "Invalid request" });
      }
    }
    // Weekly model tracking job (n8n, Tuesday): feedback on the completed week + snapshot.
    if (url.pathname === "/api/model/weekly" && request.method === "POST") {
      if (!modelJobToken) return sendJson(response, 503, { error: "MODEL_JOB_TOKEN non configuré." });
      const expected = Buffer.from(`Bearer ${modelJobToken}`);
      const received = Buffer.from(request.headers.authorization || "");
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return sendJson(response, 401, { error: "Unauthorized" });
      try {
        const result = await runModelJob();
        return sendJson(response, 200, result);
      } catch (error) {
        // Missing server configuration is a 503 with a clear message (Cloudflare masks origin 502s).
        const misconfigured = /requis|Cannot find package/.test(error.message);
        return sendJson(response, misconfigured ? 503 : 500, { error: error.message });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname === "/api/trades") {
      try {
        const analysis = await analyze({ team: url.searchParams.get("team") || "t0z" });
        sendJson(response, 200, { ...analysis, message: formatTradeBulletin(analysis) });
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/context") {
      try {
        const team = url.searchParams.get("team") || "t0z";
        const mode = url.searchParams.get("mode") || "decision";
        if (!["compact", "decision"].includes(mode)) {
          sendJson(response, 400, { error: "Mode inconnu. Valeurs acceptées : compact, decision." });
          return;
        }
        const compactContext = await getContext({ team });
        let context = compactContext;
        let message = formatContextText(compactContext);
        if (mode === "decision") {
          const playerIds = [
            ...compactContext.myTeam.starters.map(entry => entry.player?.sleeperId),
            ...compactContext.myTeam.bench.map(player => player.sleeperId),
            ...compactContext.myTeam.ir.map(player => player.sleeperId)
          ].filter(Boolean);
          const [valuesResult, statusesResult, waiversResult, matchupResult, playoffResult] = await Promise.allSettled([
            getPlayerValues({ week: compactContext.week, playerIds }),
            getInjuryStatuses(),
            getFreeAgents({ team, limitPerPosition: 5 }),
            getMatchupContext({ team, week: compactContext.week }),
            getPlayoffContext({ week: compactContext.week, rosterId: compactContext.myTeam.rosterId, leagueId: compactContext.league.id })
          ]);
          const playerValues = valuesResult.status === "fulfilled" ? valuesResult.value : { byId: new Map(), weeklyProjections: {} };
          const statuses = statusesResult.status === "fulfilled" ? statusesResult.value : new Map();
          const waivers = waiversResult.status === "fulfilled" ? waiversResult.value : null;
          const matchup = matchupResult.status === "fulfilled" ? matchupResult.value : null;
          const lineup = diagnoseLineup({
            myTeam: compactContext.myTeam,
            playerStatuses: statuses,
            freeAgentsByPosition: waivers?.byPosition || {},
            byeWeeks: BYE_WEEKS_2026,
            currentWeek: compactContext.week
          });
          try {
            lineup.optimal = compareWithOptimalLineup({
              myTeam: compactContext.myTeam,
              projections: playerValues.weeklyProjections || {},
              playerStatuses: statuses
            });
          } catch { lineup.optimal = null; }
          context = buildDecisionContext({ context: compactContext, playerValues, statuses, waivers, lineup, matchup, playoffContext: playoffResult.status === "fulfilled" ? playoffResult.value : { ready: false, reason: "SOURCE_UNAVAILABLE" } });
          message = formatDecisionContext(context);
        }
        if (url.searchParams.get("requirePublishable") === "1" && refuseUnpublishable(response, context.coherence)) return;
        if (url.searchParams.get("format") === "text") {
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          response.end(message);
          return;
        }
        sendJson(response, 200, { ...context, message });
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/free-agents") {
      try {
        const report = await getFreeAgents({
          position: url.searchParams.get("position"),
          limitPerPosition: Number(url.searchParams.get("limit")) || 10,
          team: url.searchParams.get("team") || null
        });
        const message = formatWaiverReport(report);
        if (url.searchParams.get("requirePublishable") === "1" && refuseUnpublishable(response, report.coherence)) return;
        if (url.searchParams.get("format") === "text") {
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          response.end(message);
          return;
        }
        sendJson(response, 200, { ...report, message });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/model/feedback") {
      try {
        const feedback = await getModelFeedback();
        if (url.searchParams.get("format") === "text") {
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          response.end(feedback?.message || "Aucun bilan de modèle pour l'instant.");
          return;
        }
        sendJson(response, 200, feedback || { report: null });
      } catch (error) {
        sendJson(response, 503, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/start-sit") {
      try {
        const ids = (url.searchParams.get("ids") || "").split(",").map(id => id.trim()).filter(Boolean);
        sendJson(response, 200, await getStartSit({ team: url.searchParams.get("team") || null, ids }));
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/player-values") {
      try {
        const { week, byId } = await getPlayerValues();
        sendJson(response, 200, { week, players: Object.fromEntries(byId) });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/usage") {
      try {
        sendJson(response, 200, await getUsage({ team: url.searchParams.get("team") || null }));
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/player-status") {
      try {
        const statuses = await getInjuryStatuses();
        sendJson(response, 200, { statuses: Object.fromEntries(statuses) });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/lineup-advisor") {
      try {
        const team = url.searchParams.get("team") || "t0z";
        const [context, playerStatuses, freeAgents] = await Promise.all([
          getContext({ team }),
          getInjuryStatuses(),
          getFreeAgents({ limitPerPosition: 5 })
        ]);
        const diagnosis = diagnoseLineup({
          myTeam: context.myTeam,
          playerStatuses,
          freeAgentsByPosition: freeAgents.byPosition,
          byeWeeks: BYE_WEEKS_2026,
          currentWeek: context.week
        });
        let optimal = null;
        try {
          const projections = await getProjections({ week: context.week });
          optimal = compareWithOptimalLineup({ myTeam: context.myTeam, projections, playerStatuses });
        } catch {}
        diagnosis.optimal = optimal;
        const message = formatLineupAdvisory(diagnosis);
        if (url.searchParams.get("format") === "text") {
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          response.end(message);
          return;
        }
        sendJson(response, 200, { ...diagnosis, week: context.week, message });
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/coach") {
      const apiAuthorized = coachToken && request.headers.authorization === `Bearer ${coachToken}`;
      const webAuthorized = coachAuth.authenticated(request.headers.cookie);
      if (!apiAuthorized && !webAuthorized) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      try {
        const team = apiAuthorized ? url.searchParams.get("team") || "t0z" : "t0z";
        let preferences = {};
        try {
          preferences = normalizeCoachPreferences(JSON.parse(request.headers["x-coach-preferences"] || "{}"));
        } catch {}
        const context = await getContext({ team });
        const [playerStatuses, playerValues, freeAgents, trades, matchup, playoffContext] = await Promise.all([
          getInjuryStatuses().catch(() => new Map()),
          getPlayerValues().catch(() => ({ byId: new Map(), weeklyProjections: {} })),
          getFreeAgents({ limitPerPosition: 8, team }),
          analyze({ team, playerPreferences: preferences }),
          getMatchupContext({ team, week: context.week }).catch(() => null),
          getPlayoffContext({ week: context.week, rosterId: context.myTeam.rosterId, leagueId: context.league.id }).catch(() => ({ ready: false, reason: "SOURCE_UNAVAILABLE" }))
        ]);
        const lineup = diagnoseLineup({
          myTeam: context.myTeam,
          playerStatuses,
          freeAgentsByPosition: freeAgents.byPosition,
          byeWeeks: BYE_WEEKS_2026,
          currentWeek: context.week
        });
        try {
          lineup.optimal = compareWithOptimalLineup({
            myTeam: context.myTeam,
            projections: playerValues.weeklyProjections || {},
            playerStatuses
          });
        } catch { lineup.optimal = null; }
        const decisionContext = buildDecisionContext({ context, playerValues, statuses: playerStatuses, waivers: freeAgents, lineup, matchup, playoffContext });
        const plan = buildCoachPlan({ decisionContext, trades, preferences });
        // Bearer = automation: refuse. The signed-in page still shows the plan with its warning.
        if (apiAuthorized && refuseUnpublishable(response, plan.coherence)) return;
        sendJson(response, 200, { ...plan, message: formatCoachPlan(plan) });
      } catch (error) {
        const isUnknownTeam = error.message.startsWith("Équipe Sleeper inconnue");
        sendJson(response, isUnknownTeam ? 404 : 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/settings") {
      sendJson(response, 200, {
        metadata: LEAGUE_METADATA_2026,
        general: GENERAL_SETTINGS_2026,
        roster: ROSTER_SETTINGS_2026,
        scoring: SCORING_SETTINGS_2026,
        byeWeeks: BYE_WEEKS_2026
      });
      return;
    }

    try {
      let filePath = resolvePublicPath(publicRoot, url.pathname);
      if (!filePath) {
        response.writeHead(403);
        response.end();
        return;
      }
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) filePath = resolve(filePath, "index.html");
      const finalStat = await stat(filePath);
      const extension = extname(filePath).toLowerCase();
      const cacheControl = url.pathname.startsWith("/coach/") ? "no-store" : extension === ".html" || extension === ".json"
        ? "no-cache"
        : "public, max-age=3600";
      response.writeHead(200, {
        "content-type": MIME_TYPES[extension] || "application/octet-stream",
        "content-length": finalStat.size,
        "cache-control": cacheControl,
        "x-content-type-options": "nosniff"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

function main() {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Adineu Fantasy listening on port ${port}`);
  });
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) main();
