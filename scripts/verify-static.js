import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("public");
const routes = ["", "standings", "matchups", "history", "hall-of-fame"];
const requiredAssets = [
  "assets/styles.css",
  "assets/site.js",
  "data/yahoo-history.json",
  "data/yahoo-matchups.json"
];

for (const route of routes) {
  const htmlPath = resolve(root, route, "index.html");
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('src="/assets/site.js?v=3"')) throw new Error(`${htmlPath} does not load the current site.js`);
  if (!html.includes('href="/assets/styles.css?v=3"')) throw new Error(`${htmlPath} does not load the current styles.css`);
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
    claims.add(claim);
  }
}

if (claims.size !== archive.identityCoverage.confirmedParticipations) {
  throw new Error(`Identity coverage mismatch: ${claims.size} confirmed claims`);
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

      const sides = [
        { id: matchup.team1Id, name: normalizeTeamName(matchup.team1Name), score: matchup.team1Score, opponentScore: matchup.team2Score },
        { id: matchup.team2Id, name: normalizeTeamName(matchup.team2Name), score: matchup.team2Score, opponentScore: matchup.team1Score }
      ];

      for (const side of sides) {
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

console.log(`Static site verified: ${routes.length} routes, ${archive.seasons.length} archived seasons, ${verifiedMatchups} Yahoo matchups.`);
