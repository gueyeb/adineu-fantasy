import { estimatePregameWinProbability, pregameEstimatePresentation } from "./win-probability.js?v=71b4f153fa";
import { accountNote, describeIdentity, managerLabel, teamLabel } from "./manager-identity.js?v=cf74623f30";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const points = value => Number.isFinite(value) ? value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "—";
// Live Sleeper users: canonical manager when confirmed, current account, public team name or none.
const identityOf = row => row.account !== undefined ? describeIdentity({ account: row.account, teamName: row.publicTeamName, accountIsCurrent: true }) : null;
const teamText = row => { const identity = identityOf(row); return identity ? teamLabel(identity) : row.teamName; };
const managerText = row => { const identity = identityOf(row); if (!identity) return row.manager ?? ""; const note = accountNote(identity); return `${managerLabel(identity)}${note ? ` · ${note}` : ""}`; };
const record = row => `${row.wins}–${row.losses}${row.ties ? `–${row.ties}` : ""}`;
const states = { PREGAME: "À venir", LIVE: "En cours", FINAL: "Terminé", BYE: "Bye", EMPTY: "Vide", UNKNOWN: "Non vérifié" };
const reasons = { INCOMPLETE_HISTORY: "Les semaines précédentes ne sont pas toutes disponibles : classement provisoire suspendu.", INCOMPLETE_MATCHUPS: "Les six affiches ne sont pas toutes disponibles : classement provisoire suspendu.", OUTSIDE_REGULAR_SEASON: "Ce classement provisoire est réservé à la saison régulière fantasy.", UNSUPPORTED_STANDINGS_RULE: "Les règles de classement publiées ne sont pas prises en charge." };

