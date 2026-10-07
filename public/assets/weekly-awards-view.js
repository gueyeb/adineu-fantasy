const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const score = value => Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderWeeklyAwards(recap, { compact = false } = {}) {
  if (!recap.ready) return `<div class="matchup-empty"><strong>${recap.reason === 'WEEK_NOT_COMPLETED' ? 'Semaine pas encore terminée' : 'Récap en attente de données complètes'}</strong><p>Les awards et l’all-play sont publiés une fois tous les scores de la semaine terminée disponibles.</p></div>`;
  const primaryKeys = new Set(['HIGH_SCORE', 'BLOWOUT', 'NARROW_WIN', 'HIGH_LOSS', 'LUCKY_WIN', 'UNLUCKY_LOSS']);
  const renderCard = award => `<article class="recap-stat"><span>${escapeHtml(award.label)}</span>${award.laureates.map(row => {
    if (award.metric === 'matchup') return `<strong>${escapeHtml(row.winner.teamName)}</strong><small>${score(row.margin)} pts d’écart · ${score(row.winner.actualScore)}–${score(row.loser.actualScore)} face à ${escapeHtml(row.loser.teamName)}</small>`;
    return `<strong>${escapeHtml(row.teamName)}</strong><small>${score(row.actualScore)} pts${award.metric === 'allPlay' ? ` · ${row.wins}-${row.losses}-${row.ties} en all-play` : ''}</small>`;
  }).join('')}${award.laureates.length > 1 ? '<p class="note">Ex aequo · tous les lauréats</p>' : ''}</article>`;
  const primary = compact ? recap.awards.filter(row => primaryKeys.has(row.key)) : recap.awards;
  const results = recap.matchups.map(row => `<li><strong>${escapeHtml(row.teams[0].teamName)}</strong><span>${score(row.teams[0].actualScore)} — ${score(row.teams[1].actualScore)}</span><strong>${escapeHtml(row.teams[1].teamName)}</strong>${row.tie ? '<small>Égalité</small>' : ''}</li>`).join('');
  const allPlay = `<div class="weekly-table-scroll"><table class="data-table"><caption>All-play · semaine ${recap.week} uniquement</caption><thead><tr><th>Rang</th><th>Équipe</th><th>Points</th><th>V–D–N</th><th>Taux</th></tr></thead><tbody>${recap.allPlay.map(row => `<tr><td>${row.rank}</td><td>${escapeHtml(row.teamName)}</td><td>${score(row.actualScore)}</td><td>${row.wins}–${row.losses}–${row.ties}</td><td>${(100 * row.winRate).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</td></tr>`).join('')}</tbody></table></div>`;
  return `<p class="note">Semaine ${recap.week} terminée · scores officiels Sleeper. Les corrections de scores sont relues à chaque chargement.</p>
    <div class="recap-grid">${primary.map(renderCard).join('')}</div>
    <div class="recap-bench"><h3>Les résultats</h3><ul class="weekly-results">${results}</ul></div>
    <p class="note"><strong>All-play :</strong> quel aurait été le bilan de chaque équipe face à toutes les autres cette semaine ? Une égalité vaut une demi-victoire dans le taux. Ce tableau décrit la semaine ; il ne remplace pas le classement de saison.</p>
    ${compact ? `<details class="weekly-details"><summary>Comparer les ${recap.teams.length} équipes en all-play</summary>${allPlay}</details>` : allPlay}
    <p class="note">Les awards décrivent les résultats après match. Ils ne mesurent pas la qualité d’une décision avant le coup d’envoi.</p>`;
}
