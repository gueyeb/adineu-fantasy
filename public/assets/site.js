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
  const response = await fetch("/data/yahoo-history.json?v=3", { cache: "no-store" });
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
  const response = await fetch("/data/yahoo-matchups.json?v=1", { cache: "no-store" });
  if (!response.ok) throw new Error(`Matchups Yahoo indisponibles (${response.status})`);
  return response.json();
}

async function loadYahooPlayoffs() {
  const response = await fetch("/data/yahoo-playoffs.json?v=1", { cache: "no-store" });
  if (!response.ok) throw new Error(`Playoffs Yahoo indisponibles (${response.status})`);
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
  const normalizeTeam = value => String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
  const managerForTeam = (year, team) => data.managerHistory.find(profile =>
    normalizeTeam(profile.seasons[String(year)] || "") === normalizeTeam(team))?.manager || "À confirmer";
  const season2025 = data.seasons.find(season => season.year === 2025);
  const playoffSeasons = [...playoffArchive.seasons, {
    year: 2025,
    leagueId: season2025.leagueId,
    sourceUrl: `${yahooUrl(season2025)}?module=standings&lhst=playoff#lhstplayoff`,
    games: data.playoffs2025.map(match => ({
      week: match.week,
      round: ({ Quarterfinal: "quarterfinal", Semifinal: "semifinal", Final: "final", "Third place": "third_place" })[match.round],
      winner: { team: match.winner, manager: managerForTeam(2025, match.winner), points: match.winnerPoints },
      loser: { team: match.loser, manager: managerForTeam(2025, match.loser), points: match.loserPoints }
    }))
  }].sort((a, b) => b.year - a.year);
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

  document.getElementById("app").innerHTML = `${pageHero("Matchups", "Le dimanche se <em>décide ici.</em>", "Sept saisons de duels Yahoo sont enfin réunies. Choisissez un manager, mesurez ses rivalités et retrouvez les parcours qui ont mené à chaque titre.", { label: "Duels vérifiés", value: matchupCount, note: "Saisons régulières · 2019—2025" })}
    <section class="section h2h-section"><div class="shell">
      <div class="section-head"><div><p class="eyebrow">Face-à-face all-time</p><h2>Choisis ton rival.</h2></div><p>Résultats de saison régulière uniquement. Les playoffs ont leur propre bilan ci-dessous pour préserver le contexte.</p></div>
      <div class="record-grid h2h-records">
        <article class="record"><span class="record-label">Plus de victoires</span><strong>${escapeHtml(winsLeader.manager)}</strong><span>${winsLeader.wins} victoires · ${winsLeader.games} matchs</span></article>
        <article class="record"><span class="record-label">Meilleur taux</span><strong>${escapeHtml(rateLeader.manager)}</strong><span>${formatPoints(rateLeader.winRate * 100, 1)} % · min. 20 matchs</span></article>
        <article class="record"><span class="record-label">Roi des points</span><strong>${escapeHtml(pointsLeader.manager)}</strong><span>${formatPoints(pointsLeader.pointsFor)} PF cumulés</span></article>
        <article class="record"><span class="record-label">Rivalité la plus jouée</span><strong>${escapeHtml(longestRivalry.managerA)} × ${escapeHtml(longestRivalry.managerB)}</strong><span>${longestRivalry.games} confrontations</span></article>
      </div>

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
      <p class="note"><strong>Source :</strong> 609 matchups Yahoo authentifiés, reliés à 16 managers et réconciliés avec les bilans et points finaux de chaque saison.</p>
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

async function start() {
  const app = document.getElementById("app");
  try {
    const data = await loadHistory();
    if (page === "home") await renderHome(data);
    if (page === "standings") await renderStandings(data);
    if (page === "history") renderHistory(data);
    if (page === "hall-of-fame") renderHallOfFame(data);
    if (page === "matchups") await renderMatchups(data);
  } catch (error) {
    app.innerHTML = `<section class="section"><div class="shell"><div class="state"><strong>Impossible de charger la page</strong>${escapeHtml(error.message)}</div></div></section>`;
  }
}

start();
