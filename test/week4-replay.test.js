import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractDecisionFeatures } from "../scripts/decision-features.js";
import { evaluateMarket, evaluateRosterFit } from "../public/assets/waiver-model.js";
import { summarizeRecentTransactions } from "../public/assets/acquisition-availability.js";
import { BYE_WEEKS_2026 } from "../public/assets/league-settings.js";

// Rejeu des cas Week 4 du document « Corrections ADINEU » sur un extrait du snapshot collecté le
// 5 octobre 2026 (données Sleeper telles que publiées ce jour-là ; voir meta dans la fixture).
const fx = JSON.parse(readFileSync(new URL("./fixtures/week4-2026-replay.json", import.meta.url), "utf8"));
const n = fx.named;
const scope = { asOf: fx.asOf, week: fx.week, lastCompletedWeek: fx.lastCompletedWeek, season: fx.season, leagueId: fx.leagueId };
const features = (rosters, overrides = {}) => extractDecisionFeatures({ index: new Map(Object.entries(fx.playersIndex)), catalog: { players: [] },
  nflState: fx.nflState, projectionsByWeek: fx.projectionsByWeek, statsByWeek: fx.statsByWeek, fetchedAtByPath: {}, roleEvidenceById: {}, rosters, ...scope, ...overrides });
// État d'avant la transaction du 4 octobre : Harris encore au roster 1, Jennings agent libre.
const beforeTrade = fx.rosters.map(roster => roster.roster_id !== 1 ? roster
  : { ...roster, players: [...roster.players.filter(id => id !== n.jennings), n.harris] });
const row = (result, id) => result.rows.find(candidate => candidate.sleeperId === id);
const fitContext = (result, rosters, overrides = {}) => {
  const roster = rosters.find(candidate => candidate.roster_id === 1);
  const weeklyPaceOf = (player, week) => BYE_WEEKS_2026[player.nflTeam] === week ? 0 : fx.projectionsByWeek[week]?.[player.sleeperId]?.pts_ppr ?? null;
  return { myPlayers: roster.players.map(result.rosterPlayerFor), week: fx.week, faabRemaining: 497,
    paceOf: player => player.effectivePpg ?? result.rosFor(player.sleeperId, player) ?? 0, weeklyPaceOf,
    projectionCovered: (player, week) => Number.isFinite(weeklyPaceOf(player, week)),
    protectedIds: new Set(roster.reserve), reserveIds: new Set(roster.reserve), starterIds: new Set(roster.starters), ...overrides };
};

test("Harris → Jennings: the organic riser is no longer the cut that pays for a one-week injury rental", () => {
  const result = features(beforeTrade);
  const harris = result.rosterPlayerFor(n.harris);
  // xFP en hausse deux semaines de suite, alors que le titulaire devant lui jouait encore la S3.
  assert.equal(harris.emergingRole.progression, "RISING");
  assert.equal(harris.emergingRole.consecutiveRises, 2);
  assert.equal(harris.emergingRole.progressionSource, "ORGANIC");
  assert.deepEqual(harris.ripple.map(entry => entry.triggerPlayerId), [n.mcconkey]);
  assert.ok(fx.statsByWeek.at(-1).stats[n.mcconkey].off_snp > 0);
  assert.equal(harris.emergingRole.routesDelta, null);

  const jennings = row(result, n.jennings);
  assert.ok(jennings.events.flags.includes("PROMOTION"));
  assert.equal(jennings.events.roleConfirmation, "UNCONFIRMED");
  assert.equal(jennings.events.roleWeeks, 1);
  assert.equal(jennings.roleProfile.profile, "PURE_RENTAL");
  assert.deepEqual(jennings.ripple.map(entry => entry.triggerPlayerId), [n.jefferson]);

  const market = evaluateMarket({ rows: result.rows, week: fx.week });
  const marketRow = market.find(candidate => candidate.sleeperId === n.jennings);
  const context = fitContext(result, beforeTrade);
  // Ce que faisait le moteur : sans la valeur d'option du rôle émergent, Harris est la coupe désignée.
  const blind = evaluateRosterFit({ marketRow, ...context, myPlayers: context.myPlayers.map(player => ({ ...player, emergingRole: null })) });
  assert.equal(blind.dropCandidate.sleeperId, n.harris);

  const fit = evaluateRosterFit({ marketRow, ...context });
  assert.equal(fit.horizonCovered, true);
  assert.equal(fit.horizonWeeks, 1);
  assert.notEqual(fit.dropCandidate.sleeperId, n.harris);
  const harrisCut = evaluateRosterFit({ marketRow, ...context, lockedIds: new Set(context.myPlayers.map(player => player.sleeperId).filter(id => id !== n.harris)) });
  assert.equal(harrisCut.cutSelection, "ONLY_ELIGIBLE_CUT");
  assert.equal(harrisCut.progressionGuard, "NOT_JUSTIFIED");
  assert.ok(harrisCut.progressionSacrificeTotal > 0);
  assert.equal(harrisCut.faabMaxForMe, 0);
  // Aucune coupe ne rend la location rentable : pas d'action chiffrée positive.
  assert.ok(fit.selectionScore <= 0);
});

