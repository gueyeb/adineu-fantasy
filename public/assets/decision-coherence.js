/**
 * Adineu Fantasy — Decision-engine coherence warnings (sanity checks before publication).
 * Backlog: docs/decision-engine-live-state-backlog-2026-10-05.md, P1 "optionalité et cohérence".
 *
 * Each warning is classified so a reader can tell apart:
 * - CALCULATION_INCONSISTENCY: the board contradicts its own rules — blocks publication;
 * - COVERAGE_GAP: something is known but not measurable/represented yet — to review;
 * - CONSTRAINT: a roster rule forces the outcome — informational;
 * - JUSTIFIED_WATCH: a WATCH/IGNORE explained by the cost of the cut — informational.
 *
 * Pure functions, no DOM, network or imports. Every input field is optional.
 */

export const COHERENCE_CATEGORIES = ["CALCULATION_INCONSISTENCY", "COVERAGE_GAP", "CONSTRAINT", "JUSTIFIED_WATCH"];

/** Severity is a function of the category: only a calculation inconsistency blocks publication. */
const SEVERITY_BY_CATEGORY = { CALCULATION_INCONSISTENCY: "BLOCKING", COVERAGE_GAP: "REVIEW", CONSTRAINT: "INFO", JUSTIFIED_WATCH: "INFO" };

/**
 * Cut-concentration review triggers: at least this many board rows naming a cut, and the most
 * named cut holding at least this share of them. Uncalibrated — they only ask for a human look.
 */
export const CUT_CONCENTRATION_MIN_ROWS = 5;
export const CUT_CONCENTRATION_SHARE = 0.6;

/** Maximum player ids listed by the capped warnings; `details.total` keeps the real count. */
export const COHERENCE_MAX_LISTED_IDS = 10;

const ACTIONABLE = new Set(["ADD_NOW", "CLAIM_IF_CHEAP"]);
const PASSIVE = new Set(["WATCH", "IGNORE"]);

const list = value => (Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []);
const idOf = row => (row?.sleeperId === null || row?.sleeperId === undefined || row.sleeperId === "" ? null : String(row.sleeperId));
const fitOf = row => (row?.waiver?.fit && typeof row.waiver.fit === "object" ? row.waiver.fit : null);
const actionOf = row => row?.waiver?.decision?.recommendedAction ?? null;
const isActionable = row => ACTIONABLE.has(actionOf(row));
const cutOf = row => {
  const cut = fitOf(row)?.dropCandidate;
  return cut && typeof cut === "object" ? cut : null;
};
const cutIdOf = row => idOf(cutOf(row));
const finite = value => typeof value === "number" && Number.isFinite(value);
const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined))];
const ids = rows => unique(rows.map(idOf));
const capped = rows => {
  const all = ids(rows);
  return { playerIds: all.slice(0, COHERENCE_MAX_LISTED_IDS), total: all.length };
};
const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count > 1 ? pluralForm : singular}`;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function warning(code, category, playerIds, details, message) {
  return { code, category, severity: SEVERITY_BY_CATEGORY[category], playerIds, details, message };
}

/** 1. One cut absorbs most of the board. Forced (only eligible cut) = constraint, otherwise to review. */
function cutConcentration(boardRows) {
  const withCut = boardRows.filter(row => cutIdOf(row) !== null);
  if (withCut.length < CUT_CONCENTRATION_MIN_ROWS) return [];
  const groups = new Map();
  for (const row of withCut) groups.set(cutIdOf(row), [...(groups.get(cutIdOf(row)) || []), row]);
  const [cutPlayerId, rows] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || compare(a[0], b[0]))[0];
  const share = rows.length / withCut.length;
  if (share < CUT_CONCENTRATION_SHARE) return [];
  const onlyEligible = rows.every(row => fitOf(row)?.cutSelection === "ONLY_ELIGIBLE_CUT");
  const cutName = rows.map(row => cutOf(row)?.name).find(Boolean) ?? null;
  const label = cutName || `joueur ${cutPlayerId}`;
  const details = { cutPlayerId, cutName, share: Number(share.toFixed(3)), rows: rows.length, rowsWithCut: withCut.length, onlyEligible };
  return [warning(
    "CUT_CONCENTRATION", onlyEligible ? "CONSTRAINT" : "COVERAGE_GAP", ids(rows), details,
    onlyEligible
      ? `${label} est la seule coupe éligible pour ${rows.length} des ${withCut.length} lignes du board qui désignent une coupe.`
      : `${label} est la coupe désignée pour ${rows.length} des ${withCut.length} lignes du board qui désignent une coupe : concentration à vérifier.`
  )];
}

/** 2. No row could rank its cut: every comparison lacks coverage. */
function noCutComparisonCovered(boardRows) {
  const withFit = boardRows.filter(fitOf);
  if (!withFit.length || !withFit.every(row => fitOf(row).cutSelection === "UNRANKED_INCOMPLETE_COVERAGE")) return [];
  const { playerIds, total } = capped(withFit);
  return [warning(
    "NO_CUT_COMPARISON_COVERED", "COVERAGE_GAP", playerIds, { total, rows: withFit.length },
    `Aucune des ${plural(withFit.length, "ligne évaluée", "lignes évaluées")} n'a pu classer sa coupe : couverture incomplète.`
  )];
}

