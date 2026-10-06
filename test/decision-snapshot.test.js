import test from "node:test";
import assert from "node:assert/strict";
import { getFreeAgents } from "../scripts/league-context.js";

const scope = { leagueId: "fixture", season: "2026", targetWeek: 4 };
const asOf = "2026-10-04T10:00:00Z";
const evidence = { ...scope, source: "https://example.com/sleeper-observation", observedAt: "2026-10-04T09:00:00Z", expiresAt: "2026-10-04T18:00:00Z", availability: "FREE_AGENT" };
const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "WR", "K", "DEF", "QB", "WR", "WR", "RB", "WR", "WR"];
const rosterIds = positions.map((_, i) => `r${i}`);
const players = Object.fromEntries(positions.map((position, i) => [rosterIds[i], { full_name: `Roster ${i}`, position, team: "SEA", active: true }]));
players.q = { full_name: "Rental QB", position: "QB", team: "CHI", search_rank: 100, active: true };
players.injured = { full_name: "Injured QB", position: "QB", team: "CHI", search_rank: 1, injury_status: "Out", active: true };
const points = Object.fromEntries(rosterIds.map((id, i) => [id, { pts_ppr: i === 0 ? 17.1 : i === 9 ? 9 : 10 }]));
points.q = { pts_ppr: 17.2 };
function fixture({ reOwned = false, missing = false, conflictQB = false, wrAdds = false, recordedStats = false } = {}) {
  let rosterReads = 0;
  return async url => ({ ok: true, text: async () => "season,game_type,week,gameday,gametime,away_team,home_team,away_score,home_score\n2026,REG,4,2026-10-04,13:00,CHI,SEA,,",
    json: async () => {
      if (url.endsWith("/rosters")) {
        rosterReads++;
        return [{ roster_id: 1, owner_id: "u", starters: rosterIds.slice(0, 9), players: rosterIds, settings: { waiver_budget_used: 503 } },
          { roster_id: 2, owner_id: "v", players: reOwned && rosterReads > 1 ? ["q"] : [] }];
      }
      if (url.endsWith("/users")) return [{ user_id: "u", display_name: "t0z" }];
      if (url.endsWith("/state/nfl")) return { display_week: 4, week: 4, season: "2026", season_has_scores: true };
      if (url.endsWith("/players/nfl") && wrAdds) return { ...players, wrA: { full_name: "WR A", position: "WR", team: "CHI", active: true }, wrB: { full_name: "WR B", position: "WR", team: "CHI", active: true } };
      if (url.endsWith("/players/nfl")) return conflictQB ? { ...players, alternate: { full_name: "Alternate QB", position: "QB", team: "CHI", search_rank: 110, active: true } } : players;
      if (url.includes("/transactions/")) return [];
      if (url.includes("/stats/") && recordedStats) return { q: {off_snp:60, tm_off_snp:65, pass_att:30, pass_sack:2, pass_air_yd:240, rush_att:4, rush_rz_att:1, pass_rz_att:5, pts_ppr:22} };
      if (url.includes("/projections/") && wrAdds) return { ...points, wrA: { pts_ppr: 16 }, wrB: { pts_ppr: 15 } };
      if (url.includes("/projections/")) return missing ? Object.fromEntries(Object.entries(points).filter(([id]) => id !== "r1")) : points;
      if (url.includes("/trending/")) return [];
      return {};
    } });
}
const options = { leagueId: "fixture", team: "t0z", position: "QB", asOf, availabilityEvidenceById: { q: evidence },
  roleEvidenceById: { q: { ...evidence, roleConfirmation: "CONFIRMED", announcedRole: "STARTING_QB", roleWeeks: 1 } } };
