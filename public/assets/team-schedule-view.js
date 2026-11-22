import { buildTeamSchedules, buildVirtualDuel, scheduleMessage, formatScheduleAdjustment } from './team-schedule.js?v=0a1b470fcf';
import { rosterOptionLabel } from './manager-identity.js?v=7f451cdf4d';
import { copyTextFrom } from './ai-context-client.js?v=d42756c77d';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = value => Number.isFinite(value) ? value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

export function renderVirtualDuel(a, b) {
  const duel = buildVirtualDuel(a, b);
  if (!duel) return '';
  if (!duel.weeks.length) return '<section class="virtual-duel"><h3>⚔️ Duel virtuel</h3><p>Aucune semaine commune validée pour le moment.</p></section>';
  const total = duel.weeks.length;
  const winsA = duel.recordA.wins;
  const winsB = duel.recordB.wins;
  const ties = duel.recordA.ties;
  const endA = winsA / total * 100;
  const endB = (winsA + winsB) / total * 100;
  const leader = duel.leaderId === null ? 'Duel à égalité !' : `${duel.leaderId === a.id ? a.name : b.name} mène le duel !`;
  const legend = [[a.name, winsA, 'duel-a'], [b.name, winsB, 'duel-b'], ['Égalités', ties, 'duel-ties']];
  return `<section class="virtual-duel" aria-label="Duel virtuel des deux équipes"><p class="eyebrow">Et si vous vous affrontiez chaque semaine ?</p><h3>⚔️ Duel virtuel</h3><p class="duel-leader">${esc(leader)}</p><p>Mêmes scores réels, face-à-face rejoué sur ${total} semaines terminées. Bilan hypothétique, distinct du classement officiel.</p><div class="duel-chart-layout"><div class="duel-pie" role="img" aria-label="${esc(`${a.name} : ${winsA} semaines gagnées ; ${b.name} : ${winsB} ; égalités : ${ties}.`)}" style="background:conic-gradient(#b7ff3c 0% ${endA}%, #74b9ff ${endA}% ${endB}%, #ffc56b ${endB}% 100%)"></div><ul class="duel-legend">${legend.map(([name, count, color]) => `<li><span class="duel-swatch ${color}" aria-hidden="true"></span><span>${esc(name)}<strong>${count} ${name === 'Égalités' ? 'égalité(s)' : 'semaine(s) gagnée(s)'} · ${Math.round(count / total * 100)} %</strong></span></li>`).join('')}</ul></div><div class="duel-records"><p><strong>${esc(a.name)}</strong><br>${winsA}V – ${winsB}D – ${ties}N</p><p><strong>${esc(b.name)}</strong><br>${winsB}V – ${winsA}D – ${ties}N</p></div><div class="table-wrap" tabindex="0" role="region" aria-label="Résultats du duel virtuel par semaine"><table><thead><tr><th scope="col">Semaine</th><th scope="col">${esc(a.name)}</th><th scope="col">${esc(b.name)}</th><th scope="col">Vainqueur virtuel</th></tr></thead><tbody>${duel.weeks.map(row => `<tr><th scope="row">S${row.week}</th><td>${fmt(row.pointsA)}</td><td>${fmt(row.pointsB)}</td><td>${row.resultA === 'N' ? '🤝 Égalité' : `🏆 ${esc(row.resultA === 'V' ? a.name : b.name)}`}</td></tr>`).join('')}</tbody></table></div></section>`;
}

