import { calculatePowerRankings, MINIMUM_COMPLETED_WEEKS, POWER_WEIGHTS } from "./power-rankings.js?v=1";
import {
  ACTIVE_MANAGERS_2026,
  RIVALRY_CRITERIA,
  RIVALRY_WEEK,
  buildRivalryRecords,
  buildSleeperWeek
} from "./rivalry-week.js?v=2";

const SUPABASE_URL = "https://juosrzsffvjprqhdyado.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7Bu9q2dKz0WEol94OGVhHw_xjSwHeHu";
const CURRENT_SEASON = 2026;
const SLEEPER_API = "https://api.sleeper.app/v1";
const SLEEPER_LEAGUE_ID = "1392715510830878721";

const routes = [
  ["home", "/", "Accueil"],
  ["standings", "/standings/", "Classements"],
  ["power-rankings", "/power-rankings/", "Power"],
  ["rivalry-week", "/rivalry-week/", "Rivalités"],
  ["matchups", "/matchups/", "Matchups"],
  ["history", "/history/", "Historique"],
  ["hall-of-fame", "/hall-of-fame/", "Hall of Fame"],
  ["franchises", "/franchises/", "Franchises"]
];

const page = document.body.dataset.page || "home";

document.getElementById("site-header").innerHTML = `
  <header class="site-header">
    <div class="nav-wrap">
      <a class="brand" href="/">
        <span class="brand-mark">A</span>
        <span class="brand-copy">Adineu NFL<small>Fantasy League · depuis 2019</small></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="main-nav">Menu</button>
      <nav class="nav-links" id="main-nav" aria-label="Navigation principale">
        ${routes.map(([key, href, label]) => `<a href="${href}"${key === page ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
    </div>
  </header>`;

document.getElementById("site-footer").innerHTML = `
  <footer class="site-footer">
    <div class="footer-wrap">
      <span><strong>Adineu NFL</strong> · notre ligue, nos archives.</span>
      <span>Yahoo 2019–2025 · Sleeper à partir de 2026</span>
    </div>
  </footer>`;

const navToggle = document.querySelector(".nav-toggle");
navToggle.addEventListener("click", () => {
  const nav = document.getElementById("main-nav");
  const open = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatPoints(value, digits = 2) {
  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function shortManagerName(name) {
  const parts = String(name).split(" ");
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : name;
}

function yahooUrl(season) {
  return `https://football.fantasysports.yahoo.com/${season.year}/f1/${season.leagueId}`;
}

async function loadHistory() {
  const response = await fetch("/data/yahoo-history.json?v=4", { cache: "no-store" });
  if (!response.ok) throw new Error(`Archive indisponible (${response.status})`);
  const data = await response.json();
  const normalizeTeam = value => String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");

  for (const profile of data.managerHistory || []) {
    for (const [year, teamName] of Object.entries(profile.seasons)) {
      const season = data.seasons.find(item => item.year === Number(year));
      const team = season?.teams.find(item => normalizeTeam(item.team) === normalizeTeam(teamName));
      if (team) team.manager = profile.manager;
    }
  }

  return data;
}

async function loadYahooMatchups() {
  const response = await fetch("/data/yahoo-matchups.json?v=2", { cache: "no-store" });
  if (!response.ok) throw new Error(`Matchups Yahoo indisponibles (${response.status})`);
  return response.json();
}

async function loadYahooPlayoffs() {
  const response = await fetch("/data/yahoo-playoffs.json?v=2", { cache: "no-store" });
  if (!response.ok) throw new Error(`Playoffs Yahoo indisponibles (${response.status})`);
  return response.json();
}