test("snapshot delivers a confirmed 0.1-point rental on one week; ownership reread excludes a taken player", async () => {
  const report = await getFreeAgents({ ...options, fetchImpl: fixture() });
  const candidate = report.byPosition.QB.find(p => p.sleeperId === "q");
  assert.equal(report.ownershipRechecked, true);
  assert.equal(candidate.provenance.projections.weeks[0].status, "AVAILABLE");
  assert.ok(candidate.provenance.projections.weeks[0].fetchedAt);
  assert.equal(report.rosterProvenance.length, 15);
  assert.equal(report.playerIndexProvenance.fallback, null);
  assert.ok(report.evaluatedCandidateCount >= report.returnedCandidateCount);
  assert.equal(candidate.waiver.fit.dropCandidate.sleeperId, "r9", "QB2 scenario preserves the permanent starting QB after the rental ends");
  assert.equal(candidate.waiver.fit.postRoleCutCostTotal, 0);
  assert.equal(candidate.waiver.fit.horizonWeeks, 1);
  assert.equal(candidate.waiver.fit.grossGainTotal, 0.1);
  assert.equal(candidate.waiver.fit.netGainTotal, 0.1);
  assert.equal(candidate.waiver.fit.targetWeekDelta, 0.1);
  assert.equal(candidate.waiver.fit.faabMaxForMe, 0, "small total benefit cannot justify a costly rental");
  assert.equal(candidate.waiver.roleConfirmation, "CONFIRMED");
  const taken = await getFreeAgents({ ...options, fetchImpl: fixture({ reOwned: true }) });
  assert.ok(!(taken.byPosition.QB || []).some(p => p.sleeperId === "q"));
});
test("missing starter projection blocks the actionable gain instead of replacing it with zero", async () => {
  const report = await getFreeAgents({ ...options, fetchImpl: fixture({ missing: true }) });
  const candidate = report.byPosition.QB.find(p => p.sleeperId === "q");
  assert.equal(candidate.waiver.fit.netGainTotal, null);
  assert.equal(candidate.waiver.decision.recommendedAction, "WATCH");
  assert.equal(candidate.waiver.suggestedBid, 0);
});

test("QB announcement must actually identify the starting QB", async () => {
  const report = await getFreeAgents({ ...options, fetchImpl: fixture(), roleEvidenceById: { q: { ...evidence, roleConfirmation: "CONFIRMED", announcedRole: "BACKUP_QB", roleWeeks: 1 } } });
  const candidate = report.byPosition.QB.find(p => p.sleeperId === "q");
  assert.equal(candidate.waiver.roleConfirmation, "UNCONFIRMED");
  assert.equal(candidate.waiver.decision.recommendedAction, "WATCH");
});

test("two dated starter confirmations on one team cannot confirm either QB", async () => {
  const confirmation = { ...evidence, roleConfirmation: "CONFIRMED", announcedRole: "STARTING_QB", roleWeeks: 1 };
  const report = await getFreeAgents({ ...options, fetchImpl: fixture({ conflictQB: true }), roleEvidenceById: { q: confirmation, alternate: confirmation } });
  const candidate = report.byPosition.QB.find(p => p.sleeperId === "q");
  assert.equal(candidate.waiver.roleConfirmation, "UNCONFIRMED");
  assert.ok(candidate.waiver.reasons.includes("Conflicting starting-QB confirmations"));
});

test("snapshot applies a dated roster preference and removes it on expiry", async () => {
  const preference = { playerId: "r9", rosterId: 1, kind: "KEEP_UNTIL", createdAt: "2026-10-04T09:00:00Z", expiresAt: "2026-10-04T12:00:00Z", penaltyPoints: 5, reason: "Observe QB2" };
  const report = await getFreeAgents({ ...options, fetchImpl: fixture(), rosterPreferences: [preference] });
  const candidate = report.byPosition.QB.find(p => p.sleeperId === "q");
  assert.notEqual(candidate.waiver.fit.dropCandidate.sleeperId, "r9");
  assert.equal(report.rosterPreferences.length, 1);
  const expired = await getFreeAgents({ ...options, fetchImpl: fixture(), rosterPreferences: [{ ...preference, expiresAt: asOf }] });
  assert.equal(expired.rosterPreferences.length, 0);
  assert.equal(expired.byPosition.QB.find(p => p.sleeperId === "q").waiver.fit.dropCandidate.sleeperId, "r9");
});
test("report plans two acquisitions with separate cuts instead of reusing the first cut", async () => {
  const report = await getFreeAgents({ ...options, position: "WR", fetchImpl: fixture({ wrAdds: true }), availabilityEvidenceById: { wrA: evidence, wrB: evidence } });
  assert.equal(report.acquisitionPlan.steps.length, 2);
  assert.equal(report.acquisitionPlan.conflicts.length, 1);
  assert.equal(new Set(report.acquisitionPlan.steps.map(step => step.dropCandidate.sleeperId)).size, 2);
  assert.ok(report.acquisitionPlan.reservedFaab <= report.faabRemaining);
});


