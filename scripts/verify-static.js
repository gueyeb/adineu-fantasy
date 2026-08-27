import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("public");
const routes = ["", "standings", "matchups", "history", "hall-of-fame"];
const requiredAssets = [
  "assets/styles.css",
  "assets/site.js",
  "data/yahoo-history.json"
];

for (const route of routes) {
  const htmlPath = resolve(root, route, "index.html");
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('src="/assets/site.js"')) throw new Error(`${htmlPath} does not load site.js`);
  if (!html.includes('href="/assets/styles.css"')) throw new Error(`${htmlPath} does not load styles.css`);
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

console.log(`Static site verified: ${routes.length} routes, ${archive.seasons.length} archived seasons.`);
