#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeTrades, formatTradeBulletin } from "./scripts/analyze-trades.js";
import {
  getLeagueContext,
  formatContextText,
  getFreeAgents as getFreeAgentsDefault,
  formatWaiverReport
} from "./scripts/league-context.js";
import {
  getInjuryStatuses as getInjuryStatusesDefault,
  diagnoseLineup,
  formatLineupAdvisory
} from "./scripts/lineup-advisor.js";
import {
  LEAGUE_METADATA_2026,
  GENERAL_SETTINGS_2026,
  ROSTER_SETTINGS_2026,
  SCORING_SETTINGS_2026,
  BYE_WEEKS_2026
} from "./public/assets/league-settings.js";
import { buildCoachPlan, formatCoachPlan } from "./scripts/coach-assistant.js";
import { createCoachAuth } from "./scripts/coach-auth.js";

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL("./public", import.meta.url));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

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
  getFreeAgents = getFreeAgentsDefault,
  getInjuryStatuses = getInjuryStatusesDefault,
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
        const context = await getContext({ team: url.searchParams.get("team") || "t0z" });
        const message = formatContextText(context);
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
          limitPerPosition: Number(url.searchParams.get("limit")) || 10
        });
        const message = formatWaiverReport(report);
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
        const [context, playerStatuses, freeAgents, trades] = await Promise.all([
          getContext({ team }),
          getInjuryStatuses().catch(() => new Map()),
          getFreeAgents({ limitPerPosition: 8 }),
          analyze({ team })
        ]);
        const lineup = diagnoseLineup({
          myTeam: context.myTeam,
          playerStatuses,
          freeAgentsByPosition: freeAgents.byPosition,
          byeWeeks: BYE_WEEKS_2026,
          currentWeek: context.week
        });
        const plan = buildCoachPlan({ context, lineup, waivers: freeAgents, trades });
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
