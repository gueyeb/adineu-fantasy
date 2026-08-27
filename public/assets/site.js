const SUPABASE_URL = "https://juosrzsffvjprqhdyado.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7Bu9q2dKz0WEol94OGVhHw_xjSwHeHu";
const CURRENT_SEASON = 2026;

const routes = [
  ["home", "/", "Accueil"],
  ["standings", "/standings/", "Classements"],
  ["matchups", "/matchups/", "Matchups"],
  ["history", "/history/", "Historique"],
  ["hall-of-fame", "/hall-of-fame/", "Hall of Fame"]
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

function yahooUrl(season) {
  return `https://football.fantasysports.yahoo.com/${season.year}/f1/${season.leagueId}`;
}

async function loadHistory() {
  const response = await fetch("/data/yahoo-history.json");
  if (!response.ok) throw new Error(`Archive indisponible (${response.status})`);
  return response.json();
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

function standingsTable(rows, isLive = false) {
  if (!rows.length) {
    return `<div class="state"><strong>Pas encore de classement</strong>Les données apparaîtront dès le début de la saison.</div>`;
  }

  return `<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Rang</th><th>Équipe</th>${isLive ? "<th>Manager</th>" : ""}
        <th class="num">V</th><th class="num">D</th><th class="num">N</th>
        <th class="num">PF</th><th class="num">PA</th>
      </tr></thead>
      <tbody>${rows.map((row, index) => `
        <tr class="${index === 0 && !isLive ? "champion-row" : ""}">
          <td class="rank">${escapeHtml(row.live_rank ?? row.rank)}</td>
          <td class="team-name">${escapeHtml(row.team_name ?? row.team)}</td>
          ${isLive ? `<td>${escapeHtml(row.owner_name || "—")}</td>` : ""}
          <td class="num">${escapeHtml(row.wins)}</td>
          <td class="num">${escapeHtml(row.losses)}</td>
          <td class="num">${escapeHtml(row.ties)}</td>
          <td class="num">${formatPoints(row.points_for ?? row.pf)}</td>
          <td class="num">${formatPoints(row.points_against ?? row.pa)}</td>
        </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function pageHero(eyebrow, title, lede) {
  return `<section class="page-hero"><div class="shell">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    <p class="lede">${lede}</p>
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
        <a class="feature" href="/hall-of-fame/"><span class="feature-kicker">Palmarès officiel</span><h3>Les immortels d'Adineu</h3><p>Sept champions, les règnes multiples et les records qui tiennent encore.</p><span class="feature-number">7</span></a>
        <a class="feature" href="/history/"><span class="feature-kicker">2019 → 2025</span><h3>Saison par saison</h3><p>Les participants réels, les classements complets et les podiums.</p><span class="feature-number">19</span></a>
      </div>
    </div></section>`;
}

async function renderStandings(data) {
  const options = [CURRENT_SEASON, ...data.seasons.map(season => season.year)];
  document.getElementById("app").innerHTML = `${pageHero("Classements", "La table ne ment pas.", "Suivez la saison Sleeper en direct ou remontez les classements finaux des années Yahoo.")}
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

  document.getElementById("app").innerHTML = `${pageHero("Archives Yahoo", "Sept saisons. Aucun oubli.", "La ligue a changé de taille et de visages. Chaque saison garde donc sa propre liste de participants, sans inventer de correspondance entre anciens et nouveaux noms d'équipe.")}
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">2019 — 2025</p><h2>La chronologie</h2></div><p>Ouvrez une saison pour consulter son classement final et sa composition réelle.</p></div>
      <div class="timeline">${seasonsHtml}</div>
      <p class="note"><strong>Règle d'identité :</strong> une participation est attachée à une saison. Un nom d'équipe similaire n'est jamais utilisé seul pour fusionner deux managers.</p>
    </div></section>`;
}

function renderHallOfFame(data) {
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
  const weeklyRecord = data.weeklyHighs2025.reduce((best, item) => item.points > best.points ? item : best);
  const maxTitles = Math.max(...titles.map(item => item.count));

  document.getElementById("app").innerHTML = `${pageHero("Hall of Fame", "Ceux qui ont fini le travail.", "Les titres sont attribués aux managers confirmés par les pages de champion Yahoo. Les noms d'équipe restent ceux de leur époque.")}
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Palmarès</p><h2>Les champions</h2></div><p>De Fun Guy Team en 2019 à Flemme en 2025.</p></div>
      <div class="trophy-grid">${data.seasons.map(season => `<article class="trophy"><span class="trophy-year">${season.year}</span><strong class="trophy-team">${escapeHtml(season.champion.team)}</strong><span class="trophy-manager">Manager · ${escapeHtml(season.champion.manager)}</span></article>`).join("")}</div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Dynasties</p><h2>La course aux bagues</h2></div><p>Comptage par identifiant manager Yahoo confirmé.</p></div>
      <div class="bars">${titles.map(item => `<div class="bar-row"><span class="bar-label">${escapeHtml(item.manager)}</span><span class="bar-track"><span class="bar-fill" style="width:${(item.count / maxTitles) * 100}%"></span></span><span class="bar-value">${item.count} titre${item.count > 1 ? "s" : ""}</span></div>`).join("")}</div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Record book</p><h2>Les gros chiffres</h2></div><p>Records calculés sur les données Yahoo archivées.</p></div>
      <div class="record-grid">
        <article class="record"><span class="record-label">Points sur une saison</span><strong>${escapeHtml(pointsRecord.team)}</strong><span>${formatPoints(pointsRecord.pf)} PF · ${pointsRecord.year}</span></article>
        <article class="record"><span class="record-label">Meilleur bilan</span><strong>${winRecords.map(item => escapeHtml(item.team)).join(" · ")}</strong><span>${winRecords[0].wins}–${winRecords[0].losses} · ${winRecords.map(item => item.year).join(" / ")}</span></article>
        <article class="record"><span class="record-label">Top score hebdo 2025</span><strong>${escapeHtml(weeklyRecord.team)}</strong><span>${formatPoints(weeklyRecord.points)} · semaine ${weeklyRecord.week}</span></article>
      </div>
    </div></section>

    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Final rosters 2025</p><h2>Top 10 joueurs</h2></div><p>Classement Yahoo des joueurs présents sur les effectifs finaux.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Rang</th><th>Joueur</th><th>Équipe fantasy</th></tr></thead><tbody>${data.topPlayers2025.map(player => `<tr><td class="rank">${player.rank}</td><td class="team-name">${escapeHtml(player.player)}</td><td>${escapeHtml(player.team)}</td></tr>`).join("")}</tbody></table></div>
    </div></section>`;
}

function renderMatchups(data) {
  const playoffCards = data.playoffs2025.map(match => `<article class="match">
    <div class="match-meta"><span>Semaine ${match.week}</span><span>${escapeHtml(match.round)}</span></div>
    <div class="match-line winner"><strong>${escapeHtml(match.winner)}</strong><span>${formatPoints(match.winnerPoints)}</span></div>
    <div class="match-line"><strong>${escapeHtml(match.loser)}</strong><span>${formatPoints(match.loserPoints)}</span></div>
  </article>`).join("");
  const high = Math.max(...data.weeklyHighs2025.map(item => item.points));

  document.getElementById("app").innerHTML = `${pageHero("Matchups", "Le dimanche se décide ici.", "Le direct Sleeper apparaîtra au lancement de la saison 2026. En attendant, revivez le dernier bracket Yahoo et les cartons hebdomadaires.")}
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Playoffs 2025</p><h2>La route du titre</h2></div><p>Flemme a traversé le tableau avant de battre Hunters en finale.</p></div>
      <div class="match-grid">${playoffCards}</div>
    </div></section>
    <section class="section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Saison régulière 2025</p><h2>Le leader chaque semaine</h2></div><p>Le meilleur score de chacune des 14 semaines régulières.</p></div>
      <div class="bars">${data.weeklyHighs2025.map(item => `<div class="bar-row"><span class="bar-label">S${item.week} · ${escapeHtml(item.team)}</span><span class="bar-track"><span class="bar-fill" style="width:${(item.points / high) * 100}%"></span></span><span class="bar-value">${formatPoints(item.points)}</span></div>`).join("")}</div>
    </div></section>`;
}

async function start() {
  const app = document.getElementById("app");
  try {
    const data = await loadHistory();
    if (page === "home") await renderHome(data);
    if (page === "standings") await renderStandings(data);
    if (page === "history") renderHistory(data);
    if (page === "hall-of-fame") renderHallOfFame(data);
    if (page === "matchups") renderMatchups(data);
  } catch (error) {
    app.innerHTML = `<section class="section"><div class="shell"><div class="state"><strong>Impossible de charger la page</strong>${escapeHtml(error.message)}</div></div></section>`;
  }
}

start();