test("Kamara: on the real roster, the missing IR projections no longer make the lowest id the cut", () => {
  const result = features(fx.rosters);
  const market = evaluateMarket({ rows: result.rows, week: fx.week });
  const marketRow = market.find(candidate => candidate.sleeperId === n.coleman);
  const context = fitContext(result, fx.rosters);
  const blocked = evaluateRosterFit({ marketRow, ...context, reserveIds: new Set() });
  assert.equal(blocked.cutSelection, "UNRANKED_INCOMPLETE_COVERAGE");
  assert.equal(blocked.dropCandidate, null);
  assert.equal(blocked.coverageBlockers.every(blocker => fx.rosters.find(roster => roster.roster_id === 1).reserve.includes(blocker.playerId)), true);
  // L'ordre brut (même poste, puis identifiant) n'est plus présenté comme un classement.
  assert.ok(blocked.dropCandidates.length > 0);
  assert.ok(blocked.dropCandidates.every(candidate => candidate.ranked === false && candidate.netGainTotal === null));

  const fit = evaluateRosterFit({ marketRow, ...context });
  assert.equal(fit.cutSelection, "RANKED_BY_NET_GAIN");
  assert.notEqual(fit.dropCandidate.sleeperId, n.kamara);
  const kamara = evaluateRosterFit({ marketRow, ...context, lockedIds: new Set(context.myPlayers.map(player => player.sleeperId).filter(id => id !== n.kamara)) });
  assert.equal(kamara.cutSelection, "ONLY_ELIGIBLE_CUT");
  assert.equal(kamara.dropCostComponents.optionCoverage, "COMPLETE");
  assert.ok(kamara.dropCostComponents.inputs.gamesPlayed >= 1);
});

test("Coleman / DJ Moore: the Sleeper status flags Coleman for re-evaluation, without any share or role change", () => {
  const result = features(fx.rosters);
  assert.equal(fx.playersIndex[n.djMoore].injuryStatus, "Questionable");
  const coleman = row(result, n.coleman);
  const fromMoore = coleman.ripple.filter(entry => entry.triggerPlayerId === n.djMoore);
  assert.deepEqual(fromMoore.map(entry => [entry.trigger, entry.certainty, entry.effect, entry.shareAttributed, entry.successionInferred]),
    [["SNAPSHOT_STATUS", "POSSIBLE_ABSENCE", "REEVALUATE", null, false]]);
  // Une absence seulement possible ne crée ni promotion ni profil de rôle, et ne modifie aucune valorisation.
  assert.deepEqual(coleman.events.flags, []);
  assert.equal(coleman.roleProfile.profile, null);
  const withoutStatus = { ...fx.playersIndex, [n.djMoore]: { ...fx.playersIndex[n.djMoore], injuryStatus: null } };
  const healthy = row(features(fx.rosters, { index: new Map(Object.entries(withoutStatus)) }), n.coleman);
  assert.equal(healthy.ripple.filter(entry => entry.triggerPlayerId === n.djMoore).length, 0);
  assert.equal(healthy.effectivePpg, coleman.effectivePpg);
});

test("Douglas: Out in the snapshot, he enters only through a dated operator event and stays on the board", () => {
  assert.equal(fx.playersIndex[n.douglas].injuryStatus, "Out");
  assert.equal(row(features(fx.rosters), n.douglas), undefined);
  // Événement opérateur fictif : la fixture n'affirme aucun retour réel.
  const event = { type: "RETURN", nflTeam: "MIA", positions: ["WR"], source: "fixture://operator-observation", observedAt: fx.asOf,
    expiresAt: new Date(Date.parse(fx.asOf) + 24 * 3600 * 1000).toISOString(), targetWeek: fx.week, season: fx.season, leagueId: fx.leagueId };
  const result = features(fx.rosters, { eventsById: { [n.douglas]: event } });
  const douglas = row(result, n.douglas);
  assert.ok(douglas.poolEntry.reasons.includes("SOURCED_EVENT"));
  assert.equal(douglas.poolEntry.pinned, true);
  assert.equal(douglas.poolEntry.statusAlert, true);
  // Sleeper ne publie aucune projection pour la semaine cible d'un joueur Out : elle reste absente.
  assert.equal(douglas.weekProjection, null);
  assert.deepEqual(douglas.events.flags, []);
  // Le reste du groupe WR de Miami est signalé à réévaluer, y compris un joueur déjà rosté ailleurs.
  assert.ok(result.rosterPlayerFor(n.washington).ripple.some(entry => entry.triggerPlayerId === n.douglas && entry.trigger === "SOURCED_EVENT"));
});

test("Washington / Wilson: owned by other rosters, they are out of the pool and named in the transaction summary", () => {
  const result = features(fx.rosters);
  assert.equal(row(result, n.washington), undefined);
  assert.equal(row(result, n.wilson), undefined);
  const identity = rosterId => {
    const user = fx.users.find(candidate => candidate.user_id === fx.rosters.find(roster => roster.roster_id === rosterId)?.owner_id);
    return { teamName: user?.metadata?.team_name ?? user?.display_name ?? null, manager: user?.display_name ?? null };
  };
  const summary = summarizeRecentTransactions(fx.transactions, { asOf: fx.asOf, rosters: fx.rosters, playerMeta: id => fx.playersIndex[id] ?? null, rosterMeta: identity });
  const wilson = summary.recentTransactions.flatMap(transaction => transaction.movements).find(move => move.playerId === n.wilson);
  assert.equal(wilson.playerName, "Emanuel Wilson");
  assert.equal(wilson.action, "ADD");
  assert.equal(wilson.availability, "ROSTERED");
  assert.ok(wilson.manager);
  // La coupe de Harris ne prouve pas qu'il est libre.
  const harris = summary.recentTransactions.flatMap(transaction => transaction.movements).find(move => move.playerId === n.harris && move.action === "DROP");
  assert.equal(harris.availability, "UNKNOWN");
  assert.deepEqual(row(result, n.harris) && row(features(fx.rosters, { allTransactions: fx.transactions }), n.harris).poolEntry.reasons.includes("RECENT_DROP"), true);
});
