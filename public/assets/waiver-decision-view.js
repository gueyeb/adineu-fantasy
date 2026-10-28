/** Presentation only: reuse engine decisions, never calculate a second waiver recommendation. */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const blockerLabels = {
  NO_LEGAL_TRANSACTION: "Aucun mouvement complet ajout–coupe démontré",
  INCOMPLETE_HORIZON: "Projections incomplètes sur la période",
  TARGET_WEEK_ELIGIBILITY_UNVERIFIED: "Éligibilité pour la semaine cible non confirmée",
  ROLE_UNCONFIRMED: "Rôle du joueur non confirmé",
  NO_TARGET_WEEK_GAIN: "Aucun gain démontré pour la semaine cible",
  UNKNOWN_FAAB_BALANCE: "Budget FAAB non confirmé",
  GAME_LOCKED: "Match commencé : scénario actuel verrouillé",
  RECENT_DROP_CLEARANCE_UNVERIFIED: "Déblocage après coupe non confirmé",
  NO_PROJECTION: "Projection absente",
  PLAN_NOT_PUBLISHABLE: "Contradiction du plan à résoudre avant action",
  REPORT_STALE: "Date du rapport absente ou périmée : recharger avant de décider"
};
export function waiverBlockerLabel(code) {
  return blockerLabels[code] || (String(code).startsWith("PROGRESSION_SACRIFICE_") ? "Progression du joueur coupé insuffisamment valorisée" : "Contrôle complémentaire requis");
}
export function classifyWaiverPresentation(player, { asOf = null, now = Date.now() } = {}) {
  const decision = player.waiver?.decision;
  const fit = player.waiver?.fit;
  const availability = player.availability;
  const blockers = Array.isArray(decision?.actionBlockers) ? decision.actionBlockers : [];
  const captured = Date.parse(asOf);
  const fresh = Number.isFinite(captured) && Number.isFinite(now) && now >= captured && now - captured <= 300000;
  if (!fresh) return { bucket: "watch", label: "Rapport à rafraîchir avant toute action", blockers: [...blockers, "REPORT_STALE"] };
  const supported = Array.isArray(decision?.actionBlockers) && blockers.length === 0 && fit?.legalTransaction === true && fit?.horizonCovered === true;
  if (decision?.recommendedAction === "ADD_NOW" && supported && availability?.canAddNow === true && availability?.availability === "FREE_AGENT") {
    return availability.verified === true && availability.availabilitySource === "OPERATOR_EVIDENCE" && !decision.confirmation
      ? { bucket: "now", label: "Ajout libre proposé", blockers }
      : { bucket: "prepare", label: "Confirmer la disponibilité avant ajout", blockers };
  }
  if (decision?.recommendedAction === "CLAIM_IF_CHEAP" && supported && availability?.availability === "WAIVER_LOCKED" && Number.isFinite(player.waiver?.suggestedBid)) {
    return { bucket: "prepare", label: "Préparer un claim, attribution non garantie", blockers };
  }
  return { bucket: "watch", label: decision?.recommendedAction === "IGNORE" ? "Aucun mouvement conseillé par le moteur" : "Surveiller ou compléter les données", blockers };
}
export function partitionWaiverDecisions(players = [], context = {}) {
  const groups = { now: [], prepare: [], watch: [] };
  for (const player of players) {
    const presentation = classifyWaiverPresentation(player, context);
    groups[presentation.bucket].push({ player, presentation });
  }
  return groups;
}
export function renderWaiverDecisionBoard(report, { available = true, now = Date.now() } = {}) {
  if (!available) return '<section class="waiver-decision-board"><h3>Décisions indisponibles</h3><p>Le rapport n’a pas pu être chargé. Aucun résultat vide n’est interprété comme une absence d’opportunité.</p></section>';
  const reportTime = Date.parse(report.availabilityAsOf);
  const dateLabel = Number.isFinite(reportTime) ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(reportTime)) + " Paris" : "date non disponible";
  const groups = partitionWaiverDecisions(Object.values(report.byPosition || {}).flat(), { asOf: report.availabilityAsOf, now });
  const amount = value => Number.isFinite(value) ? `${value} $` : "non déterminé";
  const card = ({ player, presentation }) => {
    const fit = player.waiver?.fit;
    const raw = presentation.blockers;
    return `<article class="card" style="padding:12px;margin:8px 0;"><strong>${escape(player.name)}</strong> · ${escape(player.position)}<p>${escape(presentation.label)} · semaine cible S${escape(report.week ?? "?")}</p>
      <p>Coupe candidate : ${escape(fit?.dropCandidate?.name || (fit?.legalTransaction === true ? "place libre selon le moteur" : "à déterminer"))} · Gain net sur la période : ${Number.isFinite(fit?.netGainTotal) ? `${escape(fit.netGainTotal)} pts estimés` : "non déterminé"}</p>
      ${player.waiver?.decision?.recommendedAction === "CLAIM_IF_CHEAP" ? `<p>Enchère proposée : ${escape(amount(player.waiver.suggestedBid))} · Plafond personnel estimé : ${escape(amount(player.waiver.personalMaxBid))}. Claims partageant une coupe : alternatives, pas achats cumulables.</p>` : ""}
      ${presentation.bucket === "prepare" ? '<p>Vérifier disponibilité, budget, coupe et échéance dans Sleeper avant de soumettre. Une préparation n’est pas un mouvement exécuté.</p>' : ""}
      ${raw.length ? `<ul>${[...new Set(raw.map(waiverBlockerLabel))].map(label => `<li>${escape(label)}</li>`).join("")}</ul><details><summary>Détail des contrôles du moteur</summary><p>${raw.map(escape).join(" · ")}</p></details>` : ""}</article>`;
  };
  const sections = [["now", "Actions possibles maintenant", "Aucun ajout libre vérifié pour cette équipe dans ce rapport."], ["prepare", "Préparer les waivers ou confirmer l’ajout", "Aucune préparation qualifiée dans ce rapport."], ["watch", "À surveiller / données à compléter", "Aucun autre candidat dans ce rapport."]];
  return `<section class="waiver-decision-board"><h3>Décider pour ton équipe · S${escape(report.week ?? "?")}</h3><p>Lecture des décisions existantes du moteur. Données au ${escape(dateLabel)}. Vérifier à nouveau les conditions dans Sleeper au moment d’agir ; les acquisitions restent des alternatives.</p>${sections.map(([key, title, empty]) => `<details data-waiver-section="${key}" ${key === "now" ? "open" : ""}><summary>${title} (${groups[key].length})</summary>${groups[key].length ? groups[key].slice(0, 5).map(card).join("") + (groups[key].length > 5 ? `<details><summary>Voir les ${groups[key].length - 5} autres candidats</summary>${groups[key].slice(5).map(card).join("")}</details>` : "") : `<p>${empty}</p>`}</details>`).join("")}</section>`;
}