function normalizeTeamName(value) {
  return String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

function managerForHistoryTeam(data, year, team) {
  return data.managerHistory.find(profile =>
    normalizeTeamName(profile.seasons[String(year)] || "") === normalizeTeamName(team))?.manager || "À confirmer";
}

function allYahooPlayoffSeasons(data, playoffArchive) {
  const season2025 = data.seasons.find(season => season.year === 2025);
  return [...playoffArchive.seasons, {
    year: 2025,
    leagueId: season2025.leagueId,
    sourceUrl: `${yahooUrl(season2025)}?module=standings&lhst=playoff#lhstplayoff`,
    games: data.playoffs2025.map(match => ({
      week: match.week,
      round: ({ Quarterfinal: "quarterfinal", Semifinal: "semifinal", Final: "final", "Third place": "third_place" })[match.round],
      winner: { team: match.winner, manager: managerForHistoryTeam(data, 2025, match.winner), points: match.winnerPoints },
      loser: { team: match.loser, manager: managerForHistoryTeam(data, 2025, match.loser), points: match.loserPoints }
    }))
  }].sort((a, b) => b.year - a.year);
}

function buildYahooRecordBook(data, matchupArchive, playoffArchive) {
  const regularGames = matchupArchive.seasons.flatMap(season => season.weeks.flatMap(week =>
    week.matchups.map(matchup => ({
      year: season.year,
      week: week.week,
      team1: { manager: matchup.team1Manager, team: matchup.team1Name, points: matchup.team1Score },
      team2: { manager: matchup.team2Manager, team: matchup.team2Name, points: matchup.team2Score }
    }))));
  const regularSides = regularGames.flatMap(game => [
    { ...game.team1, opponent: game.team2, year: game.year, week: game.week },
    { ...game.team2, opponent: game.team1, year: game.year, week: game.week }
  ]);
  const wins = regularSides.filter(side => side.points > side.opponent.points);
  const losses = regularSides.filter(side => side.points < side.opponent.points);
  const maximum = (items, value) => [...items].sort((a, b) => value(b) - value(a))[0];
  const minimum = (items, value) => [...items].sort((a, b) => value(a) - value(b))[0];

  const streaks = [];
  for (const manager of [...new Set(regularSides.map(side => side.manager))]) {
    for (const season of matchupArchive.seasons) {
      const games = regularSides.filter(side => side.manager === manager && side.year === season.year)
        .sort((a, b) => a.week - b.week);
      let active = null;
      for (const game of games) {
        if (game.points > game.opponent.points) {
          active ||= { manager, team: game.team, year: season.year, startWeek: game.week, endWeek: game.week, wins: 0 };
          active.wins += 1;
          active.endWeek = game.week;
        } else if (active) {
          streaks.push(active);
          active = null;
        }
      }
      if (active) streaks.push(active);
    }
  }

  const playoffGames = allYahooPlayoffSeasons(data, playoffArchive).flatMap(season =>
    season.games.map(game => ({ ...game, year: season.year })));
  const playoffSides = playoffGames.flatMap(game => [
    { ...game.winner, opponent: game.loser, year: game.year, week: game.week, round: game.round },
    { ...game.loser, opponent: game.winner, year: game.year, week: game.week, round: game.round }
  ]);
  const playoffWins = playoffSides.filter(side => side.points > side.opponent.points);

  return {
    highScore: maximum(regularSides, side => side.points),
    biggestWin: maximum(wins, side => side.points - side.opponent.points),
    closestWin: minimum(wins, side => side.points - side.opponent.points),
    highestCombined: maximum(regularGames, game => game.team1.points + game.team2.points),
    highestLoss: maximum(losses, side => side.points),
    topStreaks: [...streaks].sort((a, b) => b.wins - a.wins || b.year - a.year || a.manager.localeCompare(b.manager, "fr"))
      .filter(streak => streak.wins >= 7),
    playoffHigh: maximum(playoffSides, side => side.points),
    playoffBiggestWin: maximum(playoffWins, side => side.points - side.opponent.points),
    playoffClosestWin: minimum(playoffWins, side => side.points - side.opponent.points)
  };
}

async function loadLiveStandings() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/v_standings?year=eq.${CURRENT_SEASON}&order=live_rank.asc`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    }
  );
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  return response.json();
}

async function loadSleeperResource(path) {
  const response = await fetch(`${SLEEPER_API}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sleeper HTTP ${response.status}`);
  return response.json();
}

async function loadSleeperMatchups() {
  const select = "week,points,opponent_points,is_playoff,team:teams!matchups_team_id_fkey(team_name,season:seasons!inner(year,platform),owner:owners(display_name))";
  const query = new URLSearchParams({
    select,
    "team.season.year": `eq.${CURRENT_SEASON}`,
    "team.season.platform": "eq.sleeper"
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/matchups?${query}`, {
    cache: "no-store",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  const rows = await response.json();
  return rows.map(row => ({
    week: row.week,
    manager: row.team?.owner?.display_name,
    team: row.team?.team_name,
    points: row.points,
    opponentPoints: row.opponent_points,
    isPlayoff: row.is_playoff
  }));
}

function standingsTable(rows, isLive = false) {
  if (!rows.length) {
    return `<div class="state"><strong>Pas encore de classement</strong>Les données apparaîtront dès le début de la saison.</div>`;
  }

  const showManagers = isLive || rows.some(row => row.manager);

  return `<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Rang</th><th>Équipe</th>${showManagers ? "<th>Manager</th>" : ""}
        <th class="num">V</th><th class="num">D</th><th class="num">N</th>
        <th class="num">PF</th><th class="num">PA</th>
      </tr></thead>
      <tbody>${rows.map((row, index) => `
        <tr class="${index === 0 && !isLive ? "champion-row" : ""}">
          <td class="rank">${escapeHtml(row.live_rank ?? row.rank)}</td>
          <td class="team-name">${escapeHtml(row.team_name ?? row.team)}</td>
          ${showManagers ? `<td>${escapeHtml(isLive ? row.owner_name || "—" : row.manager || "À confirmer")}</td>` : ""}
          <td class="num">${escapeHtml(row.wins)}</td>
          <td class="num">${escapeHtml(row.losses)}</td>
          <td class="num">${escapeHtml(row.ties)}</td>
          <td class="num">${formatPoints(row.points_for ?? row.pf)}</td>
          <td class="num">${formatPoints(row.points_against ?? row.pa)}</td>
        </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function pageHero(eyebrow, title, lede, stamp) {
  return `<section class="page-hero"><div class="shell page-hero-grid">
    <div>
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p class="lede">${lede}</p>
    </div>
    <aside class="page-stamp" aria-label="Repère de page">
      <span>${stamp.label}</span>
      <strong>${stamp.value}</strong>
      <small>${stamp.note}</small>
    </aside>
  </div></section>`;
}

async function renderHome(data) {
  const seasons = data.seasons;
  const latest = seasons[0];
  const teamSeasons = seasons.reduce((total, season) => total + season.teamCount, 0);
  const high = data.weeklyHighs2025.reduce((best, item) => item.points > best.points ? item : best);
  const pointsRecord = seasons.flatMap(season => season.teams.map(team => ({ ...team, year: season.year })))
    .reduce((best, item) => item.pf > best.pf ? item : best);

  document.getElementById("app").innerHTML = `
    <section class="hero"><div class="shell hero-grid">
      <div>
        <p class="eyebrow">Adineu NFL Fantasy League</p>
        <h1>La ligue a une <em>mémoire.</em></h1>
        <p class="lede">Résultats, champions et grosses performances depuis 2019. Yahoo appartient aux archives ; Sleeper prend le relais en 2026.</p>
      </div>
      <aside class="scoreboard" aria-label="Champion en titre">
        <div class="scoreboard-label"><span>Champion en titre</span><span>${latest.year}</span></div>
        <div class="scoreboard-main"><strong>${escapeHtml(latest.champion.team)}</strong><span>${escapeHtml(latest.champion.manager)} · 122,72 en finale</span></div>
      </aside>
    </div></section>

    <section class="section"><div class="shell">
      <div class="stat-grid">
        <div class="stat"><strong>${seasons.length}</strong><span>Saisons archivées</span></div>
        <div class="stat"><strong>${teamSeasons}</strong><span>Participations d'équipe</span></div>
        <div class="stat"><strong>${formatPoints(pointsRecord.pf, 0)}</strong><span>Record PF · ${escapeHtml(pointsRecord.team)}</span></div>
        <div class="stat"><strong>${formatPoints(high.points)}</strong><span>Top score hebdo 2025</span></div>
      </div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Le clubhouse</p><h2>Tout le terrain.</h2></div><p>Le présent, les archives et les débats qui ne meurent jamais.</p></div>
      <div class="feature-grid">
        <a class="feature feature-rivalry" href="/rivalry-week/"><span class="feature-kicker">Proposition · Semaine 8 · 2026</span><h3>Six rivalités. À vous de trancher.</h3><p>Les affiches proposées, leurs bilans Yahoo et le vrai calendrier Sleeper dès sa publication.</p><span class="feature-number">08</span></a>
        <a class="feature" href="/hall-of-fame/"><span class="feature-kicker">Palmarès officiel</span><h3>Les immortels d'Adineu</h3><p>Sept champions, les règnes multiples et les records qui tiennent encore.</p><span class="feature-number">7</span></a>
        <a class="feature" href="/history/"><span class="feature-kicker">2019 → 2025</span><h3>Saison par saison</h3><p>Les participants réels, les classements complets et les podiums.</p><span class="feature-number">19</span></a>
      </div>
    </div></section>`;
}

async function renderStandings(data) {
  const options = [CURRENT_SEASON, ...data.seasons.map(season => season.year)];
  document.getElementById("app").innerHTML = `${pageHero("Classements", "La table ne <em>ment pas.</em>", "Suivez la saison Sleeper en direct ou remontez les classements finaux des années Yahoo.", { label: "Saison active", value: "2026", note: "Source · Sleeper" })}
    <section class="section"><div class="shell">
      <div class="toolbar">
        <label for="season-select">Saison <select id="season-select">${options.map(year => `<option value="${year}">${year}</option>`).join("")}</select></label>
        <a class="source-link" id="source-link" href="https://sleeper.com/" target="_blank" rel="noreferrer">Source : Sleeper ↗</a>
      </div>
      <div id="standings-content"><div class="state">Chargement du classement…</div></div>
    </div></section>`;

  const select = document.getElementById("season-select");
  const content = document.getElementById("standings-content");
  const source = document.getElementById("source-link");

  async function showSeason(year) {
    content.innerHTML = `<div class="state">Chargement du classement…</div>`;
    if (year === CURRENT_SEASON) {
      source.href = "https://sleeper.com/";
      source.textContent = "Source : Sleeper ↗";
      try {
        const rows = await loadLiveStandings();
        content.innerHTML = standingsTable(rows, true);
      } catch (error) {
        content.innerHTML = `<div class="state"><strong>Connexion live indisponible</strong>${escapeHtml(error.message)}</div>`;
      }
      return;
    }
    const season = data.seasons.find(item => item.year === year);
    source.href = yahooUrl(season);
    source.textContent = "Archive Yahoo ↗";
    content.innerHTML = standingsTable(season.teams);
  }

  select.addEventListener("change", () => showSeason(Number(select.value)));
  await showSeason(CURRENT_SEASON);
}

function renderHistory(data) {
  const coverage = data.identityCoverage || { confirmedParticipations: 0, totalParticipations: 88 };
  const seasonsHtml = data.seasons.map((season, index) => {
    const teamNames = season.teams.map(team => team.team).join(" · ");
    return `<details class="season"${index === 0 ? " open" : ""}>
      <summary>
        <span class="season-year">${season.year}</span>
        <span class="season-title"><strong>${escapeHtml(season.champion.team)} champion</strong><span>${season.teamCount} équipes · ${escapeHtml(season.runnerUp)} finaliste</span></span>
        <span class="season-toggle" aria-hidden="true"></span>
      </summary>
      <div class="season-body">
        <div class="toolbar"><span class="source-link">Participants : ${season.teamCount}</span><a class="source-link" href="${yahooUrl(season)}" target="_blank" rel="noreferrer">Ouvrir l'archive Yahoo ↗</a></div>
        ${standingsTable(season.teams)}
        <p class="note"><strong>Équipes de la saison :</strong> ${escapeHtml(teamNames)}.</p>
      </div>
    </details>`;
  }).join("");

  document.getElementById("app").innerHTML = `${pageHero("Archives Yahoo", "Sept saisons. <em>Aucun oubli.</em>", "La ligue a changé de taille et de visages. Chaque saison garde donc sa propre liste de participants, sans inventer de correspondance entre anciens et nouveaux noms d'équipe.", { label: "Fenêtre d'archive", value: "19—25", note: "7 saisons · 88 participations" })}
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Mouvements</p><h2>Le noyau et les passages.</h2></div><p>Les profils Yahoo permettent enfin de suivre les personnes malgré leurs changements de nom d'équipe.</p></div>
      <div class="movement-grid">
        <article class="movement"><span>2022—2025</span><strong>12 / 12</strong><p>Le même noyau de managers revient pendant quatre saisons consécutives.</p></article>
        <article class="movement"><span>Après 2021</span><strong>2 sorties</strong><p>Erwan et Mountaga ne figurent plus dans la ligue à partir de 2022.</p></article>
        <article class="movement"><span>Identités vérifiées</span><strong>${coverage.confirmedParticipations} / ${coverage.totalParticipations}</strong><p>Toutes les participations 2019–2025 sont maintenant attribuées à leur manager confirmé.</p></article>
      </div>
    </div></section>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">2019 — 2025</p><h2>La chronologie</h2></div><p>Ouvrez une saison pour consulter son classement final et sa composition réelle.</p></div>
      <div class="timeline">${seasonsHtml}</div>
      <p class="note"><strong>Règle d'identité :</strong> une participation est attachée à une saison. Un nom d'équipe similaire n'est jamais utilisé seul pour fusionner deux managers.</p>
    </div></section>`;
}

async function renderHallOfFame(data) {
  const [matchupArchive, playoffArchive] = await Promise.all([
    loadYahooMatchups(),
    loadYahooPlayoffs()
  ]);
  const recordBook = buildYahooRecordBook(data, matchupArchive, playoffArchive);
  const titles = Object.values(data.seasons.reduce((result, season) => {
    const manager = season.champion.manager;
    result[manager] ||= { manager, count: 0, years: [] };
    result[manager].count += 1;
    result[manager].years.push(season.year);
    return result;
  }, {})).sort((a, b) => b.count - a.count || b.years[0] - a.years[0]);

  const allTeams = data.seasons.flatMap(season => season.teams.map(team => ({ ...team, year: season.year })));
  const pointsRecord = allTeams.reduce((best, item) => item.pf > best.pf ? item : best);
  const bestWinRate = Math.max(...allTeams.map(item => item.wins / (item.wins + item.losses)));
  const winRecords = allTeams.filter(item => item.wins / (item.wins + item.losses) === bestWinRate);
  const differentialRecord = allTeams.reduce((best, item) => item.pf - item.pa > best.pf - best.pa ? item : best);
  const maxTitles = Math.max(...titles.map(item => item.count));

  document.getElementById("app").innerHTML = `${pageHero("Hall of Fame", "Ceux qui ont <em>fini le travail.</em>", "Les titres sont attribués aux managers confirmés par les pages de champion Yahoo. Les noms d'équipe restent ceux de leur époque.", { label: "Palmarès officiel", value: "07", note: "4 managers titrés" })}
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Palmarès</p><h2>Les champions</h2></div><p>De Fun Guy Team en 2019 à Flemme en 2025.</p></div>
      <div class="trophy-grid">${data.seasons.map(season => `<article class="trophy"><span class="trophy-year">${season.year}</span><strong class="trophy-team">${escapeHtml(season.champion.team)}</strong><span class="trophy-manager">Manager · ${escapeHtml(season.champion.manager)}</span></article>`).join("")}</div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Dynasties</p><h2>La course aux bagues</h2></div><p>Comptage par identifiant manager Yahoo confirmé.</p></div>
      <div class="bars">${titles.map(item => `<div class="bar-row"><span class="bar-label">${escapeHtml(item.manager)}</span><span class="bar-track"><span class="bar-fill" style="width:${(item.count / maxTitles) * 100}%"></span></span><span class="bar-value">${item.count} titre${item.count > 1 ? "s" : ""}</span></div>`).join("")}</div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Records de saison</p><h2>Dominer sur la durée.</h2></div><p>Records calculés sur les classements finaux des sept saisons Yahoo.</p></div>
      <div class="record-grid">
        <article class="record"><span class="record-label">Points sur une saison</span><strong>${escapeHtml(pointsRecord.team)}</strong><span>${formatPoints(pointsRecord.pf)} PF · ${pointsRecord.year}</span></article>
        <article class="record"><span class="record-label">Meilleur bilan</span><strong>${winRecords.map(item => escapeHtml(item.team)).join(" · ")}</strong><span>${winRecords[0].wins}–${winRecords[0].losses} · ${winRecords.map(item => item.year).join(" / ")}</span></article>
        <article class="record"><span class="record-label">Meilleur différentiel</span><strong>${escapeHtml(differentialRecord.team)}</strong><span>+${formatPoints(differentialRecord.pf - differentialRecord.pa)} · ${differentialRecord.year}</span></article>
      </div>
    </div></section>

    <section class="section record-book-section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Un dimanche</p><h2>Les matchs qui cassent l'échelle.</h2></div><p>Records sur les 609 confrontations de saison régulière, avec l'adversaire et la semaine conservés pour chaque performance.</p></div>
      <div class="record-book-grid">
        <article class="record-book-card record-book-major"><span>Score ultime</span><em>${formatPoints(recordBook.highScore.points)}</em><strong>${escapeHtml(recordBook.highScore.manager)}</strong><small>${escapeHtml(recordBook.highScore.team)} · ${recordBook.highScore.year} S${recordBook.highScore.week}</small></article>
        <article class="record-book-card"><span>Série record</span><em>${recordBook.topStreaks[0].wins}</em><strong>${escapeHtml(recordBook.topStreaks[0].manager)}</strong><small>${recordBook.topStreaks[0].year} · S${recordBook.topStreaks[0].startWeek}—S${recordBook.topStreaks[0].endWeek}</small></article>
        <article class="record-book-card"><span>Plus gros écart</span><em>+${formatPoints(recordBook.biggestWin.points - recordBook.biggestWin.opponent.points)}</em><strong>${escapeHtml(recordBook.biggestWin.manager)}</strong><small>contre ${escapeHtml(recordBook.biggestWin.opponent.manager)} · ${recordBook.biggestWin.year} S${recordBook.biggestWin.week}</small></article>
        <article class="record-book-card"><span>Victoire la plus serrée</span><em>${formatPoints(recordBook.closestWin.points - recordBook.closestWin.opponent.points)}</em><strong>${escapeHtml(recordBook.closestWin.manager)}</strong><small>${formatPoints(recordBook.closestWin.points)}—${formatPoints(recordBook.closestWin.opponent.points)} · ${recordBook.closestWin.year} S${recordBook.closestWin.week}</small></article>
        <article class="record-book-card"><span>Défaite la plus cruelle</span><em>${formatPoints(recordBook.highestLoss.points)}</em><strong>${escapeHtml(recordBook.highestLoss.manager)}</strong><small>contre ${escapeHtml(recordBook.highestLoss.opponent.manager)} · ${recordBook.highestLoss.year} S${recordBook.highestLoss.week}</small></article>
        <article class="record-book-card"><span>Match le plus offensif</span><em>${formatPoints(recordBook.highestCombined.team1.points + recordBook.highestCombined.team2.points)}</em><strong>${escapeHtml(recordBook.highestCombined.team1.manager)} × ${escapeHtml(recordBook.highestCombined.team2.manager)}</strong><small>${formatPoints(recordBook.highestCombined.team1.points)}—${formatPoints(recordBook.highestCombined.team2.points)} · ${recordBook.highestCombined.year} S${recordBook.highestCombined.week}</small></article>
      </div>
      <div class="section-head streak-head"><div><p class="eyebrow">7 victoires minimum</p><h2>Les séries de 7+.</h2></div><p>Toutes les séries d'au moins sept victoires au sein d'une même saison régulière ; playoffs et intersaisons ne les prolongent pas.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Manager</th><th>Équipe</th><th class="num">Saison</th><th class="num">Semaines</th><th class="num">Victoires</th></tr></thead><tbody>${recordBook.topStreaks.map(streak => `<tr><td class="team-name">${escapeHtml(streak.manager)}</td><td>${escapeHtml(streak.team)}</td><td class="num">${streak.year}</td><td class="num">S${streak.startWeek}—S${streak.endWeek}</td><td class="num franchise-title-count">${streak.wins}</td></tr>`).join("")}</tbody></table></div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Postseason</p><h2>Quand chaque point pèse.</h2></div><p>Records séparés sur les 52 matchs du tableau principal Yahoo 2019–2025.</p></div>
      <div class="record-grid">
        <article class="record"><span class="record-label">Record playoffs</span><strong>${escapeHtml(recordBook.playoffHigh.manager)}</strong><span>${formatPoints(recordBook.playoffHigh.points)} · ${recordBook.playoffHigh.year} ${recordBook.playoffHigh.round === "final" ? "finale" : `S${recordBook.playoffHigh.week}`}</span></article>
        <article class="record"><span class="record-label">Plus gros écart</span><strong>${escapeHtml(recordBook.playoffBiggestWin.manager)}</strong><span>+${formatPoints(recordBook.playoffBiggestWin.points - recordBook.playoffBiggestWin.opponent.points)} · ${recordBook.playoffBiggestWin.year}</span></article>
        <article class="record"><span class="record-label">Plus petit écart</span><strong>${escapeHtml(recordBook.playoffClosestWin.manager)}</strong><span>${formatPoints(recordBook.playoffClosestWin.points - recordBook.playoffClosestWin.opponent.points)} · ${recordBook.playoffClosestWin.year}</span></article>
      </div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Final rosters 2025</p><h2>Top 10 joueurs</h2></div><p>Classement Yahoo des joueurs présents sur les effectifs finaux.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Rang</th><th>Joueur</th><th>Équipe fantasy</th></tr></thead><tbody>${data.topPlayers2025.map(player => `<tr><td class="rank">${player.rank}</td><td class="team-name">${escapeHtml(player.player)}</td><td>${escapeHtml(player.team)}</td></tr>`).join("")}</tbody></table></div>
    </div></section>`;
}

function aggregateHeadToHead(matchupArchive) {
  const managers = new Map();
  const pairs = new Map();

  function managerRecord(name) {
    if (!managers.has(name)) {
      managers.set(name, { manager: name, games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });
    }
    return managers.get(name);
  }

  for (const season of matchupArchive.seasons) {
    for (const week of season.weeks) {
      for (const matchup of week.matchups) {
        const sides = [
          { manager: matchup.team1Manager, score: matchup.team1Score, opponentScore: matchup.team2Score },
          { manager: matchup.team2Manager, score: matchup.team2Score, opponentScore: matchup.team1Score }
        ];

        for (const side of sides) {
          const record = managerRecord(side.manager);
          record.games += 1;
          record.pointsFor += side.score;
          record.pointsAgainst += side.opponentScore;
          if (side.score > side.opponentScore) record.wins += 1;
          else if (side.score < side.opponentScore) record.losses += 1;
          else record.ties += 1;
        }

        const names = sides.map(side => side.manager).sort((a, b) => a.localeCompare(b, "fr"));
        const key = names.join("::");
        if (!pairs.has(key)) {
          pairs.set(key, {
            managerA: names[0], managerB: names[1], games: 0,
            winsA: 0, winsB: 0, ties: 0, pointsA: 0, pointsB: 0
          });
        }
        const pair = pairs.get(key);
        const scoreA = sides.find(side => side.manager === pair.managerA).score;
        const scoreB = sides.find(side => side.manager === pair.managerB).score;
        pair.games += 1;
        pair.pointsA += scoreA;
        pair.pointsB += scoreB;
        if (scoreA > scoreB) pair.winsA += 1;
        else if (scoreB > scoreA) pair.winsB += 1;
        else pair.ties += 1;
      }
    }
  }

  const leaderboard = [...managers.values()].map(record => ({
    ...record,
    winRate: record.games ? (record.wins + record.ties / 2) / record.games : 0
  })).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.pointsFor - a.pointsFor);

  return { leaderboard, pairs: [...pairs.values()] };
}

function matchupsAgainst(pairs, manager) {
  return pairs.filter(pair => pair.managerA === manager || pair.managerB === manager).map(pair => {
    const isA = pair.managerA === manager;
    return {
      opponent: isA ? pair.managerB : pair.managerA,
      games: pair.games,
      wins: isA ? pair.winsA : pair.winsB,
      losses: isA ? pair.winsB : pair.winsA,
      ties: pair.ties,
      pointsFor: isA ? pair.pointsA : pair.pointsB,
      pointsAgainst: isA ? pair.pointsB : pair.pointsA
    };
  }).sort((a, b) => b.games - a.games || b.wins - a.wins || a.opponent.localeCompare(b.opponent, "fr"));
}

async function renderMatchups(data) {
  const [matchupArchive, playoffArchive] = await Promise.all([
    loadYahooMatchups(),
    loadYahooPlayoffs()
  ]);
  const headToHead = aggregateHeadToHead(matchupArchive);
  const matchupCount = matchupArchive.seasons.reduce((total, season) => total
    + season.weeks.reduce((seasonTotal, week) => seasonTotal + week.matchups.length, 0), 0);
  const winsLeader = headToHead.leaderboard[0];
  const pointsLeader = [...headToHead.leaderboard].sort((a, b) => b.pointsFor - a.pointsFor)[0];
  const rateLeader = [...headToHead.leaderboard].filter(item => item.games >= 20)
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)[0];
  const longestRivalry = [...headToHead.pairs].sort((a, b) => b.games - a.games || a.managerA.localeCompare(b.managerA, "fr"))[0];
  const playoffSeasons = allYahooPlayoffSeasons(data, playoffArchive);
  const playoffGames = playoffSeasons.flatMap(season => season.games.map(game => ({ ...game, year: season.year })));
  const postseasonRecords = new Map();
  for (const game of playoffGames) {
    for (const [side, won] of [[game.winner, true], [game.loser, false]]) {
      const record = postseasonRecords.get(side.manager) || { manager: side.manager, wins: 0, losses: 0, finals: 0, titles: 0 };
      if (won) record.wins += 1;
      else record.losses += 1;
      if (game.round === "final") {
        record.finals += 1;
        if (won) record.titles += 1;
      }
      postseasonRecords.set(side.manager, record);
    }
  }
  const postseasonLeaders = [...postseasonRecords.values()];
  const playoffWinsLeader = [...postseasonLeaders].sort((a, b) => b.wins - a.wins || a.losses - b.losses)[0];
  const playoffRateLeader = postseasonLeaders.filter(item => item.wins + item.losses >= 4)
    .sort((a, b) => (b.wins / (b.wins + b.losses)) - (a.wins / (a.wins + a.losses)) || b.wins - a.wins)[0];
  const maxFinals = Math.max(...postseasonLeaders.map(item => item.finals));
  const maxTitles = Math.max(...postseasonLeaders.map(item => item.titles));
  const finalsLeaders = postseasonLeaders.filter(item => item.finals === maxFinals);
  const titlesLeaders = postseasonLeaders.filter(item => item.titles === maxTitles);
  const high = Math.max(...data.weeklyHighs2025.map(item => item.points));
  const activeManagers = [...ACTIVE_MANAGERS_2026].sort((a, b) => a.localeCompare(b, "fr"));
  const activePairs = headToHead.pairs.filter(pair =>
    activeManagers.includes(pair.managerA) && activeManagers.includes(pair.managerB));
  const pairByManagers = new Map(activePairs.map(pair => [[pair.managerA, pair.managerB]
    .sort((a, b) => a.localeCompare(b, "fr")).join("::"), pair]));
  const frequentPairs = [...activePairs].sort((a, b) => b.games - a.games
    || Math.abs(a.winsA - a.winsB) - Math.abs(b.winsA - b.winsB)
    || a.managerA.localeCompare(b.managerA, "fr")).slice(0, 12);

  function matrixCell(rowManager, columnManager) {
    if (rowManager === columnManager) return `<td class="matrix-self" aria-label="Même manager">—</td>`;
    const key = [rowManager, columnManager].sort((a, b) => a.localeCompare(b, "fr")).join("::");
    const pair = pairByManagers.get(key);
    if (!pair) return `<td class="matrix-empty">—</td>`;
    const rowIsA = pair.managerA === rowManager;
    const wins = rowIsA ? pair.winsA : pair.winsB;
    const losses = rowIsA ? pair.winsB : pair.winsA;
    const close = Math.abs(wins - losses) <= 1;
    return `<td class="matrix-cell${close ? " matrix-close" : ""}" title="${escapeHtml(rowManager)} contre ${escapeHtml(columnManager)} · ${pair.games} matchs"><strong>${wins}–${losses}</strong><small>${pair.games}</small></td>`;
  }

  document.getElementById("app").innerHTML = `${pageHero("Matchups", "Le dimanche se <em>décide ici.</em>", "Sept saisons de duels Yahoo sont enfin réunies. Choisissez un manager, mesurez ses rivalités et retrouvez les parcours qui ont mené à chaque titre.", { label: "Duels vérifiés", value: matchupCount, note: "Saisons régulières · 2019—2025" })}
    <section class="section h2h-section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Face-à-face all-time</p><h2>Choisis ton rival.</h2></div><p>Résultats de saison régulière uniquement. Les playoffs ont leur propre bilan ci-dessous pour préserver le contexte.</p></div>
      <div class="record-grid h2h-records">
        <article class="record"><span class="record-label">Plus de victoires</span><strong>${escapeHtml(winsLeader.manager)}</strong><span>${winsLeader.wins} victoires · ${winsLeader.games} matchs</span></article>
        <article class="record"><span class="record-label">Meilleur taux</span><strong>${escapeHtml(rateLeader.manager)}</strong><span>${formatPoints(rateLeader.winRate * 100, 1)} % · min. 20 matchs</span></article>
        <article class="record"><span class="record-label">Roi des points</span><strong>${escapeHtml(pointsLeader.manager)}</strong><span>${formatPoints(pointsLeader.pointsFor)} PF cumulés</span></article>
        <article class="record"><span class="record-label">Rivalité la plus jouée</span><strong>${escapeHtml(longestRivalry.managerA)} × ${escapeHtml(longestRivalry.managerB)}</strong><span>${longestRivalry.games} confrontations</span></article>
      </div>

      <div class="section-head matrix-head"><div><p class="eyebrow">Les 12 managers 2026</p><h2>La matrice des rivalités.</h2></div><p>Chaque cellule se lit du point de vue de la ligne : bilan victoires–défaites, puis nombre total de confrontations.</p></div>
      <div class="table-wrap matrix-wrap"><table class="matchup-matrix">
        <thead><tr><th>Manager</th>${activeManagers.map(manager => `<th><span title="${escapeHtml(manager)}">${escapeHtml(shortManagerName(manager))}</span></th>`).join("")}</tr></thead>
        <tbody>${activeManagers.map(rowManager => `<tr><th>${escapeHtml(rowManager)}</th>${activeManagers.map(columnManager => matrixCell(rowManager, columnManager)).join("")}</tr>`).join("")}</tbody>
      </table></div>

      <div class="section-head frequent-head"><div><p class="eyebrow">Volume historique</p><h2>Les affiches les plus jouées.</h2></div><p>En cas d'égalité sur le nombre de matchs, le bilan le plus serré apparaît en premier.</p></div>
      <div class="table-wrap"><table class="frequent-table"><thead><tr><th>Affiche</th><th class="num">Matchs</th><th>Bilan</th><th class="num">Diff. points</th></tr></thead><tbody>${frequentPairs.map(pair => `<tr>
        <td class="team-name">${escapeHtml(pair.managerA)} × ${escapeHtml(pair.managerB)}</td><td class="num">${pair.games}</td>
        <td>${escapeHtml(pair.managerA)} ${pair.winsA}–${pair.winsB} ${escapeHtml(pair.managerB)}</td>
        <td class="num ${pair.pointsA >= pair.pointsB ? "positive" : "negative"}">${pair.pointsA >= pair.pointsB ? "+" : ""}${formatPoints(pair.pointsA - pair.pointsB)}</td>
      </tr>`).join("")}</tbody></table></div>

      <div class="duel-board">
        <div class="duel-control">
          <p class="eyebrow">Dossier manager</p>
          <label for="h2h-manager">Manager
            <select id="h2h-manager">${headToHead.leaderboard.map(item => `<option value="${escapeHtml(item.manager)}">${escapeHtml(item.manager)}</option>`).join("")}</select>
          </label>
          <p>Les bilans s'affichent du point de vue du manager sélectionné.</p>
        </div>
        <div id="h2h-manager-summary" class="duel-summary" aria-live="polite"></div>
      </div>
      <div id="h2h-table"></div>
      <p class="note"><strong>Source :</strong> 609 matchups Yahoo authentifiés, reliés à 15 managers et réconciliés avec les bilans et points finaux de chaque saison.</p>
    </div></section>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Playoffs 2019—2025</p><h2>La route du titre.</h2></div><p>Chaque tableau de championnat Yahoo, séparé des matchs de consolation.</p></div>
      <div class="record-grid h2h-records playoff-records">
        <article class="record"><span class="record-label">Plus de victoires</span><strong>${escapeHtml(playoffWinsLeader.manager)}</strong><span>${playoffWinsLeader.wins} victoires en playoffs</span></article>
        <article class="record"><span class="record-label">Meilleur taux</span><strong>${escapeHtml(playoffRateLeader.manager)}</strong><span>${formatPoints(playoffRateLeader.wins / (playoffRateLeader.wins + playoffRateLeader.losses) * 100, 1)} % · min. 4 matchs</span></article>
        <article class="record"><span class="record-label">Plus de finales</span><strong>${finalsLeaders.length} managers</strong><span>${finalsLeaders.map(item => escapeHtml(item.manager)).join(" · ")} · ${maxFinals} chacun</span></article>
        <article class="record"><span class="record-label">Plus de titres</span><strong>${titlesLeaders.map(item => escapeHtml(item.manager)).join(" · ")}</strong><span>${maxTitles} titres chacun</span></article>
      </div>
      <div class="toolbar playoff-toolbar">
        <label for="playoff-season-select">Saison <select id="playoff-season-select">${playoffSeasons.map(season => `<option value="${season.year}">${season.year}</option>`).join("")}</select></label>
        <a class="source-link" id="playoff-source-link" href="${playoffSeasons[0].sourceUrl}" target="_blank" rel="noreferrer">Tableau Yahoo ↗</a>
      </div>
      <div class="match-grid" id="playoff-grid" aria-live="polite"></div>
      <p class="note"><strong>Périmètre :</strong> ${playoffGames.length} matchs du tableau principal, avec quarts de finale lorsqu'ils existent, demi-finales, finale et match pour la 3e place.</p>
    </div></section>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Saison régulière 2025</p><h2>Le leader chaque semaine</h2></div><p>Le meilleur score de chacune des 14 semaines régulières.</p></div>
      <div class="bars">${data.weeklyHighs2025.map(item => `<div class="bar-row"><span class="bar-label">S${item.week} · ${escapeHtml(item.team)}</span><span class="bar-track"><span class="bar-fill" style="width:${(item.points / high) * 100}%"></span></span><span class="bar-value">${formatPoints(item.points)}</span></div>`).join("")}</div>
    </div></section>`;

  const managerSelect = document.getElementById("h2h-manager");
  const summary = document.getElementById("h2h-manager-summary");
  const table = document.getElementById("h2h-table");
  const playoffSeasonSelect = document.getElementById("playoff-season-select");
  const playoffGrid = document.getElementById("playoff-grid");
  const playoffSourceLink = document.getElementById("playoff-source-link");

  function showPlayoffSeason(year) {
    const season = playoffSeasons.find(item => item.year === year);
    const roundLabels = {
      quarterfinal: "Quart de finale",
      semifinal: "Demi-finale",
      final: "Finale",
      third_place: "3e place"
    };
    playoffSourceLink.href = season.sourceUrl;
    playoffGrid.innerHTML = season.games.map(game => `<article class="match">
      <div class="match-meta"><span>Semaine ${game.week}</span><span>${roundLabels[game.round] || escapeHtml(game.round)}</span></div>
      <div class="match-line winner"><div><strong>${escapeHtml(game.winner.team)}</strong><small>${escapeHtml(game.winner.manager)}</small></div><span>${formatPoints(game.winner.points)}</span></div>
      <div class="match-line"><div><strong>${escapeHtml(game.loser.team)}</strong><small>${escapeHtml(game.loser.manager)}</small></div><span>${formatPoints(game.loser.points)}</span></div>
    </article>`).join("");
  }

  function showManager(manager) {
    const record = headToHead.leaderboard.find(item => item.manager === manager);
    const opponents = matchupsAgainst(headToHead.pairs, manager);
    const favorite = [...opponents].sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.games - a.games)[0];
    const nemesis = [...opponents].sort((a, b) => (a.wins - a.losses) - (b.wins - b.losses) || b.games - a.games)[0];

    summary.innerHTML = `<div><span>Bilan global</span><strong>${record.wins}—${record.losses}${record.ties ? `—${record.ties}` : ""}</strong><small>${formatPoints(record.winRate * 100, 1)} % de réussite</small></div>
      <div><span>Meilleur matchup</span><strong>${escapeHtml(favorite.opponent)}</strong><small>${favorite.wins}–${favorite.losses}${favorite.ties ? `–${favorite.ties}` : ""}</small></div>
      <div><span>Bête noire</span><strong>${escapeHtml(nemesis.opponent)}</strong><small>${nemesis.wins}–${nemesis.losses}${nemesis.ties ? `–${nemesis.ties}` : ""}</small></div>`;

    table.innerHTML = `<div class="table-wrap h2h-table"><table>
      <thead><tr><th>Adversaire</th><th class="num">Matchs</th><th class="num">V</th><th class="num">D</th><th class="num">N</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff.</th></tr></thead>
      <tbody>${opponents.map(opponent => `<tr>
        <td class="team-name">${escapeHtml(opponent.opponent)}</td>
        <td class="num">${opponent.games}</td><td class="num h2h-win">${opponent.wins}</td><td class="num">${opponent.losses}</td><td class="num">${opponent.ties}</td>
        <td class="num">${formatPoints(opponent.pointsFor)}</td><td class="num">${formatPoints(opponent.pointsAgainst)}</td>
        <td class="num ${opponent.pointsFor >= opponent.pointsAgainst ? "positive" : "negative"}">${opponent.pointsFor >= opponent.pointsAgainst ? "+" : ""}${formatPoints(opponent.pointsFor - opponent.pointsAgainst)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  managerSelect.addEventListener("change", () => showManager(managerSelect.value));
  playoffSeasonSelect.addEventListener("change", () => showPlayoffSeason(Number(playoffSeasonSelect.value)));
  showManager(managerSelect.value);
  showPlayoffSeason(Number(playoffSeasonSelect.value));
}

async function renderRivalryWeek(data) {
  const [matchupArchive, playoffArchive] = await Promise.all([
    loadYahooMatchups(),
    loadYahooPlayoffs()
  ]);
  const playoffGames = allYahooPlayoffSeasons(data, playoffArchive).flatMap(season =>
    season.games.map(game => ({ ...game, year: season.year })));
  const rivalries = buildRivalryRecords(matchupArchive, playoffGames);
  const totalMeetings = rivalries.reduce((total, rivalry) => total + rivalry.games, 0);
  const formLabel = result => ({ W: "V", L: "D", T: "N" })[result];

  function pointDifference(rivalry) {
    if (Math.abs(rivalry.pointDifference) < 0.001) return "Points parfaitement égaux";
    const leader = rivalry.pointDifference > 0 ? rivalry.managerA : rivalry.managerB;
    return `${escapeHtml(leader)} +${formatPoints(Math.abs(rivalry.pointDifference))}`;
  }

  function playoffLabel(rivalry) {
    if (!rivalry.playoffs.games) return "Aucun duel";
    return `${rivalry.playoffs.winsA}—${rivalry.playoffs.winsB} · ${rivalry.playoffs.games} match${rivalry.playoffs.games > 1 ? "s" : ""}`;
  }

  document.getElementById("app").innerHTML = `
    <section class="rivalry-hero"><div class="shell rivalry-hero-grid">
      <div class="rivalry-hero-copy">
        <p class="eyebrow">Adineu Rivalry Week · 2026</p>
        <h1>Toute une histoire.<br><em>Un seul dimanche.</em></h1>
        <p class="lede">Pour la semaine ${RIVALRY_WEEK}, les archives proposent six duels chargés d'histoire. À la ligue de décider ; quoi qu'il arrive, Sleeper restera la source du calendrier réel.</p>
        <div class="rivalry-hero-facts"><span>6 affiches</span><span>${totalMeetings} précédents</span><span>12 managers</span></div>
      </div>
      <aside class="rivalry-week-mark" aria-label="Semaine proposée pour les rivalités">
        <span>Saison régulière</span>
        <strong>08</strong>
        <small>Rivalry Week</small>
      </aside>
    </div></section>

    <section class="section rivalry-slate"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">La carte proposée</p><h2>Les six affiches.</h2></div><p>Bilans de saison régulière Yahoo 2019–2025. Les résultats de playoffs sont volontairement affichés à part.</p></div>
      <div class="rivalry-grid">${rivalries.map((rivalry, index) => `
        <article class="rivalry-card">
          <header><span>Proposition ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(rivalry.title)}</strong></header>
          <div class="rivalry-contenders">
            <div class="rivalry-manager rivalry-manager-a"><small>Manager</small><strong>${escapeHtml(rivalry.managerA)}</strong><span>${rivalry.winsA} victoire${rivalry.winsA > 1 ? "s" : ""}</span></div>
            <div class="rivalry-score"><span>All-time</span><strong>${rivalry.winsA}<i>—</i>${rivalry.winsB}</strong><small>${rivalry.games} matchs</small></div>
            <div class="rivalry-manager rivalry-manager-b"><small>Manager</small><strong>${escapeHtml(rivalry.managerB)}</strong><span>${rivalry.winsB} victoire${rivalry.winsB > 1 ? "s" : ""}</span></div>
          </div>
          <p class="rivalry-note">${escapeHtml(rivalry.note)}</p>
          <div class="rivalry-form">
            <span>5 derniers · vue ${escapeHtml(rivalry.managerA)}</span>
            <div aria-label="Cinq derniers résultats de ${escapeHtml(rivalry.managerA)}">${rivalry.lastFive.map(game => `<b class="result-${game.resultA.toLocaleLowerCase()}" title="${game.year} S${game.week} · ${formatPoints(game.pointsA)}–${formatPoints(game.pointsB)}">${formLabel(game.resultA)}</b>`).join("")}</div>
          </div>
          <footer>
            <div><span>Diff. points</span><strong>${pointDifference(rivalry)}</strong></div>
            <div><span>Série</span><strong>${rivalry.streak ? `${escapeHtml(rivalry.streak.manager)} · ${rivalry.streak.games}` : "—"}</strong></div>
            <div><span>Playoffs</span><strong>${playoffLabel(rivalry)}</strong></div>
          </footer>
        </article>`).join("")}</div>
      <p class="note"><strong>Périmètre :</strong> les bilans principaux couvrent uniquement les matchs de saison régulière Yahoo. Un résultat Sleeper ne rejoindra l'archive qu'après un véritable matchup joué.</p>
    </div></section>

    <section class="section schedule-planner"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Sleeper · Semaine ${RIVALRY_WEEK}</p><h2>La proposition et le réel.</h2></div><p>Le site n'écrit jamais le calendrier. Il vérifie seulement ce que Sleeper publie et indique combien d'affiches correspondent à la proposition.</p></div>
      <div class="rivalry-live-status" aria-live="polite">
        <span id="rivalry-live-source">Vérification Sleeper…</span>
        <strong id="rivalry-live-title">Lecture du calendrier</strong>
        <p id="rivalry-live-copy">Connexion à l'API publique de la ligue.</p>
      </div>
      <div class="schedule-grid" id="sleeper-rivalry-grid" aria-live="polite" hidden></div>
      <p class="note"><strong>Source de vérité :</strong> l'API Sleeper est publique mais strictement en lecture seule. La proposition ne modifie donc aucun matchup et reste soumise au vote ou à l'accord du groupe.</p>
    </div></section>

    <section class="section rivalry-method"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">La méthode</p><h2>Des chiffres, puis un choix.</h2></div><p>La fréquence seule favorise parfois un duel à sens unique. Cette proposition équilibre l'histoire, la compétitivité et les matchs qui comptaient vraiment.</p></div>
      <div class="rivalry-criteria">${RIVALRY_CRITERIA.map((criterion, index) => `<article><span>0${index + 1} · ${escapeHtml(criterion.label)}</span><strong>${criterion.weight}%</strong><p>${escapeHtml(criterion.detail)}</p></article>`).join("")}</div>
      <div class="rivalry-schedule">
        <div><p class="eyebrow">Si le groupe valide</p><h3>La semaine 8 peut devenir officielle.</h3></div>
        <ol><li>Valider le principe avec les membres.</li><li>Ouvrir <strong>Edit Schedule Matchups</strong> après la draft.</li><li>Reporter les six affiches proposées.</li></ol>
        <a class="source-link" href="https://support.sleeper.com/en/articles/1955931-can-i-randomize-my-league-s-schedule" target="_blank" rel="noreferrer">Guide officiel Sleeper ↗</a>
      </div>
      <p class="note"><strong>Équité :</strong> si elle est adoptée, la Rivalry Week remplace une semaine normale ; elle ne crée pas un match supplémentaire.</p>
    </div></section>`;

  const liveSource = document.getElementById("rivalry-live-source");
  const liveTitle = document.getElementById("rivalry-live-title");
  const liveCopy = document.getElementById("rivalry-live-copy");
  const sleeperGrid = document.getElementById("sleeper-rivalry-grid");

  function pairKey(matchup) {
    return [matchup.managerA, matchup.managerB].sort((a, b) => a.localeCompare(b, "fr")).join("::");
  }

  function scheduleCards(matchups) {
    return matchups.map((matchup, index) => `<article class="schedule-match">
      <span>Match ${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(matchup.managerA)}</strong><i>VS</i><strong>${escapeHtml(matchup.managerB)}</strong></div>
      ${matchup.pointsA || matchup.pointsB ? `<small>${formatPoints(matchup.pointsA)} — ${formatPoints(matchup.pointsB)}</small>` : ""}
    </article>`).join("");
  }

  function showProposalStatus(reason) {
    liveSource.textContent = reason;
    liveSource.className = "schedule-source schedule-source-rivalry";
    liveTitle.textContent = "Une proposition, pas une décision.";
    liveCopy.textContent = "Aucun matchup n'a été modifié. Les six affiches ci-dessus restent une idée à soumettre au groupe.";
    sleeperGrid.hidden = true;
  }

  async function showSleeperRivalryWeek() {
    const league = await loadSleeperResource(`/league/${SLEEPER_LEAGUE_ID}`).catch(() => null);
    if (!league || league.status === "pre_draft") {
      showProposalStatus(league ? "Sleeper · pré-draft" : "Sleeper · API indisponible");
      return;
    }
    try {
      const [rows, rosters, users] = await Promise.all([
        loadSleeperResource(`/league/${SLEEPER_LEAGUE_ID}/matchups/${RIVALRY_WEEK}`),
        loadSleeperResource(`/league/${SLEEPER_LEAGUE_ID}/rosters`),
        loadSleeperResource(`/league/${SLEEPER_LEAGUE_ID}/users`)
      ]);
      const liveMatchups = buildSleeperWeek(rows, rosters, users);
      if (liveMatchups.length !== 6) {
        showProposalStatus("Sleeper · calendrier incomplet");
        return;
      }
      const proposedKeys = new Set(rivalries.map(pairKey));
      const matching = liveMatchups.filter(matchup => proposedKeys.has(pairKey(matchup))).length;
      liveSource.textContent = "API Sleeper · calendrier publié";
      liveSource.className = "schedule-source schedule-source-live";
      liveTitle.textContent = `Semaine ${RIVALRY_WEEK} officielle : ${matching}/6 correspondances.`;
      liveCopy.textContent = matching === 6
        ? "La proposition Rivalry Week a été entièrement reprise dans Sleeper."
        : "Voici les véritables affiches Sleeper ; elles restent prioritaires sur la proposition historique.";
      sleeperGrid.innerHTML = scheduleCards(liveMatchups);
      sleeperGrid.hidden = false;
    } catch {
      showProposalStatus("Sleeper · API indisponible");
    }
  }
  await showSleeperRivalryWeek();
}

