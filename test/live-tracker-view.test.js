import test from "node:test";
import assert from "node:assert/strict";
import { renderLiveStandings, renderLiveTrackerCards } from "../public/assets/live-tracker-view.js";

test("projected standings never silently fall back to current scores", () => {
  const report = { ready: true, week: 7, baselineThroughWeek: 6, live: [{ rosterId: 1, teamName: "<unsafe>", manager: "One", rank: 1, baselineRank: 2, rankChange: 1, wins: 3, losses: 4, ties: 0, pointsFor: 700, weekPoints: 120 }], projected: [], started: true };
  assert.match(renderLiveStandings(report), /&lt;unsafe&gt;/);
  const projected = renderLiveStandings(report, "projected");
  assert.match(projected, /Estimation suspendue/); assert.ok(!projected.includes("700"));
  assert.match(projected, /Ce n’est pas le classement final officiel/);
});

test("in-progress cards do not display pregame win percentages as live probabilities", () => {
  const team = { teamName: "Team", manager: "Owner", points: 100, estimate: 110, starters: [{ name: "Player", position: "WR", slot: "WR", actual: 10, estimate: 12, state: "LIVE" }], bench: [{ name: "Bench", actual: 25, estimate: 25, state: "FINAL" }], started: true, finished: false, projectionGaps: [] };
  const html = renderLiveTrackerCards({ matchups: [{ historyLabel: "Historique · One 2—1 Two", teams: [team, { ...team, teamName: "Other" }] }] });
  assert.match(html, /Détail des titulaires et du banc/); assert.match(html, /Bench/);
  assert.ok(!html.includes("Avant-match Adineu :"));
  assert.match(html, /Seuls les titulaires comptent/);
  assert.match(html, /Historique · One 2—1 Two/);
});