export function renderLiveStandings(report, mode = "live") {
  const projected = mode === "projected";
  const controls = `<div class="live-standing-toolbar" role="group" aria-label="Scénario de classement"><button type="button" class="filter-btn" data-standing-mode="live" aria-pressed="${!projected}">Scores actuels</button><button type="button" class="filter-btn" data-standing-mode="projected" aria-pressed="${projected}">Estimation fin de semaine</button></div>`;
  const title = projected ? "Si les estimations se confirmaient" : "Si les scores actuels se figeaient";
  if (!report?.ready) return `<h3>Classement pendant la semaine</h3><p class="note">${escape(reasons[report?.reason] || "Classement provisoire indisponible.")}</p>`;
  const rows = projected ? report.projected : report.live;
  return `<div class="section-head"><div><p class="eyebrow">S${report.week} · scénario provisoire</p><h3>${title}</h3></div></div>${controls}
    <p class="note">Base : semaines ${report.baselineThroughWeek ? `terminées jusqu’à S${report.baselineThroughWeek}` : "non encore jouées"}. ${projected ? "Les résultats sont estimés, pas acquis." : report.started ? "Le résultat de chaque duel commencé est appliqué au score du moment. Tout peut encore changer." : "Aucun duel commencé : le bilan précédent est conservé, sans égalité fictive à 0–0."} Ce n’est pas le classement final officiel.</p>
    ${rows?.length ? `<div class="table-wrap"><table class="live-standing-table"><thead><tr><th>Rang</th><th>Équipe</th><th>Bilan ${projected ? "estimé" : "provisoire"}</th><th class="num">${projected ? "Semaine estimée" : "Score actuel"}</th><th class="num">PF cumulés</th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${row.rank}</strong><small>${row.rankChange > 0 ? `↑${row.rankChange}` : row.rankChange < 0 ? `↓${-row.rankChange}` : "="} · avant S${report.week} : ${row.baselineRank}</small></td><td><strong>${escape(teamText(row))}</strong><small>${escape(managerText(row))}</small></td><td>${record(row)}</td><td class="num">${points(row.weekPoints)}</td><td class="num">${points(row.pointsFor)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="state">Estimation suspendue : les projections ou les états NFL ne couvrent pas toutes les lineups. Le scénario aux scores actuels reste disponible.</p>`}
    <p class="note">${escape(report.standingsRule)} Les rangs égaux sont partagés.</p>
    <details class="method-note"><summary>Comment lire l’estimation</summary><p>${escape(report.projectionNote)} Les corrections de score et changements de lineup restent possibles. Les sources sont lues séparément.</p></details>`;
}

function playerTable(players) {
  return `<div class="table-wrap"><table class="live-player-table"><thead><tr><th>Poste</th><th>Joueur</th><th>État NFL</th><th class="num">Points acquis</th><th class="num">Est. fin</th></tr></thead><tbody>${players.map(player => `<tr><td>${escape(player.slot || player.position || "—")}</td><td>${escape(player.name)}<small>${escape(player.nflTeam || "")}</small></td><td>${escape(states[player.state] || states.UNKNOWN)}${player.state === "LIVE" && player.clock ? ` · Q${escape(player.period)} ${escape(player.clock)}` : ""}</td><td class="num">${points(player.actual)}</td><td class="num">${points(player.estimate)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function renderLiveTrackerCards(report) {
  if (!report?.matchups?.length) return '<p class="state">Les affiches live ne sont pas disponibles.</p>';
  return report.matchups.map((matchup, i) => {
    const [a, b] = matchup.teams;
    // Started → withdrawn; every starter verified PREGAME/BYE → frozen estimate; anything else unverified.
    const started = [a, b].some(team => team.started) ? true
      : [a, b].every(team => team.starters.every(player => ["PREGAME", "BYE"].includes(player.state))) ? false : null;
    const complete = [a, b].every(team => !team.projectionGaps.length);
    const estimate = pregameEstimatePresentation({ chances: started === false && complete ? estimatePregameWinProbability(a.estimate, b.estimate) : null, started, readAt: report.asOf });
    const team = (row, side) => `<div class="matchup-team matchup-team-${side}"><span class="matchup-manager">${escape(managerText(row))}</span><strong>${escape(teamText(row))}</strong><b>${points(row.points)}</b><small>${row.estimate !== null ? `Est. fin : ${points(row.estimate)} pts · Adineu` : "Estimation indisponible"}</small>${row.customScore ? '<small>Score corrigé publié par Sleeper</small>' : ""}</div>`;
    return `<article class="live-matchup-card"><header><span>Match ${String(i + 1).padStart(2, "0")}</span><strong>${a.finished && b.finished ? "Titulaires terminés" : a.started || b.started ? "En cours" : "À venir"}</strong></header><div class="live-matchup-score">${team(a, "a")}<i>VS</i>${team(b, "b")}</div>
      <p class="live-card-note">${estimate.show ? `<strong>${escape(estimate.label)}</strong> · ${escape(estimate.basis)}` : escape(estimate.note ?? "Estimation avant match indisponible : projections incomplètes.")}</p>
      <details class="live-lineup-detail" data-matchup-id="${escape(matchup.matchupId)}"><summary>Détail des titulaires et du banc</summary><div class="live-lineup-grid">${[a, b].map(row => `<section><h4>${escape(teamText(row))} · Titulaires</h4>${playerTable(row.starters)}<h4>Banc / réserve</h4>${playerTable(row.bench)}</section>`).join("")}</div><p class="note">Seuls les titulaires comptent dans le total Sleeper. Les points du banc sont affichés séparément.</p></details>${matchup.historyLabel ? `<footer><span>${escape(matchup.historyLabel)}</span></footer>` : ""}</article>`;
  }).join("");
}

export function renderNflLiveGames(nfl) {
  if (!nfl?.games?.length) return "";
  return `<details class="live-nfl-games"><summary>Matchs NFL · scores et horloges</summary><p class="note">Source ESPN, lue au ${escape(nfl.fetchedAt ? new Date(nfl.fetchedAt).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" }) : "moment indiqué")}, heure de Paris.</p><div class="live-nfl-grid">${nfl.games.map(game => `<div><strong>${escape(game.away)} ${points(game.awayScore)} — ${points(game.homeScore)} ${escape(game.home)}</strong><small>${escape(game.label)}</small></div>`).join("")}</div></details>`;
}