/** 3. A sourced event put the player on the board, but no flag or role profile explains its effect. */
function newsWithoutExplainedEffect(boardRows) {
  const rows = boardRows.filter(row => {
    const sourced = list(row.ripple).some(entry => entry.trigger === "SOURCED_EVENT")
      || (Array.isArray(row.poolEntry?.reasons) && row.poolEntry.reasons.includes("SOURCED_EVENT"));
    const flags = Array.isArray(row.events?.flags) ? row.events.flags : [];
    return sourced && !flags.length && !row.roleProfile?.profile;
  });
  if (!rows.length) return [];
  const { playerIds, total } = capped(rows);
  return [warning(
    "NEWS_WITHOUT_EXPLAINED_EFFECT", "COVERAGE_GAP", playerIds, { total },
    `${plural(total, "joueur")} du board ${total > 1 ? "sont liés" : "est lié"} à un événement sourcé dont l'effet n'est pas encore mesurable (aucun signal ni profil de rôle).`
  )];
}

/** 4. A cut sacrifices an organic progression that is not justified or not priced. */
function progressionIgnored(boardRows) {
  const buckets = new Map();
  for (const row of boardRows) {
    const guard = fitOf(row)?.progressionGuard;
    if (!cutOf(row) || (guard !== "NOT_JUSTIFIED" && guard !== "UNPRICED")) continue;
    const category = isActionable(row) ? "CALCULATION_INCONSISTENCY" : guard === "UNPRICED" ? "COVERAGE_GAP" : "JUSTIFIED_WATCH";
    buckets.set(category, [...(buckets.get(category) || []), row]);
  }
  const messages = {
    CALCULATION_INCONSISTENCY: count => `${plural(count, "recommandation actionnable", "recommandations actionnables")} ${count > 1 ? "sacrifient" : "sacrifie"} une progression organique non justifiée ou non chiffrée.`,
    COVERAGE_GAP: count => `${plural(count, "ligne non actionnable", "lignes non actionnables")} ${count > 1 ? "désignent" : "désigne"} une coupe dont la progression organique n'est pas chiffrée.`,
    JUSTIFIED_WATCH: count => `${plural(count, "ligne non actionnable", "lignes non actionnables")} : le gain ne justifie pas de sacrifier la progression organique de la coupe.`
  };
  return [...buckets.entries()].map(([category, rows]) => warning(
    "PROGRESSION_IGNORED", category, ids(rows),
    {
      rows: rows.map(row => ({
        playerId: idOf(row), cutPlayerId: cutIdOf(row), guard: fitOf(row).progressionGuard,
        progressionSacrificeTotal: finite(fitOf(row).progressionSacrificeTotal) ? fitOf(row).progressionSacrificeTotal : null
      }))
    },
    messages[category](rows.length)
  ));
}

/** 5. Pinned or news-driven free agents missing from the board. Pinning guarantees presence: its absence is a bug. */
function relevantCandidateAbsent(marketRows, boardIds) {
  const absent = marketRows.filter(row => idOf(row) !== null && !boardIds.has(idOf(row)));
  const pinned = absent.filter(row => row.poolEntry?.pinned === true);
  const news = absent.filter(row => row.poolEntry?.pinned !== true && row.events?.newsOverride === true);
  const out = [];
  if (pinned.length) {
    const { playerIds, total } = capped(pinned);
    out.push(warning(
      "PINNED_CANDIDATE_ABSENT", "CALCULATION_INCONSISTENCY", playerIds, { total },
      `${plural(total, "candidat épinglé", "candidats épinglés")} ${total > 1 ? "sont absents" : "est absent"} du board alors que l'épinglage garantit la présence.`
    ));
  }
  if (news.length) {
    const { playerIds, total } = capped(news);
    out.push(warning(
      "RELEVANT_CANDIDATE_ABSENT", "COVERAGE_GAP", playerIds, { total },
      `${plural(total, "agent libre signalé", "agents libres signalés")} par une news ${total > 1 ? "sont absents" : "est absent"} du board.`
    ));
  }
  return out;
}