test("captured inputs reproduce market, cuts, actions and multi-acquisition plan offline", async () => {
  const { recomputeDecisionInputs } = await import('../scripts/decision-recompute.js');
  let inputs;
  const report = await getFreeAgents({ ...options, position:null, fetchImpl:fixture({wrAdds:true}), onDecisionInputs:value=>{inputs=value;} });
  const recalculated = recomputeDecisionInputs(JSON.parse(JSON.stringify(inputs)));
  assert.deepEqual(recalculated.byPosition,report.byPosition);
  assert.deepEqual(recalculated.acquisitionPlan,report.acquisitionPlan);
  assert.ok(inputs.raw.projectionsByWeek[4]);
  assert.ok(inputs.raw.catalog);
});


test("versioned calculation archive reproduces outputs and rejects changed model or future inputs", async () => {
  const { createDecisionSnapshot, recomputeDecisionSnapshot, decisionModelFingerprint, replayDecisionSnapshot } = await import('../scripts/decision-snapshot.js');
  let inputs;
  const report = await getFreeAgents({ ...options, fetchImpl:fixture({missing:true}), onDecisionInputs:value=>{inputs=value;} });
  const fingerprint = await decisionModelFingerprint();
  const snapshot = createDecisionSnapshot(report,{inputs,modelFingerprint:fingerprint});
  const cutoff = new Date(Date.now()+1000).toISOString();
  const replay = await recomputeDecisionSnapshot(snapshot,{cutoff});
  assert.equal(replay.sameModel,true);
  assert.equal(replay.featureExtractionRecomputed,true);
  assert.equal(replay.sameOutput,true);
  assert.equal(replay.executable,false);
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { saveDecisionSnapshot } = await import('../scripts/decision-snapshot.js');
  const dir = await mkdtemp(join(tmpdir(),'adineu-recompute-'));
  try {
    const path=join(dir,'snapshot.json');
    await saveDecisionSnapshot(path,snapshot);
    const { stdout } = await promisify(execFile)(process.execPath,['scripts/decision-snapshot.js','recompute',path,cutoff],{maxBuffer:2_000_000});
    assert.equal(JSON.parse(stdout).sameOutput,true);
    assert.equal(JSON.parse(await readFile(path,'utf8')).version,2);
  } finally { await rm(dir,{recursive:true,force:true}); }

  assert.equal(replay.report.byPosition.QB[0].waiver.decision.recommendedAction,'WATCH');
  const changed = {...snapshot,modelFingerprint:'different-model'};
  await assert.rejects(recomputeDecisionSnapshot(changed,{cutoff}),/Model changed/);
  assert.equal((await recomputeDecisionSnapshot(changed,{cutoff,allowModelChange:true})).sameModel,false);
  const future = createDecisionSnapshot(report,{inputs:{...inputs,capturedAt:'2099-01-01T00:00:00Z'},modelFingerprint:fingerprint});
  assert.throws(()=>replayDecisionSnapshot(future,{cutoff}),/after replay cutoff/);
  const tampered = structuredClone(snapshot);
  tampered.inputs.marketRows[0].effectivePpg=99;
  assert.throws(()=>replayDecisionSnapshot(tampered,{cutoff}),/input integrity/);
});