function buildFranchiseRecords(data, matchupArchive, playoffArchive) {
  const regularByManager = new Map(aggregateHeadToHead(matchupArchive).leaderboard
    .map(record => [record.manager, record]));
  const records = new Map(data.managerHistory.map(profile => {
    const seasons = Object.entries(profile.seasons).map(([year, teamName]) => {
      const season = data.seasons.find(item => item.year === Number(year));
      const team = season.teams.find(item => normalizeTeamName(item.team) === normalizeTeamName(teamName));
      return { ...team, year: Number(year), team: teamName };
    }).sort((a, b) => a.year - b.year);
    const aliases = [...new Map(seasons.map(season => [normalizeTeamName(season.team), season.team])).values()];
    const regular = regularByManager.get(profile.manager) || {
      games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, winRate: 0
    };
    return [profile.manager, {
      manager: profile.manager,
      seasons,
      aliases,
      firstYear: seasons[0].year,
      lastYear: seasons.at(-1).year,
      latestTeam: seasons.at(-1).team,
      seasonCount: seasons.length,
      bestFinish: Math.min(...seasons.map(season => season.rank)),
      podiums: seasons.filter(season => season.rank <= 3).length,
      regular,
      playoffs: { games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, finals: 0, titles: 0 }
    }];
  }));

  for (const season of allYahooPlayoffSeasons(data, playoffArchive)) {
    for (const game of season.games) {
      for (const [side, opponent, won] of [[game.winner, game.loser, true], [game.loser, game.winner, false]]) {
        const franchise = records.get(side.manager);
        franchise.playoffs.games += 1;
        franchise.playoffs.pointsFor += side.points;
        franchise.playoffs.pointsAgainst += opponent.points;
        if (won) franchise.playoffs.wins += 1;
        else franchise.playoffs.losses += 1;
        if (game.round === "final") {
          franchise.playoffs.finals += 1;
          if (won) franchise.playoffs.titles += 1;
        }
      }
    }
  }

  return [...records.values()].sort((a, b) =>
    b.regular.wins - a.regular.wins
    || b.regular.winRate - a.regular.winRate
    || b.playoffs.wins - a.playoffs.wins
    || a.manager.localeCompare(b.manager, "fr"));
}

