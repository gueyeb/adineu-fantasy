#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeTrades, evaluateTradeOffer, formatTradeBulletin, formatTradeOffer, loadPlayerValues } from "./scripts/analyze-trades.js";
import { createWarRoomStore } from "./scripts/war-room-sync.js";
import { createDecisionLogStore, refreshDecisionJournal } from "./scripts/decision-log.js";
import {
  getLeagueContext,
  getMatchupContext as getMatchupContextDefault,
  formatContextText,
  getFreeAgents as getFreeAgentsDefault,
  getWeeklyProjections as getWeeklyProjectionsDefault,
  getUsageReport as getUsageReportDefault,
  getWeeklyLeaders as getWeeklyLeadersDefault,
  getWeeklyRankings as getWeeklyRankingsDefault,
  getSeasonLeaders as getSeasonLeadersDefault,
  getDefenseMatchups as getDefenseMatchupsDefault,
  getPlayersIndex as getPlayersIndexDefault,
  formatWaiverReport,
  setAuctionCalibrationSource
} from "./scripts/league-context.js";
import { loadLatestCalibration } from "./scripts/calibrate-faab.js";
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
import { parseWatchIds } from "./public/assets/war-room.js";
import { createSupabaseFromEnv, getLatestFeedback, runWeeklyJob } from "./scripts/model-tracking.js";
import { timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildCoachSos, formatCoachSos } from "./scripts/sos-coach.js";
import { sosService } from "./scripts/sos-service.js";
import { sosStore, historicalSos } from "./scripts/sos-store.js";
import { frozenPastSos } from "./scripts/sos-history.js";
import { evaluateSos } from "./scripts/sos-feedback.js";
import { captureExperts } from "./scripts/expert-benchmark.js";
import { getPrelockCheck } from "./scripts/prelock-check.js";
import { SOS_HORIZONS, sosMethodology } from "./public/assets/wr-ros-sos.js";

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
  getSosBundle,
  sosArchives = sosStore,
  analyze = analyzeTrades,
  getContext = getLeagueContext,
  getPlayoffContext = getContext === getLeagueContext ? getPlayoffDecisionContext : async () => null,
  getFreeAgents = getFreeAgentsDefault,
  getInjuryStatuses = getInjuryStatusesDefault,
  getPlayersIndex = getPlayersIndexDefault,
  getProjections = getWeeklyProjectionsDefault,
  getUsage = getUsageReportDefault,
  getLeaders = getWeeklyLeadersDefault,
  getRankings = getWeeklyRankingsDefault,
  getSeasonLeaders = getSeasonLeadersDefault,
  getDefenseMatchups = getDefenseMatchupsDefault,
  getPlayerValues = loadPlayerValues,
  evaluateOffer = evaluateTradeOffer,
  getStartSit = getStartSitDefault,
  getMatchupContext = getMatchupContextDefault,
  modelJobToken = process.env.MODEL_JOB_TOKEN || "",
  runModelJob = async () => runWeeklyJob({ supabase: await createSupabaseFromEnv() }),
  runPrelockJob = getPrelockCheck,
  runExpertsJob = async () => captureExperts({ supabase: await createSupabaseFromEnv() }),
  runJournalJob = async () => refreshDecisionJournal(),
  getModelFeedback = () => getLatestFeedback(),
  warRoomStore = createWarRoomStore(),
  decisionLogStore = createDecisionLogStore(),
  coachToken = process.env.COACH_API_TOKEN || "",
  coachPassword = process.env.COACH_WEB_PASSWORD || "",
  secureCookies = process.env.NODE_ENV !== "development"
} = {}) {
  const loadSos = getSosBundle || (getContext === getLeagueContext ? position => sosService.getBundle(position) : async () => null);
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
    // Journal refresh (n8n, Thursday): re-sync after Wednesday's waivers + post-waiver review.
    const jobRoutes = { "/api/model/experts/capture": () => runExpertsJob(), "/api/coach/prelock": () => runPrelockJob({ team: url.searchParams.get("team") || process.env.COACH_TEAM || "t0z" }), "/api/model/weekly": () => runModelJob(), "/api/coach/decisions/sync": () => runJournalJob() };
    if (jobRoutes[url.pathname] && request.method === "POST") {
      if (!modelJobToken) return sendJson(response, 503, { error: "MODEL_JOB_TOKEN non configuré." });
      const expected = Buffer.from(`Bearer ${modelJobToken}`);
      const received = Buffer.from(request.headers.authorization || "");
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return sendJson(response, 401, { error: "Unauthorized" });
      try {
        const result = await jobRoutes[url.pathname]();
        return sendJson(response, 200, result);
      } catch (error) {
        // Missing server configuration is a 503 with a clear message (Cloudflare masks origin 502s).
        const misconfigured = /requis|Cannot find package/.test(error.message);
        return sendJson(response, misconfigured ? 503 : 500, { error: error.message });
      }
    }
    // War Room sync: the Coach's own watchlist and bid readings, behind the same access as the plan.
    if (url.pathname === "/api/coach/war-room") {
      const apiAuthorized = coachToken && request.headers.authorization === `Bearer ${coachToken}`;
      if (!apiAuthorized && !coachAuth.authenticated(request.headers.cookie)) return sendJson(response, 404, { error: "Not found" });
      const validRoster = value => Number.isInteger(value) && value >= 1 && value <= 32;
      try {
        if (request.method === "GET") {
          const rosterId = Number(url.searchParams.get("roster"));
          if (!validRoster(rosterId)) return sendJson(response, 400, { error: "roster invalide" });
          return sendJson(response, 200, { state: await warRoomStore.load(rosterId) });
        }
        if (request.method !== "PUT") return sendJson(response, 405, { error: "Method not allowed" });
        const origin = request.headers.origin;
        if (!apiAuthorized && (!origin || !URL.canParse(origin) || new URL(origin).host !== request.headers.host)) return sendJson(response, 403, { error: "Forbidden" });
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 64 * 1024) return sendJson(response, 413, { error: "Payload too large" });
        }
        let payload;
        try { payload = JSON.parse(body); } catch { return sendJson(response, 400, { error: "Invalid request" }); }
        if (!validRoster(payload?.rosterId)) return sendJson(response, 400, { error: "roster invalide" });
        return sendJson(response, 200, { state: await warRoomStore.save(payload.rosterId, { watchlist: payload.watchlist, bidHistory: payload.bidHistory }) });
      } catch (error) {
        return sendJson(response, 503, { error: "SYNC_UNAVAILABLE" });
      }
    }

    // Decision journal: the team's real moves with outcomes; only the operator's reason is writable.
    if (url.pathname === "/api/coach/decisions") {
      const apiAuthorized = coachToken && request.headers.authorization === `Bearer ${coachToken}`;
      if (!apiAuthorized && !coachAuth.authenticated(request.headers.cookie)) return sendJson(response, 404, { error: "Not found" });
      const validRoster = value => Number.isInteger(value) && value >= 1 && value <= 32;
      try {
        if (request.method === "GET") {
          const rosterId = Number(url.searchParams.get("roster"));
          if (!validRoster(rosterId)) return sendJson(response, 400, { error: "roster invalide" });
          return sendJson(response, 200, await decisionLogStore.list(rosterId));
        }
        if (request.method !== "PUT") return sendJson(response, 405, { error: "Method not allowed" });
        const origin = request.headers.origin;
        if (!apiAuthorized && (!origin || !URL.canParse(origin) || new URL(origin).host !== request.headers.host)) return sendJson(response, 403, { error: "Forbidden" });
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 4 * 1024) return sendJson(response, 413, { error: "Payload too large" });
        }
        let payload;
        try { payload = JSON.parse(body); } catch { return sendJson(response, 400, { error: "Invalid request" }); }
        if (!validRoster(payload?.rosterId) || typeof payload.id !== "string") return sendJson(response, 400, { error: "Requête invalide" });
        try { return sendJson(response, 200, await decisionLogStore.setReason(payload.rosterId, payload.id, payload.reason)); }
        catch (error) { if (/inconnue|invalide/i.test(error.message)) return sendJson(response, 400, { error: error.message }); throw error; }
      } catch {
        return sendJson(response, 503, { error: "JOURNAL_UNAVAILABLE" });
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    if (["/api/sos", "/api/sos/bundle", "/api/sos/snapshots", "/api/sos/evaluation", "/api/sos/trends"].includes(url.pathname)) {
      const fail = (status, code) => sendJson(response, status, { error: { code, message: code } });
      const supported = ["position", "horizon", "snapshotId", "perspective"];
      if ([...url.searchParams.keys()].some(key => !supported.includes(key) || url.searchParams.getAll(key).length > 1)) return fail(400, "INVALID_SOS_QUERY");
      const position = url.searchParams.get("position") ?? "WR";
      const rawHorizon = url.searchParams.get("horizon") ?? "FANTASY_ROS";
      const horizon = rawHorizon === "ROS" ? "FANTASY_ROS" : rawHorizon;
      const id = url.searchParams.get("snapshotId");
      const perspective = url.searchParams.get("perspective") || "CURRENT";
      if (!["WR", "RB"].includes(position)) return fail(400, "INVALID_SOS_QUERY");
      if (!["CURRENT", "FROZEN"].includes(perspective) || (perspective === "FROZEN" && (horizon !== "PAST" || id))) return fail(400, "INVALID_SOS_PERSPECTIVE");
      if (!SOS_HORIZONS.includes(horizon) || (id !== null && !/^[a-f0-9]{64}$/.test(id))) return fail(400, "INVALID_SOS_QUERY");
      if (url.pathname.endsWith("/evaluation") && url.searchParams.has("horizon") && horizon !== "NFL_ROS") return fail(400, "INVALID_EVALUATION_HORIZON");
      if (url.pathname.endsWith("/evaluation") && !id) return fail(400, "SNAPSHOT_REQUIRED");
      const methodologyVersion = sosMethodology(position);
      try {
        if (url.pathname.endsWith("/trends")) {
          const archives = await Promise.all((await sosArchives.list(position)).filter(row => row.methodologyVersion === methodologyVersion).map(row => sosArchives.load(row.snapshotId)));
          return sendJson(response, 200, { horizon, methodologyVersion,
            snapshots: archives.filter(Boolean).map(bundle => ({ snapshotId: bundle.snapshotId, asOf: bundle.asOf, week: bundle.week, methodologyVersion: bundle.methodologyVersion,
              teams: bundle.horizons[horizon].teams.map(team => ({ team: team.team, rank: team.rank, sosScore: team.sosScore, coverageStatus: team.coverageStatus })) })) });
        }
        if (url.pathname.endsWith("/snapshots")) return sendJson(response, 200, { snapshots: (await sosArchives.list(position)).filter(row => row.methodologyVersion === methodologyVersion) });
        const bundle = id ? await sosArchives.load(id) : await loadSos(position);
        if (bundle && bundle.methodologyVersion !== methodologyVersion) return fail(404, "SNAPSHOT_NOT_FOUND");
        if (!bundle) return fail(id ? 404 : 503, id ? "SNAPSHOT_NOT_FOUND" : "SOS_SOURCE_UNAVAILABLE");
        if (url.pathname.endsWith("/evaluation")) {
          const current = await loadSos(position);
          if (!current || current.methodologyVersion !== methodologyVersion) return fail(503, "SOS_SOURCE_UNAVAILABLE");
          return sendJson(response, 200, { ...evaluateSos(bundle, current.inputs.dvp.observations, current.asOf), forecast: historicalSos(bundle, "NFL_ROS"),
            observationSources: current.horizons.NFL_ROS.sources });
        }
        if (url.pathname.endsWith("/bundle")) {
          if (perspective !== "CURRENT") return fail(400, "INVALID_SOS_PERSPECTIVE");
          return sendJson(response, 200, { horizons: Object.fromEntries(SOS_HORIZONS.map(key => [key, id ? historicalSos(bundle, key) : bundle.horizons[key]])) });
        }
        if (perspective === "FROZEN") {
          const archives = await Promise.all((await sosArchives.list(position)).map(row => sosArchives.load(row.snapshotId)));
          return sendJson(response, 200, frozenPastSos(bundle, archives.filter(Boolean)));
        }
        return sendJson(response, 200, id ? historicalSos(bundle, horizon) : bundle.horizons[horizon]);
      } catch { return fail(503, "SOS_SOURCE_UNAVAILABLE"); }
    }

    if (url.pathname === "/api/version") {
      const paths = ["scripts/sos-sources.js", "scripts/sos-service.js", "scripts/sos-store.js", "public/assets/wr-ros-sos.js", "public/assets/sos-explorer.js", "server.js", "scripts/league-context.js", "scripts/waiver-evaluator.js", "public/assets/waiver-model.js", "public/assets/waiver-board.js", "public/assets/waiver-plan.js", "scripts/coach-assistant.js", "public/assets/coach-ui.js", "public/assets/coach-week-view.js"];
      const files = Object.fromEntries(await Promise.all(paths.map(async path => {
        try { return [path, createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex")]; }
        catch { return [path, null]; }
      })));
      sendJson(response, 200, { sourceFingerprint: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files });
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
        let sosWaivers = null;
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
          sosWaivers = waivers;
          const matchup = matchupResult.status === "fulfilled" ? matchupResult.value : null;
          const lineup = diagnoseLineup({
            myTeam: compactContext.myTeam,
            playerStatuses: statuses,
            freeAgentsByPosition: waivers?.byPosition || {},
            byeWeeks: BYE_WEEKS_2026,
            currentWeek: compactContext.week,
            acquisitionPlan: waivers?.acquisitionPlan ?? null
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
        context = { ...context, sos: buildCoachSos({ context: compactContext, waivers: sosWaivers, bundle: await loadSos().catch(() => null), rbBundle: await loadSos('RB').catch(() => null) }) };
        message += formatCoachSos(context.sos);
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

    if (url.pathname === "/api/trade-offer") {
      const ids = name => (url.searchParams.get(name) || "").split(",").map(id => id.trim()).filter(id => /^[A-Za-z0-9]{1,12}$/.test(id)).slice(0, 6);
      if (!ids("give").length || !ids("receive").length) return sendJson(response, 400, { error: "give et receive requis (ids Sleeper séparés par des virgules)" });
      try {
        const offer = await evaluateOffer({ give: ids("give"), receive: ids("receive") });
        sendJson(response, 200, { ...offer, message: formatTradeOffer(offer) });
      } catch (error) {
        sendJson(response, error.message.startsWith("Offre") ? 422 : 502, { error: error.message });
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

    if (url.pathname === "/api/defense-matchups") {
      const requested = url.searchParams.get("week");
      const week = requested === null ? null : Number(requested);
      if (week !== null && !(Number.isInteger(week) && week >= 1 && week <= 18)) return sendJson(response, 400, { error: "week doit être un entier entre 1 et 18" });
      try {
        sendJson(response, 200, await getDefenseMatchups({ week }));
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/rankings") {
      const requested = url.searchParams.get("week");
      const week = requested === null ? null : Number(requested);
      if (week !== null && !(Number.isInteger(week) && week >= 1 && week <= 18)) {
        sendJson(response, 400, { error: "week doit être un entier entre 1 et 18" });
        return;
      }
      try {
        sendJson(response, 200, await getRankings({ week }));
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/leaders") {
      const requested = url.searchParams.get("week");
      if (requested === "season") {
        try {
          sendJson(response, 200, await getSeasonLeaders());
        } catch (error) {
          sendJson(response, 502, { error: error.message });
        }
        return;
      }
      const week = requested === null ? null : Number(requested);
      if (week !== null && !(Number.isInteger(week) && week >= 1 && week <= 18)) {
        sendJson(response, 400, { error: "week doit être un entier entre 1 et 18, ou season" });
        return;
      }
      try {
        sendJson(response, 200, await getLeaders({ week }));
      } catch (error) {
        sendJson(response, 502, { error: error.message });
      }
      return;
    }

    // Slim catalog for the browser (weekly awards): only requested ids, never the 15 MB Sleeper dump.
    if (url.pathname === "/api/players") {
      const ids = (url.searchParams.get("ids") || "").split(",").map(id => id.trim()).filter(id => /^[A-Za-z0-9]{1,8}$/.test(id));
      if (!ids.length || ids.length > 600) return sendJson(response, 400, { error: "ids : 1 à 600 identifiants Sleeper" });
      try {
        const index = await getPlayersIndex();
        const players = Object.fromEntries(ids.filter(id => index.has(id)).map(id => {
          const player = index.get(id);
          return [id, { full_name: player.name, position: player.position, fantasy_positions: player.fantasyPositions || (player.position ? [player.position] : []) }];
        }));
        sendJson(response, 200, { players });
      } catch (error) {
        sendJson(response, 502, { error: error.message });
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
          getFreeAgents({ limitPerPosition: 8, team, watchIds: parseWatchIds(request.headers["x-coach-watchlist"]) }),
          analyze({ team, playerPreferences: preferences }),
          getMatchupContext({ team, week: context.week }).catch(() => null),
          getPlayoffContext({ week: context.week, rosterId: context.myTeam.rosterId, leagueId: context.league.id }).catch(() => ({ ready: false, reason: "SOURCE_UNAVAILABLE" }))
        ]);
        const lineup = diagnoseLineup({
          myTeam: context.myTeam,
          playerStatuses,
          freeAgentsByPosition: freeAgents.byPosition,
          byeWeeks: BYE_WEEKS_2026,
          currentWeek: context.week,
          acquisitionPlan: freeAgents.acquisitionPlan ?? null
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
        plan.sos = buildCoachSos({ context, waivers: freeAgents, bundle: await loadSos().catch(() => null), rbBundle: await loadSos('RB').catch(() => null) });
        // Bearer = automation: refuse. The signed-in page still shows the plan with its warning.
        if (apiAuthorized && refuseUnpublishable(response, plan.coherence)) return;
        sendJson(response, 200, { ...plan, message: formatCoachPlan(plan) + formatCoachSos(plan.sos) });
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
  // Latest FAAB calibration stored by the Tuesday job; the committed file stays the fallback.
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    setAuctionCalibrationSource(async () => loadLatestCalibration(await createSupabaseFromEnv(), LEAGUE_METADATA_2026.season));
  }
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Adineu Fantasy listening on port ${port}`);
  });
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) main();