export function renderScheduleComparison(teams, allTeams) {
  const weeks = [...new Set(teams.flatMap(team => team.games.map(game => game.week)))].sort((a, b) => a - b);
  const cell = game => {
    if (!game || game.status === 'unavailable') return '<td>Affiche indisponible</td>';
    const opponent = allTeams.find(team => team.id === game.opponentId);
    const result = { V: '✅ Victoire', D: '❌ Défaite', N: '🤝 Égalité' }[game.result];
    return `<td><strong>${esc(opponent?.name || 'Adversaire à confirmer')}</strong><span class="team-comparison-score">${game.status === 'completed' ? `${fmt(game.points)} — ${fmt(game.opponentPoints)}` : game.status === 'upcoming' ? `Moyenne adverse : ${fmt(game.opponentAverage)} pts` : 'Score non confirmé'}</span><span class="team-result result-${game.result || 'pending'}">${result || (game.status === 'upcoming' ? 'À venir' : 'Non confirmé')}</span></td>`;
  };
  return `<h3>Les parcours, semaine par semaine</h3><p class="note">Scores : équipe sélectionnée — adversaire. Sur mobile, faites défiler le tableau horizontalement.</p><div class="table-wrap team-comparison-wrap" tabindex="0" role="region" aria-label="Calendriers des deux équipes côte à côte"><table class="team-comparison-table"><caption>Une ligne par semaine · les scores à venir restent masqués</caption><thead><tr><th scope="col">Semaine</th>${teams.map(team => `<th scope="col">${esc(team.name)}</th>`).join('')}</tr></thead><tbody>${weeks.map(week => `<tr><th scope="row">S${week}</th>${teams.map(team => cell(team.games.find(game => game.week === week))).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export async function renderTeamScheduleView(host, { leagueId, rosters, users, regularWeekCount, completedThroughWeek, sleeperGet }) {
  host.innerHTML = '<div class="state" role="status">Chargement des calendriers Sleeper…</div>';
  try {
    const teams = rosters.map(roster => {
      const user = users.find(user => user.user_id === roster.owner_id);
      return { id: String(roster.roster_id), name: user ? rosterOptionLabel({ account: user.display_name, teamName: user.metadata?.team_name }) : `Roster ${roster.roster_id}` };
    });
    const weeks = {};
    // Small batches avoid a burst of requests against the public API.
    for (let start = 1; start <= regularWeekCount; start += 3) {
      await Promise.all(Array.from({ length: Math.min(3, regularWeekCount - start + 1) }, async (_, i) => {
        const week = start + i;
        weeks[week] = await sleeperGet(`/league/${leagueId}/matchups/${week}`, { optional: true });
      }));
    }
    const report = buildTeamSchedules({ teams, weeks, regularWeekCount, completedThroughWeek });
    const options = teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    host.innerHTML = `<div class="section-head"><div><p class="eyebrow">Les rivalités, chiffres en main</p><h2>Qui a vraiment galéré ?</h2><p>Saison régulière · ${report.validWeeks.length} semaines validées · source Sleeper</p></div></div>
      <div class="schedule-toolbar"><label>Équipe <select data-team-a>${options}</select></label><label>Comparer à <select data-team-b><option value="">Aucune · vue individuelle</option>${options}</select></label><button type="button" data-copy>Copier pour WhatsApp</button></div>
      <p data-copy-status role="status"></p>
      ${report.missingWeeks.length ? `<p class="note">Scores incomplets ou non confirmés : S${report.missingWeeks.join(', S')}. Ces semaines sont exclues pour toute la ligue.</p>` : ''}
      <div data-comparison aria-live="polite"></div>
      <details><summary>Comment lire ces chiffres ?</summary><p>SOS subi brut = moyenne des points réellement marqués contre vous. ROS brut = moyenne des points par match des futurs adversaires sur les mêmes semaines validées, pondérée par chaque rencontre restante (semaine en cours incluse). Attaque = vos points par match, rang 1 = le plus prolifique.</p><p>Référence hors soi = moyenne des ${Math.max(0, teams.length - 1)} autres équipes, avec un poids égal par équipe. SOS ajusté = SOS brut − référence hors soi. ROS ajusté = ROS brut − référence hors soi. Un écart positif signifie plus dur que votre groupe d’adversaires possibles ; négatif signifie plus doux. Rang ajusté 1 = écart le plus élevé ; égalités conservées. Cela corrige le fait qu’une équipe ne s’affronte jamais elle-même. Cette référence décrit un tirage uniforme parmi les autres équipes, pas les contraintes réelles du calendrier Sleeper.</p><p>Les moyennes ne tiennent pas compte des blessures, byes NFL ou changements de roster. Aucune estimation si une affiche ou une moyenne manque. Les playoffs et les scores en cours sont exclus des bilans. Le SOS décrit les adversaires rencontrés, pas la qualité de vos décisions. Le duel virtuel reste une comparaison directe des scores réels, sans ajustement.</p></details>
      <h3>La ligue · du SOS ajusté le plus dur au plus doux</h3><p class="note">Ajusté = moyenne brute − moyenne des autres équipes, sans soi. + = plus dur ; − = plus doux que cette référence.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Comparaison SOS de la ligue"><table><thead><tr><th>Rang ajusté</th><th>Équipe</th><th>V–D–N</th><th>Attaque / match</th><th>Référence hors soi</th><th>SOS brut</th><th>SOS ajusté</th><th>ROS brut</th><th>ROS ajusté</th></tr></thead><tbody>${[...report.teams].sort((a,b) => (b.sosAdjusted ?? -Infinity) - (a.sosAdjusted ?? -Infinity)).map(t => `<tr><td>${t.sosAdjustedRank ?? '—'}</td><td>${esc(t.name)}</td><td>${t.wins}–${t.losses}–${t.ties}</td><td>${fmt(t.ppg)}</td><td>${fmt(t.opponentBaseline)}</td><td>${fmt(t.sos)}</td><td>${formatScheduleAdjustment(t.sosAdjusted)}</td><td>${fmt(t.ros)}</td><td>${formatScheduleAdjustment(t.rosAdjusted)}</td></tr>`).join('')}</tbody></table></div>`;
    const a = host.querySelector('[data-team-a]');
    const b = host.querySelector('[data-team-b]');
    const selected = () => [a.value, b.value].filter((id, index, ids) => id && ids.indexOf(id) === index).map(id => report.teams.find(t => t.id === id));
    function draw() {
      const picked = selected();
      host.querySelector('[data-comparison]').innerHTML = `<p class="note">${esc(scheduleMessage(picked, report.validWeeks).split('\n').find(line => line.includes('SOS ajusté le plus élevé') || line.includes('Même difficulté ajustée'))?.replace(/\*/g, '') || 'Sélectionnez une seconde équipe pour comparer les parcours.')}</p><div class="team-schedule-columns">${picked.map(t => `<article><h3>${esc(t.name)}</h3><div class="recap-grid"><div class="recap-stat"><span>Bilan V–D–N</span><strong>${t.wins}–${t.losses}–${t.ties}</strong><small>${t.played} matchs validés · référence hors soi : ${fmt(t.opponentBaseline)} pts/match</small></div><div class="recap-stat"><span>SOS ajusté · rang ${t.sosAdjustedRank ?? '—'}</span><strong>${formatScheduleAdjustment(t.sosAdjusted)}</strong><small>Brut : ${fmt(t.sos)} encaissés / match</small></div><div class="recap-stat"><span>Attaque · rang ${t.ppgRank ?? '—'}</span><strong>${fmt(t.ppg)}</strong><small>Points marqués / match</small></div><div class="recap-stat"><span>ROS ajusté · rang ${t.rosAdjustedRank ?? '—'}</span><strong>${formatScheduleAdjustment(t.rosAdjusted)}</strong><small>Brut : ${fmt(t.ros)} pts/match · ${t.coveredFuture}/${t.remaining} affiches couvertes · 1 = plus dur</small></div></div>${picked.length === 2 ? '' : `<ol class="team-schedule-list">${t.games.map(g => {
        const opponent = teams.find(other => other.id === g.opponentId);
        const status = { V: 'Victoire', D: 'Défaite', N: 'Égalité' }[g.result] || (g.status === 'upcoming' ? 'À venir' : g.status === 'unverified' ? 'Non confirmé' : 'Affiche indisponible');
        return `<li><span class="team-week">S${g.week}</span><div><strong>${esc(opponent?.name || 'Adversaire à confirmer')}</strong><small>${g.status === 'completed' ? `${fmt(g.points)} — ${fmt(g.opponentPoints)}` : g.status === 'upcoming' && opponent ? `Moyenne adverse : ${fmt(g.opponentAverage)} pts` : '—'}</small></div><span class="team-result result-${g.result || 'pending'}">${status}</span></li>`;
      }).join('')}</ol>`}</article>`).join('')}</div>${picked.length === 2 ? renderVirtualDuel(...picked) + renderScheduleComparison(picked, teams) : ''}`;
      host.querySelector('[data-copy-status]').textContent = '';
    }
    a.addEventListener('change', draw);
    b.addEventListener('change', draw);
    host.querySelector('[data-copy]').addEventListener('click', async () => {
      const text = scheduleMessage(selected(), report.validWeeks);
      try {
        await copyTextFrom(Promise.resolve(text));
        host.querySelector('[data-copy-status]').textContent = 'Synthèse copiée. Collez-la dans WhatsApp.';
      } catch {
        const status = host.querySelector('[data-copy-status]');
        status.innerHTML = '<label>Copie automatique indisponible · sélectionnez ce texte<textarea readonly rows="10" style="width:100%"></textarea></label>';
        status.querySelector('textarea').value = text;
        status.querySelector('textarea').select();
      }
    });
    draw();
  } catch {
    host.innerHTML = '<p role="status">Calendriers indisponibles.</p><button type="button">Réessayer</button>';
    host.querySelector('button').addEventListener('click', () => renderTeamScheduleView(host, { leagueId, rosters, users, regularWeekCount, completedThroughWeek, sleeperGet }));
  }
}