async function renderFranchises(data) {
  const [matchupArchive, playoffArchive] = await Promise.all([
    loadYahooMatchups(),
    loadYahooPlayoffs()
  ]);
  const franchises = buildFranchiseRecords(data, matchupArchive, playoffArchive);
  const maxRegularWins = Math.max(...franchises.map(franchise => franchise.regular.wins));
  const regularWinsLeaders = franchises.filter(franchise => franchise.regular.wins === maxRegularWins);
  const regularWinsLeader = regularWinsLeaders[0];
  const playoffWinsLeader = [...franchises].sort((a, b) => b.playoffs.wins - a.playoffs.wins || a.playoffs.losses - b.playoffs.losses)[0];
  const maxTitles = Math.max(...franchises.map(franchise => franchise.playoffs.titles));
  const titleLeaders = franchises.filter(franchise => franchise.playoffs.titles === maxTitles);
  const maxSeasons = Math.max(...franchises.map(franchise => franchise.seasonCount));
  const ironManagers = franchises.filter(franchise => franchise.seasonCount === maxSeasons);
  const initialManager = new URLSearchParams(window.location.search).get("manager");
  const defaultManager = franchises.some(franchise => franchise.manager === initialManager)
    ? initialManager
    : regularWinsLeader.manager;

  document.getElementById("app").innerHTML = `${pageHero("Franchises", "Un manager. <em>Mille maillots.</em>", "Les noms d'équipe changent, la personne reste. Ces fiches réunissent chaque parcours Yahoo sans inventer d'identité entre deux franchises.", { label: "Golden records", value: franchises.length, note: "Managers · 88 participations" })}
    <section class="section franchise-leaders"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Le tableau d'honneur</p><h2>Les patrons du volume.</h2></div><p>Records cumulés sur la saison régulière et le tableau principal des playoffs, conservés comme deux contextes distincts.</p></div>
      <div class="record-grid h2h-records">
        <article class="record"><span class="record-label">Noyau historique</span><strong>${ironManagers.length} managers</strong><span>${maxSeasons} saisons chacun · 2019—2025</span></article>
        <article class="record"><span class="record-label">Victoires régulières</span><strong>${regularWinsLeaders.map(item => escapeHtml(item.manager)).join(" · ")}</strong><span>${maxRegularWins} victoires chacun</span></article>
        <article class="record"><span class="record-label">Victoires playoffs</span><strong>${escapeHtml(playoffWinsLeader.manager)}</strong><span>${playoffWinsLeader.playoffs.wins} victoires</span></article>
        <article class="record"><span class="record-label">Plus de titres</span><strong>${titleLeaders.map(item => escapeHtml(item.manager)).join(" · ")}</strong><span>${maxTitles} titres chacun</span></article>
      </div>
    </div></section>

    <section class="section franchise-dossier-section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Carte d'identité</p><h2>Ouvre le dossier.</h2></div><p>Choisis un manager pour suivre ses équipes, ses classements et ses bilans sur les sept saisons Yahoo.</p></div>
      <div class="franchise-board">
        <aside class="franchise-control">
          <label for="franchise-manager">Manager
            <select id="franchise-manager">${[...franchises].sort((a, b) => a.manager.localeCompare(b.manager, "fr")).map(franchise => `<option value="${escapeHtml(franchise.manager)}"${franchise.manager === defaultManager ? " selected" : ""}>${escapeHtml(franchise.manager)}</option>`).join("")}</select>
          </label>
          <p>Une franchise correspond ici à un manager confirmé, pas à un nom d'équipe.</p>
        </aside>
        <div id="franchise-profile" class="franchise-profile" aria-live="polite"></div>
      </div>
      <div id="franchise-season-cards" class="franchise-season-grid"></div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Saison régulière</p><h2>Le registre all-time.</h2></div><p>Trié par victoires de saison régulière. Les titres ne servent pas à fabriquer un power ranking implicite.</p></div>
      <div class="table-wrap franchise-table"><table>
        <thead><tr><th>Manager</th><th class="num">Saisons</th><th class="num">V</th><th class="num">D</th><th class="num">N</th><th class="num">Taux</th><th class="num">PF</th><th class="num">Playoffs</th><th class="num">Finales</th><th class="num">Titres</th></tr></thead>
        <tbody>${franchises.map(franchise => `<tr>
          <td class="team-name">${escapeHtml(franchise.manager)}</td><td class="num">${franchise.seasonCount}</td>
          <td class="num h2h-win">${franchise.regular.wins}</td><td class="num">${franchise.regular.losses}</td><td class="num">${franchise.regular.ties}</td>
          <td class="num">${formatPoints(franchise.regular.winRate * 100, 1)} %</td><td class="num">${formatPoints(franchise.regular.pointsFor)}</td>
          <td class="num">${franchise.playoffs.wins}—${franchise.playoffs.losses}</td><td class="num">${franchise.playoffs.finals}</td><td class="num franchise-title-count">${franchise.playoffs.titles}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <p class="note"><strong>Lecture :</strong> les 609 matchs réguliers déterminent V/D/N, taux et PF. Les 52 matchs de postseason déterminent le bilan playoffs, les finales et les titres.</p>
    </div></section>`;

  const managerSelect = document.getElementById("franchise-manager");
  const profile = document.getElementById("franchise-profile");
  const seasonCards = document.getElementById("franchise-season-cards");

  function showFranchise(manager) {
    const franchise = franchises.find(item => item.manager === manager);
    const number = String(franchises.findIndex(item => item.manager === manager) + 1).padStart(2, "0");
    const aliasLabel = franchise.aliases.length === 1 ? "Identité d'équipe" : "Identités d'équipe";
    profile.innerHTML = `<div class="franchise-profile-head">
        <div><span class="franchise-kicker">Depuis ${franchise.firstYear} · ${franchise.seasonCount} saison${franchise.seasonCount > 1 ? "s" : ""}</span><h3>${escapeHtml(franchise.manager)}</h3><p>Dernière équipe Yahoo · ${escapeHtml(franchise.latestTeam)}</p></div>
        <span class="franchise-number" aria-hidden="true">${number}</span>
      </div>
      <div class="franchise-aliases"><span>${aliasLabel}</span><div>${franchise.aliases.map(alias => `<small>${escapeHtml(alias)}</small>`).join("")}</div></div>
      <div class="franchise-metrics">
        <div><span>Saison régulière</span><strong>${franchise.regular.wins}—${franchise.regular.losses}${franchise.regular.ties ? `—${franchise.regular.ties}` : ""}</strong><small>${formatPoints(franchise.regular.winRate * 100, 1)} %</small></div>
        <div><span>Points marqués</span><strong>${formatPoints(franchise.regular.pointsFor, 0)}</strong><small>${formatPoints(franchise.regular.pointsAgainst, 0)} encaissés</small></div>
        <div><span>Playoffs</span><strong>${franchise.playoffs.wins}—${franchise.playoffs.losses}</strong><small>${franchise.playoffs.finals} ${franchise.playoffs.finals === 1 ? "finale" : "finales"}</small></div>
        <div><span>Palmarès</span><strong>${franchise.playoffs.titles}</strong><small>${franchise.playoffs.titles === 1 ? "titre" : "titres"} · ${franchise.podiums} ${franchise.podiums === 1 ? "podium" : "podiums"}</small></div>
      </div>`;

    seasonCards.innerHTML = [...franchise.seasons].reverse().map(season => `<article class="franchise-season${season.rank === 1 ? " champion" : ""}">
      <div><span>${season.year}</span><strong>#${season.rank}</strong></div>
      <h3>${escapeHtml(season.team)}</h3>
      <p>${season.wins}—${season.losses}${season.ties ? `—${season.ties}` : ""} · ${formatPoints(season.pf)} PF</p>
      ${season.rank <= 3 ? `<small>${season.rank === 1 ? "Champion" : season.rank === 2 ? "Finaliste" : "3e place"}</small>` : ""}
    </article>`).join("");
    window.history.replaceState(null, "", `${window.location.pathname}?manager=${encodeURIComponent(manager)}`);
  }

  managerSelect.addEventListener("change", () => showFranchise(managerSelect.value));
  showFranchise(managerSelect.value);
}

function sleeperStatusLabel(status) {
  return ({
    pre_draft: "Pré-draft",
    drafting: "Draft en cours",
    in_season: "Saison en cours",
    complete: "Terminée"
  })[status] || status || "À confirmer";
}

function formatDraftDate(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "À programmer";
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(Number(timestamp)));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1).replace(" à ", " · ");
}

async function renderPowerRankings() {
  const [league, nflState, standings, matchupRows] = await Promise.all([
    loadSleeperResource(`/league/${SLEEPER_LEAGUE_ID}`),
    loadSleeperResource("/state/nfl"),
    loadLiveStandings(),
    loadSleeperMatchups()
  ]);
  const draft = league.draft_id
    ? await loadSleeperResource(`/draft/${league.draft_id}`)
    : null;
  const expectedManagers = [...new Set(standings.map(row => row.owner_name).filter(Boolean))];
  const currentWeek = league.status === "in_season" && nflState.season_type === "regular"
    ? Number(nflState.week)
    : null;
  const result = calculatePowerRankings(matchupRows, { currentWeek, expectedManagers });
  const leagueStatus = sleeperStatusLabel(league.status);
  const draftDate = formatDraftDate(draft?.start_time);
  const teamCount = Number(league.total_rosters) || standings.length;
  const draftFormat = draft?.type === "snake" ? "Serpent" : draft?.type || "À confirmer";
  const draftRounds = Number(draft?.settings?.rounds) || 0;
  const pickTimer = Number(draft?.settings?.pick_timer) || 0;
  const progress = Math.min(result.completedWeekCount / MINIMUM_COMPLETED_WEEKS, 1) * 100;
  const latestWeek = result.completedWeeks.at(-1);

  const rankingContent = result.ready ? `
    <div class="power-podium">${result.rankings.slice(0, 3).map((row, index) => `<article>
      <span>#${row.rank} · ${index === 0 ? "Leader" : "Challenger"}</span>
      <strong>${escapeHtml(row.manager)}</strong>
      <small>${escapeHtml(row.team)} · ${formatPoints(row.powerScore, 1)}</small>
    </article>`).join("")}</div>
    <div class="table-wrap power-table"><table>
      <thead><tr><th>Rang</th><th>Manager</th><th>Équipe</th><th class="num">Power</th><th class="num">Bilan</th><th class="num">PPG</th><th class="num">Marge 3 sem.</th></tr></thead>
      <tbody>${result.rankings.map(row => `<tr>
        <td class="rank">#${row.rank}</td><td class="team-name">${escapeHtml(row.manager)}</td><td>${escapeHtml(row.team)}</td>
        <td class="num power-score">${formatPoints(row.powerScore, 1)}</td>
        <td class="num">${row.wins}—${row.losses}${row.ties ? `—${row.ties}` : ""}</td>
        <td class="num">${formatPoints(row.pointsPerGame, 1)}</td>
        <td class="num ${row.recentMargin >= 0 ? "positive" : "negative"}">${row.recentMargin >= 0 ? "+" : ""}${formatPoints(row.recentMargin, 1)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <p class="note"><strong>Données arrêtées :</strong> semaine ${latestWeek}. La semaine live et les playoffs sont exclus du calcul.</p>` : `
    <div class="power-gate" aria-live="polite">
      <div class="power-lock" aria-hidden="true"><span></span><strong>${result.completedWeekCount}/${MINIMUM_COMPLETED_WEEKS}</strong></div>
      <div class="power-gate-copy">
        <p class="eyebrow">Classement verrouillé</p>
        <h2>Le terrain n’a pas encore parlé.</h2>
        <p>Le premier Power Ranking sera publié automatiquement après deux semaines régulières complètes pour les ${teamCount} équipes. Aucun classement pré-draft ne sera inventé.</p>
        <div class="power-progress" aria-label="${result.completedWeekCount} semaine complète sur ${MINIMUM_COMPLETED_WEEKS}"><span style="width:${progress}%"></span></div>
        <small>${result.teamsReady}/${teamCount} équipes ont actuellement le minimum de résultats requis.</small>
      </div>
    </div>`;

  document.getElementById("app").innerHTML = `${pageHero("Power Rankings · 2026", "Mesurer le <em>momentum.</em>", "Un thermomètre transparent de la saison Sleeper — jamais une opinion déguisée en statistique.", { label: "Publication", value: result.ready ? `S${latestWeek}` : `${result.completedWeekCount}/2`, note: result.ready ? "Mise à jour automatique" : "2 semaines complètes requises" })}
    <section class="section power-command"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Live Sleeper</p><h2>La salle de contrôle.</h2></div><a class="source-link" href="https://sleeper.com/leagues/${SLEEPER_LEAGUE_ID}" target="_blank" rel="noreferrer">Ouvrir la ligue Sleeper ↗</a></div>
      <div class="power-status-grid">
        <article class="power-status power-status-primary"><span>Saison 2026</span><strong>${escapeHtml(leagueStatus)}</strong><small>${teamCount} équipes confirmées</small></article>
        <article class="power-status"><span>Draft</span><strong>${escapeHtml(draftDate)}</strong><small>${escapeHtml(sleeperStatusLabel(draft?.status))}</small></article>
        <article class="power-status"><span>Format</span><strong>${escapeHtml(draftFormat)} · ${draftRounds || "—"}</strong><small>${draftRounds ? `${draftRounds} tours` : "Tours à confirmer"}${pickTimer ? ` · ${pickTimer} s par choix` : ""}</small></article>
      </div>
    </div></section>

    <section class="section power-ranking-section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Indice de forme</p><h2>Le classement du présent.</h2></div><p>Les résultats comptent plus que le bruit. Le scoring et la dynamique récente départagent les bilans.</p></div>
      ${rankingContent}
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Méthode publique</p><h2>Trois signaux. Zéro boîte noire.</h2></div><p>Chaque métrique est transformée en percentile parmi les 12 équipes avant pondération. Une égalité parfaite reste une égalité.</p></div>
      <div class="power-formula-grid">
        <article class="power-formula"><span>01 · Résultats</span><strong>${Math.round(POWER_WEIGHTS.winRate * 100)}%</strong><h3>Taux de victoire</h3><p>Une égalité compte comme une demi-victoire.</p></article>
        <article class="power-formula"><span>02 · Production</span><strong>${Math.round(POWER_WEIGHTS.pointsPerGame * 100)}%</strong><h3>Points par match</h3><p>La force offensive sur toutes les semaines terminées.</p></article>
        <article class="power-formula"><span>03 · Forme</span><strong>${Math.round(POWER_WEIGHTS.recentMargin * 100)}%</strong><h3>Marge récente</h3><p>Le différentiel moyen sur les trois dernières semaines complètes.</p></article>
      </div>
      <p class="note"><strong>Garde-fous :</strong> saison régulière uniquement, semaine en cours exclue, couverture complète des équipes obligatoire. Le score va de 0 à 100 et ne remplace pas le classement officiel.</p>
    </div></section>`;
}

async function start() {
  const app = document.getElementById("app");
  try {
    if (page === "power-rankings") {
      await renderPowerRankings();
      return;
    }
    const data = await loadHistory();
    if (page === "home") await renderHome(data);
    if (page === "standings") await renderStandings(data);
    if (page === "history") renderHistory(data);
    if (page === "hall-of-fame") await renderHallOfFame(data);
    if (page === "rivalry-week") await renderRivalryWeek(data);
    if (page === "matchups") await renderMatchups(data);
    if (page === "franchises") await renderFranchises(data);
  } catch (error) {
    app.innerHTML = `<section class="section"><div class="shell"><div class="state"><strong>Impossible de charger la page</strong>${escapeHtml(error.message)}</div></div></section>`;
  }
}

start();
