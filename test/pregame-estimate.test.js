import test from "node:test";
import assert from "node:assert/strict";
import { pregameEstimatePresentation } from "../public/assets/win-probability.js";
import { calendarMatchupStarted, renderMatchupCards } from "../public/assets/matchups-live.js";
import { renderLiveTrackerCards } from "../public/assets/live-tracker-view.js";

const chances = { teamA: 62.3, teamB: 37.7 };

test("a frozen pregame estimate is shown only when no game has verifiably begun, with its read time", () => {
  const shown = pregameEstimatePresentation({ chances, started: false, readAt: "2026-10-28T09:05:00Z" });
  assert.equal(shown.show, true);
  assert.equal(shown.label, "Estimation avant match (figée) · 62.3 % / 37.7 %");
  assert.match(shown.basis, /lues le 28\/10 10:05 \(Paris\)/);
  assert.match(shown.basis, /Pas une probabilité live/);
  assert.deepEqual(pregameEstimatePresentation({ chances, started: true }).reason, "STARTED");
  assert.equal(pregameEstimatePresentation({ chances, started: null }).reason, "START_UNVERIFIED");
  assert.equal(pregameEstimatePresentation({ chances, started: undefined }).show, false);
  assert.deepEqual(pregameEstimatePresentation({ chances: null, started: false }), { show: false, reason: "NO_ESTIMATE", note: null });
  assert.match(pregameEstimatePresentation({ chances, started: false }).basis, /heure non indiquée/);
});

const team = (rosterId, points = 0) => ({ rosterId, manager: `M${rosterId}`, canonicalManager: `M${rosterId}`, sleeperName: `M${rosterId}`, teamName: `T${rosterId}`, points, starters: 9, projection: { total: 100 }, unavailable: null });
const matchup = (a = team(1), b = team(2)) => ({ matchupId: 1, teams: [a, b], history: null, chances });

test("calendar start state: week status first, then the Live report per roster; zero scores prove nothing", () => {
  const m = matchup();
  assert.equal(calendarMatchupStarted(m, "Terminé"), true);
  assert.equal(calendarMatchupStarted(m, "En cours"), true);
  assert.equal(calendarMatchupStarted(m, "Programmé"), false);
  assert.equal(calendarMatchupStarted(m, "À venir"), null, "no Live report: unverified");
  assert.equal(calendarMatchupStarted(m, "À venir", new Map([[1, false], [2, false]])), false);
  assert.equal(calendarMatchupStarted(m, "À venir", new Map([[1, false], [2, true]])), true, "a 0–0 score with a started game");
  assert.equal(calendarMatchupStarted(m, "À venir", new Map([[1, false]])), null, "one roster missing stays unknown");
});

test("calendar cards: percentage only before kickoff, labeled frozen; withdrawn in progress and final", () => {
  const before = renderMatchupCards([matchup()], "Programmé", { readAt: "2026-10-28T09:05:00Z" });
  assert.match(before, /class="win-meter"/);
  assert.match(before, /Estimation avant match \(figée\) · 62\.3 % \/ 37\.7 %/);
  assert.match(before, /Avant-match : 100 pts · 62\.3%/);
  for (const status of ["En cours", "Terminé"]) {
    const html = renderMatchupCards([matchup(team(1, 55), team(2, 40))], status);
    assert.doesNotMatch(html, /win-meter"|62\.3/);
    assert.match(html, /Estimation avant match retirée/);
  }
  const unverified = renderMatchupCards([matchup()], "À venir");
  assert.doesNotMatch(unverified, /62\.3/);
  assert.match(unverified, /début des matchs NFL non vérifié/);
  const verified = renderMatchupCards([matchup()], "À venir", { startedByRoster: new Map([[1, false], [2, false]]) });
  assert.match(verified, /Estimation avant match \(figée\)/);
});

const liveTeam = (state, extra = {}) => ({ teamName: "Team", manager: "Owner", points: 0, estimate: 110, starters: [{ name: "P", position: "WR", slot: "WR", actual: 0, estimate: 12, state }], bench: [], started: false, finished: false, projectionGaps: [], ...extra });

test("Live cards: frozen estimate with the report time before kickoff, never once started or unverified", () => {
  const asOf = "2026-11-01T16:00:00Z";
  const pre = renderLiveTrackerCards({ asOf, matchups: [{ teams: [liveTeam("PREGAME"), liveTeam("BYE", { estimate: 90 })] }] });
  assert.match(pre, /Estimation avant match \(figée\) · \d/);
  assert.match(pre, /01\/11 17:00 \(Paris\)/);
  const started = renderLiveTrackerCards({ asOf, matchups: [{ teams: [liveTeam("LIVE", { started: true }), liveTeam("PREGAME")] }] });
  assert.doesNotMatch(started, /figée/);
  assert.match(started, /Estimation avant match retirée/);
  const unknown = renderLiveTrackerCards({ asOf, matchups: [{ teams: [liveTeam("UNKNOWN"), liveTeam("PREGAME")] }] });
  assert.match(unknown, /non vérifié/);
  const gaps = renderLiveTrackerCards({ asOf, matchups: [{ teams: [liveTeam("PREGAME", { projectionGaps: ["LINEUP_INCOMPLETE"] }), liveTeam("PREGAME")] }] });
  assert.match(gaps, /projections incomplètes/);
});
