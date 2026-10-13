import { getLeagueCore, sleeperGet, SLEEPER_LEAGUE_ID } from './sleeper-client.js?v=3f75d48ec5';
import { buildWeeklyAwards, resolveCompletedAwardsWeek, publicTeamIdentity } from './weekly-awards.js?v=af66f49349';
import { renderWeeklyAwards } from './weekly-awards-view.js?v=ec6cd710f4';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const number = value => Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : 'n/d';

export async function loadPublicWeek({ getCore = getLeagueCore, get = sleeperGet, leagueId = SLEEPER_LEAGUE_ID } = {}) {
  const { league, rosters, users, state } = await getCore({ leagueId });
  const week = resolveCompletedAwardsWeek({ league, state });
  const nextWeek = week + 1;
  const lastRegular = Number(league.settings?.playoff_week_start || 15) - 1;
  const [rows, nextRows] = await Promise.all([
    week ? get(`/league/${leagueId}/matchups/${week}`, { fresh: true }) : [],
    week && nextWeek <= lastRegular ? get(`/league/${leagueId}/matchups/${nextWeek}`, { optional: true }) : null
  ]);
  const recap = buildWeeklyAwards({ rows, rosters, users, week, completedThroughWeek: week, expectedTeamCount: Number(league.total_rosters) });
  const nextPairs = new Map();
  for (const row of nextRows || []) {
    if (row.matchup_id == null) continue;
    const roster = rosters.find(entry => Number(entry.roster_id) === Number(row.roster_id));
    if (!roster) continue;
    const pair = nextPairs.get(row.matchup_id) || [];
    pair.push(publicTeamIdentity(roster, users));
    nextPairs.set(row.matchup_id, pair);
  }
  const standings = rosters.map(roster => {
    const settings = roster.settings || {};
    const pf = Number.isFinite(settings.fpts) && Number.isFinite(settings.fpts_decimal)
      ? settings.fpts + settings.fpts_decimal / 100 : null;
    return { ...publicTeamIdentity(roster, users), wins: settings.wins ?? null, losses: settings.losses ?? null,
      ties: settings.ties ?? null, pointsFor: pf };
  }).sort((a, b) => (b.wins ?? -1) - (a.wins ?? -1) || (b.pointsFor ?? -1) - (a.pointsFor ?? -1) || a.teamName.localeCompare(b.teamName, 'fr'));
  return { recap, standings, nextWeek, nextMatchups: [...nextPairs.values()].filter(pair => pair.length === 2),
    league: { teams: league.total_rosters, playoffTeams: league.settings?.playoff_teams ?? null,
      ppr: league.scoring_settings?.rec === 1 }, loadedAt: new Date().toISOString() };
}

export async function renderPublicWeek(target) {
  try {
    const data = await loadPublicWeek();
    const standings = `<details class="weekly-details"><summary>Voir le bilan de saison des ${data.standings.length} équipes</summary><p class="note">Victoires–défaites–égalités et points marqués publiés par Sleeper. Ordre : victoires, puis points marqués ; ce n’est pas l’all-play.</p><div class="weekly-table-scroll"><table class="data-table"><thead><tr><th>Équipe</th><th>V–D–N</th><th>Points marqués</th></tr></thead><tbody>${data.standings.map(row => `<tr><td>${escapeHtml(row.teamName)}</td><td>${number(row.wins)}–${number(row.losses)}–${number(row.ties)}</td><td>${number(row.pointsFor)}</td></tr>`).join('')}</tbody></table></div></details>`;
    const upcoming = data.nextMatchups.length ? `<details class="weekly-details"><summary>Affiches · S${data.nextWeek}</summary><ul>${data.nextMatchups.map(pair => `<li>${escapeHtml(pair[0].teamName)} — ${escapeHtml(pair[1].teamName)}</li>`).join('')}</ul><p class="note">Calendrier publié par Sleeper ; consultez Matchups pour les scores en cours.</p></details>` : '';
    target.innerHTML = `<p class="lede">${number(data.league.teams)} équipes entre amis${data.league.ppr ? ' · PPR : chaque réception NFL rapporte un point' : ''}${data.league.playoffTeams ? ` · ${number(data.league.playoffTeams)} places en playoffs` : ''}. Chaque manager choisit ses joueurs NFL : leurs performances composent le score de son équipe.</p>
      ${renderWeeklyAwards(data.recap, { compact: true })}${standings}${upcoming}
      <p class="note">Données relues le ${escapeHtml(new Date(data.loadedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }))}.</p>
      <a class="source-link" href="/matchups/#recap">Tous les awards et les semaines précédentes →</a>`;
  } catch {
    target.innerHTML = '<p class="state">Le récap Sleeper est momentanément indisponible. Les archives restent accessibles.</p>';
  }
}
