import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("public");
const routes = ["", "standings", "matchups", "history", "hall-of-fame", "franchises"];
const requiredAssets = [
  "assets/styles.css",
  "assets/site.js",
  "data/yahoo-history.json",
  "data/yahoo-matchups.json",
  "data/yahoo-playoffs.json"
];

for (const route of routes) {
  const htmlPath = resolve(root, route, "index.html");
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('src="/assets/site.js?v=6"')) throw new Error(`${htmlPath} does not load the current site.js`);
  if (!html.includes('href="/assets/styles.css?v=6"')) throw new Error(`${htmlPath} does not load the current styles.css`);
}

for (const asset of requiredAssets) await stat(resolve(root, asset));

const archiveText = await readFile(resolve(root, "data/yahoo-history.json"), "utf8");
if (/profileId|platform_user_id|sb_secret_/i.test(archiveText)) {
  throw new Error("Public Yahoo archive contains a private platform identifier or secret");
}
const archive = JSON.parse(archiveText);
const expectedYears = [2025, 2024, 2023, 2022, 2021, 2020, 2019];
const actualYears = archive.seasons.map(season => season.year);

if (JSON.stringify(actualYears) !== JSON.stringify(expectedYears)) {
  throw new Error(`Unexpected archive years: ${actualYears.join(", ")}`);
}

for (const season of archive.seasons) {
  if (season.teams.length !== season.teamCount) {
    throw new Error(`${season.year}: expected ${season.teamCount} teams, found ${season.teams.length}`);
  }
  if (season.teams[0].team !== season.champion.team) {
    throw new Error(`${season.year}: champion does not match final rank 1`);
  }
}