test("raw feature replay ignores stale derived values and responds to role, projection and ownership inputs", async () => {
  const { recomputeDecisionInputs } = await import('../scripts/decision-recompute.js');
  let inputs;
  const report = await getFreeAgents({...options,fetchImpl:fixture(),onDecisionInputs:value=>{inputs=value;}});
  const poisoned=structuredClone(inputs);
  poisoned.marketRows.forEach(row=>{row.effectivePpg=100;row.usageScore=99;row.events.roleConfirmation='UNCONFIRMED';});
  poisoned.availabilityById.q={availability:'ROSTERED'};
  poisoned.fitContext.paceById.q=100;
  poisoned.fitContext.faabRemaining=0;
  poisoned.fitContext.lockedIds=[...rosterIds];
  poisoned.fitContext.weeklyPaceById.q[4]=100;
  assert.deepEqual(recomputeDecisionInputs(poisoned).byPosition,report.byPosition);
  const roleRemoved=structuredClone(inputs);
  roleRemoved.raw.roleEvidenceById.q={};
  assert.equal(recomputeDecisionInputs(roleRemoved).byPosition.QB[0].waiver.roleConfirmation,'UNCONFIRMED');
  const reowned=structuredClone(inputs);
  reowned.raw.rosters[1].players=['q'];
  assert.equal(Object.values(recomputeDecisionInputs(reowned).byPosition).flat().some(row=>row.sleeperId==='q'),false);
  const projectionChanged=structuredClone(inputs);
  projectionChanged.raw.projectionsByWeek[4].q.pts_ppr=25;
  const changed=recomputeDecisionInputs(projectionChanged).byPosition.QB[0];
  assert.equal(changed.events.rolePpg,25);
  const budgetChanged=structuredClone(inputs);
  budgetChanged.raw.rosters[0].settings.waiver_budget_used=1000;
  assert.equal(recomputeDecisionInputs(budgetChanged).byPosition.QB[0].waiver.personalMaxBid,0);
  assert.ok(changed.waiver.fit.targetWeekDelta > report.byPosition.QB[0].waiver.fit.targetWeekDelta);
});


test("usage/xFP and blended ROS are reextracted from archived stats rather than cached diagnostics", async () => {
  const { recomputeDecisionInputs } = await import('../scripts/decision-recompute.js');
  let inputs;
  const report=await getFreeAgents({...options,fetchImpl:fixture({recordedStats:true}),onDecisionInputs:value=>{inputs=value;}});
  const baseline=report.byPosition.QB.find(row=>row.sleeperId==='q');
  assert.equal(baseline.usageDiagnostic.sampleGames,3);
  assert.deepEqual(recomputeDecisionInputs(inputs).byPosition,report.byPosition);
  const altered=structuredClone(inputs);
  altered.raw.statsByWeek.forEach(batch=>{batch.stats.q.rush_att=12;batch.stats.q.pts_ppr=5;});
  const changed=recomputeDecisionInputs(altered).byPosition.QB.find(row=>row.sleeperId==='q');
  assert.notEqual(changed.xfp,baseline.xfp);
  assert.notEqual(changed.rosPpg,baseline.rosPpg);
  assert.notEqual(changed.usageDiagnostic.actualMinusXfp,baseline.usageDiagnostic.actualMinusXfp);
});

test('optional projection comparison preserves decisions and is recomputed from archived source rows', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { recomputeDecisionInputs } = await import('../scripts/decision-recompute.js');
  const directory = await mkdtemp(join(tmpdir(), 'adineu-comparison-'));
  try {
    const path = join(directory, 'capture.json');
    await writeFile(path, JSON.stringify({ version: 1, season: 2026, week: 4, scoring: 'PPR', capturedAt: asOf, sources: [{
      provider: 'draftsharks-com', capability: 'fantasy-sports-rankings/weekly_rankings', position: 'WR', fetchedAt: asOf,
      data: { season: 2026, week: 4, position: 'WR', scoring: 'PPR', superflex: false, observed_at_ms: Date.parse(asOf),
        source_url: 'https://www.draftsharks.com/weekly-rankings/', players: [{ name: 'WR A', team: 'CHI', position: 'WR', player_id: 888, projected_points: 25, opponent_id: 'SEA' }] }
    }] }));
    const fetchImpl = fixture({ wrAdds: true });
    const baseline = await getFreeAgents({ ...options, position: null, fetchImpl, projectionCapturePath: null });
    let inputs;
    const report = await getFreeAgents({ ...options, position: null, fetchImpl, projectionCapturePath: path, onDecisionInputs: value => { inputs = value; } });
    assert.equal(report.projectionComparison.status, 'CONTEXT_ONLY');
    assert.equal(report.projectionComparison.rows[0].playerId, 'wrA');
    assert.deepEqual(report.byPosition, baseline.byPosition);
    assert.deepEqual(report.acquisitionPlan, baseline.acquisitionPlan);
    assert.deepEqual(recomputeDecisionInputs(inputs).projectionComparison, report.projectionComparison);
    inputs.raw.projectionCapture.sources[0].data.players[0].projected_points = 30;
    const updated = recomputeDecisionInputs(inputs);
    assert.equal(updated.projectionComparison.rows[0].values[0].points, 30);
    assert.deepEqual(updated.byPosition, report.byPosition);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