/** 6. BUY_LOW free agents missing from the board, and BUY_LOW roster players cut by an actionable move. */
function buyLow(boardRows, marketRows, myPlayers, boardIds) {
  const out = [];
  const absent = marketRows.filter(row => row.usageSignal === "BUY_LOW" && idOf(row) !== null && !boardIds.has(idOf(row)));
  if (absent.length) {
    const { playerIds, total } = capped(absent);
    out.push(warning(
      "BUY_LOW_NOT_REPRESENTED", "COVERAGE_GAP", playerIds, { total },
      `${plural(total, "agent libre")} en signal BUY_LOW ${total > 1 ? "ne sont pas représentés" : "n'est pas représenté"} sur le board.`
    ));
  }
  const cuts = myPlayers.filter(player => player.usageSignal === "BUY_LOW" && idOf(player) !== null).map(player => ({
    cutPlayerId: idOf(player),
    cutName: player.name ?? null,
    addPlayerIds: ids(boardRows.filter(row => isActionable(row) && cutIdOf(row) === idOf(player)))
  })).filter(cut => cut.addPlayerIds.length);
  if (cuts.length) {
    out.push(warning(
      "BUY_LOW_DESIGNATED_AS_CUT", "CALCULATION_INCONSISTENCY", unique(cuts.map(cut => cut.cutPlayerId)), { cuts },
      `${plural(cuts.length, "joueur")} de l'effectif en signal BUY_LOW ${cuts.length > 1 ? "sont désignés" : "est désigné"} comme coupe d'une recommandation actionnable.`
    ));
  }
  return out;
}

/** 7. Positive gross gain, but the cut cost brings the selection score to zero or below. */
function watchJustifiedByCutCost(boardRows) {
  const rows = boardRows.filter(row => {
    const fit = fitOf(row);
    // Without a designated cut (open slot, unranked) no cut cost explains the WATCH.
    return PASSIVE.has(actionOf(row)) && fit?.dropCandidate && finite(fit.grossGainTotal) && fit.grossGainTotal > 0
      && finite(fit.selectionScore) && fit.selectionScore <= 0;
  });
  if (!rows.length) return [];
  const { playerIds, total } = capped(rows);
  return [warning(
    "WATCH_JUSTIFIED_BY_CUT_COST", "JUSTIFIED_WATCH", playerIds, { total },
    `${plural(total, "candidat")} ${total > 1 ? "apportent" : "apporte"} un gain brut positif mais ${total > 1 ? "restent" : "reste"} en WATCH/IGNORE : le coût de la coupe annule le gain.`
  )];
}

/** 8. An actionable move must rest on a covered net gain and a covered valuation. */
function actionableWithoutCoveredGain(boardRows) {
  const flagged = boardRows.filter(isActionable).map(row => ({
    row,
    netGainMissing: !finite(fitOf(row)?.netGainTotal),
    valuationUncovered: row.poolEntry?.valuationCovered === false
  })).filter(entry => entry.netGainMissing || entry.valuationUncovered);
  if (!flagged.length) return [];
  const rows = flagged.map(entry => entry.row);
  return [warning(
    "ACTIONABLE_WITHOUT_COVERED_GAIN", "CALCULATION_INCONSISTENCY", ids(rows),
    { rows: flagged.map(({ row, netGainMissing, valuationUncovered }) => ({ playerId: idOf(row), action: actionOf(row), netGainMissing, valuationUncovered })) },
    `${plural(rows.length, "recommandation actionnable", "recommandations actionnables")} sans gain net chiffré ou sans valorisation couverte.`
  )];
}

/** Can the board be acted on? A complete, coherent report can still be unusable when nothing says
 * whether a player can be added, or when a known need has no executable step. */
function decisionReadiness(board, { emptyStarterSlotCount = 0, planStepCount = null } = {}) {
  const out = [];
  const withAvailability = board.filter(row => row?.availability);
  if (withAvailability.length && withAvailability.every(row => row.availability.availability === "UNKNOWN")) {
    out.push(warning("AVAILABILITY_UNVERIFIED", "COVERAGE_GAP", [], { total: withAvailability.length },
      `Disponibilité non vérifiée pour les ${withAvailability.length} candidats affichés : impossible de distinguer ajout libre et claim, aucune action ni enchère n'est proposée.`));
  }
  if (emptyStarterSlotCount > 0 && planStepCount === 0) {
    out.push(warning("EMPTY_STARTER_SLOT_UNRESOLVED", "COVERAGE_GAP", [], { emptyStarterSlotCount },
      `${plural(emptyStarterSlotCount, "slot titulaire vide", "slots titulaires vides")} sans étape exécutable dans le plan : le besoin est identifié, pas résolu.`));
  }
  return out;
}
const DEGRADING_CODES = ["AVAILABILITY_UNVERIFIED", "EMPTY_STARTER_SLOT_UNRESOLVED", "NO_CUT_COMPARISON_COVERED"];