export function waiverAvailabilityLabel(player) {
  const availability = { FREE_AGENT: "Ajout libre", WAIVER_LOCKED: "En waivers", GAME_LOCKED: "Match commencé", ROSTERED: "Déjà dans un roster", UNKNOWN: "Disponibilité non confirmée" }[player.availability?.availability] || "Disponibilité non confirmée";
  const action = { ADD_NOW: "ajout proposé", CLAIM_IF_CHEAP: "claim à préparer", WATCH: "à surveiller", IGNORE: "aucun mouvement conseillé", UNDETERMINED: "décision non déterminée" }[player.waiver?.decision?.recommendedAction] || "décision non déterminée";
  return `${availability}${player.availability?.availabilitySource === "LEAGUE_RULES_INFERRED" ? " (déduit, à confirmer dans Sleeper)" : ""} · ${action}`;
}

/** Adapter for compact Coach/plan rows; missing facts never become positive evidence. */
export function compactWaiverCandidate(row) {
  const facts = row.presentationFacts || {};
  return { ...row, waiver: { decision: { recommendedAction: row.recommendedAction, actionBlockers: facts.actionBlockers, confirmation: facts.confirmation },
    fit: { legalTransaction: facts.legalTransaction, horizonCovered: facts.horizonCovered }, suggestedBid: row.suggestedBid } };
}
export function classifyCompactWaiverPresentation(row, { asOf = null, now = Date.now(), publishable = null } = {}) {
  const result = classifyWaiverPresentation(compactWaiverCandidate(row), { asOf, now });
  if (publishable === false) return { bucket: "watch", label: "Plan non publiable : contrôles à corriger avant action", blockers: [...result.blockers, "PLAN_NOT_PUBLISHABLE"] };
  if (row.dependsOnPlayerIds?.length && result.bucket !== "watch") return { ...result, bucket: "prepare", label: "Plan conditionnel : résultats des ajouts précédents à confirmer" };
  return result;
}

/** Shared envelope: source dates, gains and blockers survive every output adapter. */
export function qualifyDecision(row, { compact = false, asOf = null, now = Date.now(), publishable = null, week = null, dataThroughWeek = null } = {}) {
  const presentation = compact ? classifyCompactWaiverPresentation(row, { asOf, now, publishable })
    : classifyCompactWaiverPresentation({ ...row, recommendedAction: row.waiver?.decision?.recommendedAction,
      suggestedBid: row.waiver?.suggestedBid, presentationFacts: { legalTransaction: row.waiver?.fit?.legalTransaction,
        horizonCovered: row.waiver?.fit?.horizonCovered, actionBlockers: row.waiver?.decision?.actionBlockers,
        confirmation: row.waiver?.decision?.confirmation } }, { asOf, now, publishable });
  return { ...presentation, availabilityAsOf: asOf, dataThroughWeek, effectiveWeek: week,
    netGainTotal: compact ? row.netGainTotal ?? null : row.waiver?.fit?.netGainTotal ?? null };
}
