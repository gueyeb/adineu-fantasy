import { SOS_TEAM_CODES } from './wr-ros-sos.js?v=74b4a6a313';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '—';
const date = value => value ? new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—';
const labels = { FAVORABLE: 'Favorable', NEUTRAL: 'Neutre', DIFFICULT: 'Difficile', COMPLETE: 'Complète', PARTIAL: 'Partielle', UNAVAILABLE: 'Indisponible' };
const horizons = { FANTASY_ROS: 'Fantasy ROS · jusqu’à S14', NEXT_3: 'Next 3 · trois prochains matchs', PAST: 'Past SOS · semaines terminées', FANTASY_PLAYOFFS: 'Playoffs fantasy · S15–17', NFL_ROS: 'NFL ROS · jusqu’à S18' };
export function filterSosTeams(teams, { team = '', difficulty = '', coverage = '' } = {}) {
  return teams.filter(row => (!team || row.team === team) && (!difficulty || row.difficulty === difficulty) && (!coverage || row.coverageStatus === coverage));
}
const options = obj => Object.entries(obj).map(([value, label]) => `<option value="${escape(value)}">${escape(label)}</option>`).join('');

export async function renderSosExplorer(app) {
  app.innerHTML = `<header class="sos-hero"><div class="shell"><p class="eyebrow">FANTASY SOS EXPLORER / WR / FULL PPR</p><h1>Le calendrier<br><em>change la perspective.</em></h1><p>Ce qui a été affronté. Ce qui reste à jouer. Ce que nos prévisions avaient annoncé.</p><div class="sos-ruler" aria-hidden="true">PASSÉ <span>━━━━━━━━</span> MAINTENANT <span>━━━━━━━━</span> S14 / S17 / S18</div></div></header>
    <section class="section"><div class="shell sos-workspace"><div class="sos-controls">
    <label>Horizon<select id="sos-horizon">${options(horizons)}</select></label>
    <label>Perspective<select id="sos-perspective"><option value="CURRENT">Aujourd’hui · rétrospectif pour PAST</option><option value="FROZEN">Past figé · prévisions pré-match</option><option value="ARCHIVE">Snapshot historique</option><option value="EVALUATION">Évaluation prévision / réalité</option></select></label>
    <label>Snapshot<select id="sos-snapshot" disabled><option value="">Aucune archive disponible</option></select></label>
    <button type="button" id="sos-refresh">Actualiser</button></div>
    <p id="sos-status" role="status" aria-live="polite">Chargement des sources…</p>
    <div class="sos-filters"><label>Équipe<select id="sos-team"><option value="">Toutes les équipes</option>${options(Object.fromEntries(Object.keys(SOS_TEAM_CODES).sort().map(t => [t, t])))}</select></label>
    <label>Difficulté<select id="sos-difficulty"><option value="">Toutes</option>${options({ FAVORABLE: 'Favorable', NEUTRAL: 'Neutre', DIFFICULT: 'Difficile' })}</select></label>
    <label>Couverture<select id="sos-coverage"><option value="">Toutes</option>${options({ COMPLETE: 'Complète', PARTIAL: 'Partielle', UNAVAILABLE: 'Indisponible' })}</select></label>
    <label>Semaines affichées<select id="sos-weeks"><option value="">Tout l’horizon</option>${options(Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, `Semaine ${i + 1}`])))}</select></label></div>
    <p class="sos-note">Les filtres réduisent l’affichage, jamais le score ni le rang de l’horizon.</p>
    <p class="sos-scroll-hint">Faites défiler le tableau pour voir le score et la couverture.</p><div id="sos-results"></div><details class="sos-method"><summary>Méthode, sources et limites</summary><div id="sos-sources"></div><p>WR PPR concédés par match, ajustés : production de tous les WR adverses, pas une projection individuelle. Moyenne des adversaires de la fenêtre, régression vers la moyenne NFL (k = 3). Rang 1 = plus favorable. Byes hors dénominateur ; matchs commencés exclus des fenêtres futures. PAST courant utilise les données actuelles ; seul le passé figé conserve les prévisions authentiques.</p><p>Un calendrier favorable ne constitue pas une recommandation ADD ou START. Rôle, routes, targets, disponibilité et coût de coupe restent prioritaires. Aucune projection Sleeper n’est modifiée.</p></details></div></section>`;
  const el = id => app.querySelector(`#sos-${id}`);
  let response = null; let evaluation = null; let trends = []; let requestNumber = 0;
  const state = () => ({ team: el('team').value, difficulty: el('difficulty').value, coverage: el('coverage').value });
  function draw() {
    if (evaluation) {
      const rows = evaluation.rows.filter(row => (!el('team').value || row.offensiveTeam === el('team').value) && (!el('weeks').value || row.targetWeek === Number(el('weeks').value)));
      el('results').innerHTML = `<div class="sos-metrics"><div><b>${evaluation.sample}</b> observations / ${evaluation.total}</div><div><b>${number(evaluation.mae)}</b> MAE collective WR</div><div><b>${number(evaluation.spearman)}</b> corrélation de rang</div><div><b>${number(evaluation.classificationAccuracy === null ? null : evaluation.classificationAccuracy * 100)} %</b> classes correctes</div></div><p>${evaluation.reliability === 'INSUFFICIENT_SAMPLE' ? 'Échantillon insuffisant pour conclure sur la fiabilité.' : 'Mesures descriptives, sans garantie prédictive.'} Un snapshot à la fois ; ne pas additionner ces observations entre archives. Les erreurs de score ROS complet nécessitent tous les matchs de l’horizon.</p><p>Exclusions : ${escape(JSON.stringify(evaluation.exclusions))}</p><div class="sos-table-wrap" tabindex="0" role="region" aria-label="Tableau SOS défilant"><table><caption>Prévisions archivées et points WR observés</caption><thead><tr><th>Semaine</th><th>Attaque / défense</th><th>Prévu</th><th>Observé</th><th>Erreur absolue</th></tr></thead><tbody>${rows.map(row => `<tr><td>S${row.targetWeek}</td><td>${escape(row.offensiveTeam)} / ${escape(row.defense)}</td><td>${number(row.predictedAllowedPpr)}</td><td>${number(row.actualAllowedPpr)}</td><td>${row.reason ? escape(row.reason) : number(row.absoluteError)}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    if (!response) return;
    const filtered = filterSosTeams(response.teams, state());
    el('results').innerHTML = `<div class="sos-table-wrap" tabindex="0" role="region" aria-label="Tableau SOS défilant"><table class="sos-table"><caption>${response.rankedTeams === 32 ? 'Classement complet — 32/32 équipes classées' : `Classement partiel — ${response.rankedTeams}/32 équipes classées`} · ${filtered.length} affichées</caption><thead><tr><th scope="col">Rang</th><th scope="col">Équipe / calendrier</th><th scope="col">WR PPR concédés<br>par match, ajustés</th><th scope="col">Couverture</th></tr></thead><tbody>${filtered.map(team => {
      const games = team.opponents.filter(game => !el('weeks').value || game.week === Number(el('weeks').value));
      const history = trends.filter(snapshot => Date.parse(snapshot.asOf) <= Date.parse(response.asOf)).map(snapshot => {
        const old = snapshot.teams.find(row => row.team === team.team);
        return old ? `S${snapshot.week} : rang ${old.rank ?? '—'} (${number(old.sosScore)})` : '';
      }).filter(Boolean).join(' · ');
      const byes = team.byeWeeks.filter(week => !el('weeks').value || week === Number(el('weeks').value));
      return `<tr><td class="sos-rank">${team.rank ?? '—'}</td><td><details><summary><strong>${escape(team.team)}</strong><span class="sos-chip ${escape(team.difficulty || '')}">${escape(labels[team.difficulty] || 'Non classé')}</span></summary><p class="sos-rank-history">Historique du rang, même horizon : ${escape(history || "aucun snapshot disponible")}. Les matchs de la fenêtre évoluent chaque semaine.</p><div class="sos-opponents">${games.map(game => `<article><b>S${game.week} · ${escape(game.opponent)}</b><span>${escape(date(game.kickoff))}</span><strong>${number(game.adjustedDifficulty)}</strong><small>Brut ${number(game.opponentWrPprAllowed)} · ${game.opponentWrGames} matchs · ${game.status === 'COVERED' ? 'DvP couvert' : 'DvP manquant'}</small>${game.predictionSnapshotId ? `<small>Prévision ${escape(game.predictionSnapshotId.slice(0, 12))}</small>` : ''}</article>`).join('')}${byes.map(week => `<article><b>S${week} · BYE</b><span>Hors moyenne</span></article>`).join('')}${!games.length && !byes.length ? '<p>Aucun match dans le détail sélectionné.</p>' : ''}</div></details>${team.reason ? `<small class="sos-reason">${escape(team.reason)}</small>` : ''}</td><td class="sos-score">${number(team.sosScore)}${team.coverageStatus === 'PARTIAL' ? '<small>Indicatif</small>' : ''}</td><td><b>${team.coveredGames}/${team.gamesInWindow} matchs</b><small>${number(team.coveragePct)} % · ${escape(labels[team.coverageStatus])}${!team.scheduleComplete ? ' · calendrier incomplet' : ''}</small></td></tr>`;
    }).join('') || '<tr><td colspan="4">Aucune équipe ne correspond aux filtres.</td></tr>'}</tbody></table></div>`;
  }
  async function load() {
    const request = ++requestNumber;
    const perspective = el('perspective').value;
    el('snapshot').disabled = !['ARCHIVE', 'EVALUATION'].includes(perspective);
    el('horizon').disabled = perspective === 'FROZEN' || perspective === 'EVALUATION';
    el('difficulty').disabled = perspective === 'EVALUATION'; el('coverage').disabled = perspective === 'EVALUATION';
    if (perspective === 'FROZEN') el('horizon').value = 'PAST';
    if (perspective === 'EVALUATION') el('horizon').value = 'NFL_ROS';
    response = null; evaluation = null; trends = [];
    el('results').innerHTML = '';
    el('results').setAttribute('aria-busy', 'true');
    el('status').textContent = 'Chargement du snapshot…';
    try {
      if (['ARCHIVE', 'EVALUATION'].includes(perspective) && !el('snapshot').value) throw Error('Aucun snapshot archivé : le suivi commence à son activation, sans prévisions inventées.');
      const query = new URLSearchParams({ position: 'WR', horizon: el('horizon').value });
      if (perspective === 'FROZEN') query.set('perspective', 'FROZEN');
      if (['ARCHIVE', 'EVALUATION'].includes(perspective)) query.set('snapshotId', el('snapshot').value);
      const res = await fetch(`/api/sos${perspective === 'EVALUATION' ? '/evaluation' : ''}?${query}`);
      if (!res.ok) throw Error('Sources indisponibles. Réessayez avec Actualiser.');
      const payload = await res.json();
      if (request !== requestNumber) return;
      evaluation = perspective === 'EVALUATION' ? payload : null; response = evaluation ? null : payload;
      el('status').textContent = `${perspective === 'EVALUATION' ? 'Évaluation au' : 'Snapshot au'} ${date(payload.asOf || payload.evaluatedAt)} · ${payload.snapshotId.slice(0, 12)}${payload.window ? ` · S${payload.window.startWeek}–${payload.window.endWeek}` : ''} · ${perspective === 'CURRENT' ? 'données actuelles' : perspective === 'FROZEN' ? 'prévisions pré-match figées' : 'archive immuable'}`;
      el('sources').innerHTML = response ? `<p>Méthode ${escape(response.methodologyVersion)} · k ${response.shrinkGames} · moyenne NFL ${number(response.leagueAverage)}</p>${Object.entries(response.sources).map(([key, source]) => `<p><b>${escape(key)}</b> · ${escape(source.source)}<br>Collecte ${escape(date(source.fetchedAt))} · hash ${escape(source.inputHash)}${source.completedWeeks ? `<br>Semaines DvP : ${escape(source.completedWeeks.join(', '))}` : ''}</p>`).join('')}<p>${escape(response.warnings.join(' · '))}</p>` : '<p>Prévisions strictement pré-match ; résultats confirmés et complets uniquement. Les valeurs manquantes restent exclues.</p>';
      try {
        const historyResponse = ['FROZEN', 'EVALUATION'].includes(perspective) ? null : await fetch(`/api/sos/trends?horizon=${encodeURIComponent(el('horizon').value)}`);
        const history = historyResponse ? await historyResponse.json() : { snapshots: [] };
        if (request !== requestNumber) return;
        trends = history.snapshots ?? [];
      } catch { trends = []; }
      draw();
    } catch (error) { if (request === requestNumber) { response = null; evaluation = null; el('results').innerHTML = ''; el('sources').textContent = ''; el('status').textContent = error.message; } }
    finally { if (request === requestNumber) el('results').setAttribute('aria-busy', 'false'); }
  }
  for (const id of ['team', 'difficulty', 'coverage', 'weeks']) el(id).addEventListener('change', draw);
  for (const id of ['horizon', 'perspective', 'snapshot']) el(id).addEventListener('change', load);
  el('refresh').addEventListener('click', load);
  try {
    const res = await fetch('/api/sos/snapshots'); const data = await res.json();
    if (data.snapshots?.length) el('snapshot').innerHTML = data.snapshots.map(s => `<option value="${escape(s.snapshotId)}">S${s.week} · ${escape(date(s.asOf))}</option>`).join('');
  } catch { /* Current exploration remains available without archive storage. */ }
  await load();
}