const claims = new Set();
for (const profile of archive.managerHistory) {
  for (const [year, team] of Object.entries(profile.seasons)) {
    const claim = `${year}:${team.replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (claims.has(claim)) throw new Error(`Duplicate manager claim: ${claim}`);
    const season = archive.seasons.find(item => item.year === Number(year));
    if (!season?.teams.some(item => item.team.replace(/\s+/g, " ").trim().toLowerCase()
      === team.replace(/\s+/g, " ").trim().toLowerCase())) {
      throw new Error(`Unresolved franchise claim: ${profile.manager} / ${year} / ${team}`);
    }
    claims.add(claim);
  }
}

if (claims.size !== archive.identityCoverage.confirmedParticipations) {
  throw new Error(`Identity coverage mismatch: ${claims.size} confirmed claims`);
}

const historicalManagers = new Set(archive.managerHistory.map(profile => profile.manager));
if (historicalManagers.size !== 16) {
  throw new Error(`Expected 16 historical franchises, found ${historicalManagers.size}`);
}

const stableYears = [2022, 2023, 2024, 2025];
const stableManagers = stableYears.map(year => archive.managerHistory
  .filter(profile => profile.seasons[String(year)])
  .map(profile => profile.manager)
  .sort()
  .join("|"));

if (new Set(stableManagers).size !== 1 || stableManagers[0].split("|").length !== 12) {
  throw new Error("The verified 2022–2025 manager core is not stable at 12 managers");
}

const matchupsText = await readFile(resolve(root, "data/yahoo-matchups.json"), "utf8");
if (/profileId|platform_user_id|sb_secret_|access_token|refresh_token/i.test(matchupsText)) {
  throw new Error("Public Yahoo matchups contain a private platform identifier or secret");
}

const matchupArchive = JSON.parse(matchupsText);
if (matchupArchive.scope !== "regular_season") {
  throw new Error(`Unexpected Yahoo matchup scope: ${matchupArchive.scope}`);
}

const matchupYears = matchupArchive.seasons.map(season => season.year);
if (JSON.stringify(matchupYears) !== JSON.stringify([...expectedYears].reverse())) {
  throw new Error(`Unexpected Yahoo matchup years: ${matchupYears.join(", ")}`);
}

const normalizeTeamName = value => value.replace(/\s+/g, " ").trim();
let verifiedMatchups = 0;
let regularManagerAppearances = 0;
const regularManagersSeen = new Set();
const regularRecordGames = [];

for (const season of matchupArchive.seasons) {
  const historySeason = archive.seasons.find(candidate => candidate.year === season.year);
  if (!historySeason) throw new Error(`${season.year}: matchup season has no history season`);
  if (season.leagueId !== historySeason.leagueId || season.teamCount !== historySeason.teamCount) {
    throw new Error(`${season.year}: matchup season metadata does not match history`);
  }

  const regularSeasonGames = historySeason.teams[0].wins
    + historySeason.teams[0].losses
    + historySeason.teams[0].ties;
  const expectedWeeksForSeason = Array.from({ length: regularSeasonGames }, (_, index) => index + 1);
  const actualWeeksForSeason = season.weeks.map(week => week.week);
  if (JSON.stringify(actualWeeksForSeason) !== JSON.stringify(expectedWeeksForSeason)) {
    throw new Error(`${season.year}: unexpected matchup weeks ${actualWeeksForSeason.join(", ")}`);
  }

  const totals = new Map();
  const teamIdByName = new Map();

  for (const week of season.weeks) {
    if (week.isPlayoff) throw new Error(`${season.year} week ${week.week}: regular archive marks a playoff`);
    if (!week.sourceUrl.includes(`/${season.year}/f1/${season.leagueId}`)
      || !week.sourceUrl.includes(`matchup_week=${week.week}`)) {
      throw new Error(`${season.year} week ${week.week}: invalid source URL`);
    }
    if (week.matchups.length !== season.teamCount / 2) {
      throw new Error(`${season.year} week ${week.week}: expected ${season.teamCount / 2} matchups`);
    }

    const seenTeamIds = new Set();
    for (const matchup of week.matchups) {
      if (!matchup.team1Manager || !matchup.team2Manager) {
        throw new Error(`${season.year} week ${week.week}: missing manager identity`);
      }
      if (!Number.isFinite(matchup.team1Score) || !Number.isFinite(matchup.team2Score)) {
        throw new Error(`${season.year} week ${week.week}: invalid score`);
      }

      regularRecordGames.push({
        year: season.year,
        week: week.week,
        team1: { manager: matchup.team1Manager, team: matchup.team1Name, points: matchup.team1Score },
        team2: { manager: matchup.team2Manager, team: matchup.team2Name, points: matchup.team2Score }
      });

      const sides = [
        { id: matchup.team1Id, name: normalizeTeamName(matchup.team1Name), manager: matchup.team1Manager, score: matchup.team1Score, opponentScore: matchup.team2Score },
        { id: matchup.team2Id, name: normalizeTeamName(matchup.team2Name), manager: matchup.team2Manager, score: matchup.team2Score, opponentScore: matchup.team1Score }
      ];

      for (const side of sides) {
        if (!historicalManagers.has(side.manager)) {
          throw new Error(`${season.year} week ${week.week}: unknown franchise ${side.manager}`);
        }
        regularManagerAppearances += 1;
        regularManagersSeen.add(side.manager);
        if (seenTeamIds.has(side.id)) {
          throw new Error(`${season.year} week ${week.week}: duplicate team ${side.id}`);
        }
        seenTeamIds.add(side.id);
        if (teamIdByName.has(side.name) && teamIdByName.get(side.name) !== side.id) {
          throw new Error(`${season.year}: team ${side.name} changed Yahoo ID`);
        }
        teamIdByName.set(side.name, side.id);

        const total = totals.get(side.name) || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
        total.pf += side.score;
        total.pa += side.opponentScore;
        if (side.score > side.opponentScore) total.wins += 1;
        else if (side.score < side.opponentScore) total.losses += 1;
        else total.ties += 1;
        totals.set(side.name, total);
      }
    }

    if (seenTeamIds.size !== season.teamCount) {
      throw new Error(`${season.year} week ${week.week}: expected ${season.teamCount} unique teams`);
    }
    verifiedMatchups += week.matchups.length;
  }

  for (const expectedTeam of historySeason.teams) {
    const actual = totals.get(normalizeTeamName(expectedTeam.team));
    if (!actual) throw new Error(`${season.year}: no matchups found for ${expectedTeam.team}`);
    const checks = [
      ["wins", actual.wins, expectedTeam.wins],
      ["losses", actual.losses, expectedTeam.losses],
      ["ties", actual.ties, expectedTeam.ties],
      ["PF", actual.pf, expectedTeam.pf],
      ["PA", actual.pa, expectedTeam.pa]
    ];
    for (const [label, actualValue, expectedValue] of checks) {
      if (Math.abs(actualValue - expectedValue) > 0.001) {
        throw new Error(`${season.year} ${expectedTeam.team}: ${label} ${actualValue} != ${expectedValue}`);
      }
    }
  }
}

if (regularManagerAppearances !== verifiedMatchups * 2) {
  throw new Error(`Expected ${verifiedMatchups * 2} regular franchise appearances, found ${regularManagerAppearances}`);
}
if (regularManagersSeen.size !== historicalManagers.size) {
  throw new Error(`Expected regular-season records for ${historicalManagers.size} franchises, found ${regularManagersSeen.size}`);
}

const maximum = (items, value) => [...items].sort((a, b) => value(b) - value(a))[0];
const minimum = (items, value) => [...items].sort((a, b) => value(a) - value(b))[0];
const regularRecordSides = regularRecordGames.flatMap(game => [
  { ...game.team1, opponent: game.team2, year: game.year, week: game.week },
  { ...game.team2, opponent: game.team1, year: game.year, week: game.week }
]);
const regularWins = regularRecordSides.filter(side => side.points > side.opponent.points);
const regularLosses = regularRecordSides.filter(side => side.points < side.opponent.points);
const highScoreRecord = maximum(regularRecordSides, side => side.points);
const biggestWinRecord = maximum(regularWins, side => side.points - side.opponent.points);
const closestWinRecord = minimum(regularWins, side => side.points - side.opponent.points);
const combinedScoreRecord = maximum(regularRecordGames, game => game.team1.points + game.team2.points);
const highestLossRecord = maximum(regularLosses, side => side.points);

const winningStreaks = [];
for (const manager of historicalManagers) {
  for (const season of matchupArchive.seasons) {
    const games = regularRecordSides.filter(side => side.manager === manager && side.year === season.year)
      .sort((a, b) => a.week - b.week);
    let active = null;
    for (const game of games) {
      if (game.points > game.opponent.points) {
        active ||= { manager, year: season.year, startWeek: game.week, endWeek: game.week, wins: 0 };
        active.wins += 1;
        active.endWeek = game.week;
      } else if (active) {
        winningStreaks.push(active);
        active = null;
      }
    }
    if (active) winningStreaks.push(active);
  }
}
const winningStreakRecord = maximum(winningStreaks, streak => streak.wins);
const approximately = (actual, expected) => Math.abs(actual - expected) < 0.001;
if (winningStreaks.filter(streak => streak.wins >= 7).length !== 7) {
  throw new Error("Expected seven regular-season winning streaks of at least seven games");
}

if (highScoreRecord.manager !== "Mat" || highScoreRecord.year !== 2022
  || highScoreRecord.week !== 8 || !approximately(highScoreRecord.points, 208.98)) {
  throw new Error("Unexpected all-time single-game scoring record");
}
if (biggestWinRecord.manager !== "Mat"
  || !approximately(biggestWinRecord.points - biggestWinRecord.opponent.points, 110.26)) {
  throw new Error("Unexpected all-time victory margin record");
}
if (closestWinRecord.manager !== "Marius"
  || !approximately(closestWinRecord.points - closestWinRecord.opponent.points, 0.04)) {
  throw new Error("Unexpected closest regular-season win record");
}
if (!approximately(combinedScoreRecord.team1.points + combinedScoreRecord.team2.points, 335.44)
  || highestLossRecord.manager !== "Louis François" || !approximately(highestLossRecord.points, 167.06)) {
  throw new Error("Unexpected combined-score or highest-scoring loss record");
}
if (winningStreakRecord.manager !== "Bombeul22" || winningStreakRecord.year !== 2024
  || winningStreakRecord.startWeek !== 5 || winningStreakRecord.endWeek !== 14
  || winningStreakRecord.wins !== 10) {
  throw new Error("Unexpected regular-season winning streak record");
}

const playoffText = await readFile(resolve(root, "data/yahoo-playoffs.json"), "utf8");
if (/profileId|platform_user_id|sb_secret_|access_token|refresh_token/i.test(playoffText)) {
  throw new Error("Public Yahoo playoffs contain a private platform identifier or secret");
}

const playoffArchive = JSON.parse(playoffText);
if (playoffArchive.scope !== "postseason") {
  throw new Error(`Unexpected Yahoo playoff scope: ${playoffArchive.scope}`);
}

const expectedPlayoffYears = [2019, 2020, 2021, 2022, 2023, 2024];
const playoffYears = playoffArchive.seasons.map(season => season.year);
if (JSON.stringify(playoffYears) !== JSON.stringify(expectedPlayoffYears)) {
  throw new Error(`Unexpected Yahoo playoff years: ${playoffYears.join(", ")}`);
}

const expectedRounds = year => year === 2019
  ? { semifinal: 2, final: 1, third_place: 1 }
  : { quarterfinal: 4, semifinal: 2, final: 1, third_place: 1 };
let verifiedPlayoffGames = 0;
const postseasonRecordSides = [];

for (const season of playoffArchive.seasons) {
  const historySeason = archive.seasons.find(candidate => candidate.year === season.year);
  if (!historySeason || season.leagueId !== historySeason.leagueId) {
    throw new Error(`${season.year}: playoff metadata does not match history`);
  }
  if (!season.sourceUrl.includes(`/${season.year}/f1/${season.leagueId}`)
    || !season.sourceUrl.includes("lhst=playoff")) {
    throw new Error(`${season.year}: invalid playoff source URL`);
  }

  const roundCounts = {};
  const teamsByWeek = new Map();
  for (const game of season.games) {
    roundCounts[game.round] = (roundCounts[game.round] || 0) + 1;
    if (!Number.isInteger(game.week) || !game.winner?.manager || !game.loser?.manager) {
      throw new Error(`${season.year}: incomplete playoff identity or week`);
    }
    if (!Number.isFinite(game.winner.points) || !Number.isFinite(game.loser.points)
      || game.winner.points <= game.loser.points) {
      throw new Error(`${season.year} week ${game.week}: invalid playoff score`);
    }
    if (!game.winner.teamId || !game.loser.teamId || game.winner.teamId === game.loser.teamId) {
      throw new Error(`${season.year} week ${game.week}: invalid Yahoo team IDs`);
    }
    postseasonRecordSides.push(
      { manager: game.winner.manager, points: game.winner.points, opponentPoints: game.loser.points, year: season.year, week: game.week, round: game.round },
      { manager: game.loser.manager, points: game.loser.points, opponentPoints: game.winner.points, year: season.year, week: game.week, round: game.round }
    );
    const seen = teamsByWeek.get(game.week) || new Set();
    for (const side of [game.winner, game.loser]) {
      if (!historicalManagers.has(side.manager)) {
        throw new Error(`${season.year} week ${game.week}: unknown playoff franchise ${side.manager}`);
      }
      if (seen.has(side.teamId)) throw new Error(`${season.year} week ${game.week}: duplicate playoff team ${side.teamId}`);
      seen.add(side.teamId);
    }
    teamsByWeek.set(game.week, seen);
    verifiedPlayoffGames += 1;
  }

  if (JSON.stringify(roundCounts) !== JSON.stringify(expectedRounds(season.year))) {
    throw new Error(`${season.year}: unexpected playoff rounds ${JSON.stringify(roundCounts)}`);
  }
  const final = season.games.find(game => game.round === "final");
  const thirdPlace = season.games.find(game => game.round === "third_place");
  if (final.winner.team !== historySeason.champion.team
    || final.winner.manager !== historySeason.champion.manager
    || final.loser.team !== historySeason.runnerUp) {
    throw new Error(`${season.year}: playoff final does not match the verified podium`);
  }
  if (thirdPlace.winner.team !== historySeason.thirdPlace) {
    throw new Error(`${season.year}: third-place game does not match the verified podium`);
  }
}

const season2025 = archive.seasons.find(season => season.year === 2025);
const managerForTeam = (year, teamName) => archive.managerHistory.find(profile =>
  normalizeTeamName(profile.seasons[String(year)] || "").toLowerCase()
    === normalizeTeamName(teamName).toLowerCase())?.manager;
const rounds2025 = { Quarterfinal: 0, Semifinal: 0, Final: 0, "Third place": 0 };

for (const game of archive.playoffs2025) {
  if (!(game.round in rounds2025)) throw new Error(`2025: unexpected playoff round ${game.round}`);
  rounds2025[game.round] += 1;
  for (const team of [game.winner, game.loser]) {
    const manager = managerForTeam(2025, team);
    if (!manager || !historicalManagers.has(manager)) {
      throw new Error(`2025: unresolved playoff franchise for ${team}`);
    }
  }
  postseasonRecordSides.push(
    { manager: managerForTeam(2025, game.winner), points: game.winnerPoints, opponentPoints: game.loserPoints, year: 2025, week: game.week, round: game.round },
    { manager: managerForTeam(2025, game.loser), points: game.loserPoints, opponentPoints: game.winnerPoints, year: 2025, week: game.week, round: game.round }
  );
  if (!Number.isFinite(game.winnerPoints) || !Number.isFinite(game.loserPoints)
    || game.winnerPoints <= game.loserPoints) {
    throw new Error(`2025 ${game.round}: invalid playoff score`);
  }
}

if (JSON.stringify(rounds2025) !== JSON.stringify({ Quarterfinal: 4, Semifinal: 2, Final: 1, "Third place": 1 })) {
  throw new Error(`2025: unexpected playoff rounds ${JSON.stringify(rounds2025)}`);
}
const final2025 = archive.playoffs2025.find(game => game.round === "Final");
const thirdPlace2025 = archive.playoffs2025.find(game => game.round === "Third place");
if (final2025.winner !== season2025.champion.team || final2025.loser !== season2025.runnerUp
  || thirdPlace2025.winner !== season2025.thirdPlace) {
  throw new Error("2025 playoffs do not match the verified podium");
}

const totalPostseasonGames = verifiedPlayoffGames + archive.playoffs2025.length;
if (totalPostseasonGames !== 52 || archive.seasons.filter(season => season.champion.manager).length !== 7) {
  throw new Error(`Unexpected franchise record scope: ${totalPostseasonGames} playoff games`);
}

const postseasonWins = postseasonRecordSides.filter(side => side.points > side.opponentPoints);
const playoffHighRecord = maximum(postseasonRecordSides, side => side.points);
const playoffBiggestWinRecord = maximum(postseasonWins, side => side.points - side.opponentPoints);
const playoffClosestWinRecord = minimum(postseasonWins, side => side.points - side.opponentPoints);
if (playoffHighRecord.manager !== "Bombeul22" || playoffHighRecord.year !== 2024
  || !approximately(playoffHighRecord.points, 186.98)) {
  throw new Error("Unexpected postseason scoring record");
}
if (playoffBiggestWinRecord.manager !== "Louis François"
  || !approximately(playoffBiggestWinRecord.points - playoffBiggestWinRecord.opponentPoints, 87.18)) {
  throw new Error("Unexpected postseason victory margin record");
}
if (playoffClosestWinRecord.manager !== "Mat"
  || !approximately(playoffClosestWinRecord.points - playoffClosestWinRecord.opponentPoints, 0.60)) {
  throw new Error("Unexpected closest postseason win record");
}

console.log(`Static site verified: ${routes.length} routes, ${historicalManagers.size} franchises, ${verifiedMatchups} regular-season and ${totalPostseasonGames} playoff Yahoo matchups.`);
