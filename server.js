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
  getInjuryStatuses = getInjuryStatusesDefault
} = {}) {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    const url = new URL(request.url, "http://localhost");
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

    if (url.pathname === "/api/settings") {
      sendJson(response, 200, {
        metadata: LEAGUE_METADATA_2026,
        general: GENERAL_SETTINGS_2026,
        roster: ROSTER_SETTINGS_2026,
        scoring: SCORING_SETTINGS_2026
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
      const cacheControl = extension === ".html" || extension === ".json"
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