/**
 * Sanity checks run on an evaluated waiver board before it is published.
 * boardRows: evaluated rows shown on the board. marketRows: every evaluated free agent (superset,
 * same ids). myPlayers: roster players. `publishable` is false iff a CALCULATION_INCONSISTENCY exists.
 */
export function buildCoherenceWarnings({ boardRows = [], marketRows = [], myPlayers = [], rosterState = {}, modelDegraded = false } = {}) {
  const names = new Map([...list(marketRows), ...list(boardRows), ...list(myPlayers)].filter(row => row?.sleeperId != null).map(row => [String(row.sleeperId), row.name ?? null]));
  const board = list(boardRows);
  const market = list(marketRows);
  const roster = list(myPlayers);
  const boardIds = new Set(ids(board));
  const warnings = [
    ...cutConcentration(board),
    ...noCutComparisonCovered(board),
    ...newsWithoutExplainedEffect(board),
    ...progressionIgnored(board),
    ...relevantCandidateAbsent(market, boardIds),
    ...buyLow(board, market, roster, boardIds),
    ...watchJustifiedByCutCost(board),
    ...actionableWithoutCoveredGain(board),
    ...decisionReadiness(board, rosterState ?? {})
  ].sort((a, b) => COHERENCE_CATEGORIES.indexOf(a.category) - COHERENCE_CATEGORIES.indexOf(b.category)
    || compare(a.code, b.code) || compare(a.playerIds[0] ?? "", b.playerIds[0] ?? ""));
  const counts = Object.fromEntries(COHERENCE_CATEGORIES.map(category => [category, warnings.filter(item => item.category === category).length]));
  // Names travel with the result so every output can print them without another lookup.
  const playerNames = Object.fromEntries([...new Set(warnings.flatMap(item => item.playerIds))].filter(id => names.get(id)).map(id => [id, names.get(id)]));
  // BLOCKED: do not send. DEGRADED: readable, but not a plan to execute. Distinct from model coverage.
  const publishable = counts.CALCULATION_INCONSISTENCY === 0;
  const reasons = [...warnings.filter(item => DEGRADING_CODES.includes(item.code)).map(item => item.code), ...(modelDegraded ? ["MODEL_COVERAGE_DEGRADED"] : [])];
  const decisionStatus = { status: !publishable ? "BLOCKED" : reasons.length ? "DEGRADED" : "EXECUTABLE", reasons };
  return { warnings, publishable, counts, playerNames, decisionStatus };
}

/** Text lines for the AI context / CLI: a verdict line, then one line per warning. */
export function formatCoherenceWarnings(result, { nameOf = () => null } = {}) {
  const warnings = list(result?.warnings);
  const status = result?.decisionStatus;
  const statusLine = status?.status === "DEGRADED" ? [`⚠ DÉCISION DÉGRADÉE (${status.reasons.join(", ")}) : rapport lisible, pas un plan exécutable.`] : [];
  if (!warnings.length) return [...statusLine, "Cohérence : aucun avertissement."];
  const label = id => nameOf(id) || result?.playerNames?.[id] || id;
  const blocking = warnings.filter(item => item.category === "CALCULATION_INCONSISTENCY").length;
  return [
    ...statusLine,
    blocking ? `Cohérence : NON publiable (${blocking} incohérence(s) de calcul)` : "Cohérence : publiable",
    ...warnings.map(item => {
      const listed = Array.isArray(item.playerIds) ? item.playerIds : [];
      const hidden = finite(item.details?.total) ? Math.max(0, item.details.total - listed.length) : 0;
      const suffix = listed.length ? ` (${listed.map(label).join(", ")}${hidden ? `… +${hidden}` : ""})` : "";
      return `[${item.category}/${item.severity}] ${item.code} — ${item.message}${suffix}`;
    })
  ];
}

/** Required starter slots not filled by a rostered player ("0" in Sleeper's starters). */
export function countEmptyStarterSlots(fitContext, requiredSlots) {
  if (!fitContext?.starterIds) return 0;
  const filled = [...fitContext.starterIds].filter(id => id && String(id) !== "0").length;
  return Math.max(0, requiredSlots - filled);
}
