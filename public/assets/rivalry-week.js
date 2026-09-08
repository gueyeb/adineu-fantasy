export const RIVALRY_WEEK = 8;

export const RIVALRY_CRITERIA = Object.freeze([
  { label: "Fréquence", weight: 40, detail: "Nombre de confrontations depuis 2019" },
  { label: "Équilibre", weight: 30, detail: "Écart entre victoires et défaites" },
  { label: "Forme récente", weight: 15, detail: "Résultats des trois dernières saisons" },
  { label: "Enjeu", weight: 15, detail: "Historique dans le tableau des playoffs" }
]);

export const RIVALRY_PAIRS = Object.freeze([
  { managerA: "Abdoulaye", managerB: "Louis François", title: "Au point près", note: "Dix matchs, seulement quelques points d’écart cumulé." },
  { managerA: "Ado", managerB: "Olivier", title: "Égalité parfaite", note: "Un bilan historique qui refuse de choisir un camp." },
  { managerA: "babttz", managerB: "Tamsir", title: "La revanche", note: "Une série serrée et un bilan de playoffs partagé." },
  { managerA: "Birama", managerB: "Magatte", title: "Le classique", note: "Dix duels et trois rendez-vous à élimination directe." },
  { managerA: "Marius", managerB: "YeezyJr", title: "Cinquante-cinquante", note: "La rivalité la plus indécise de la sélection." },
  { managerA: "Mat", managerB: "Toughness", title: "Le bras de fer", note: "Une affiche fréquente qui reste à portée de bascule." }
]);

export const ACTIVE_MANAGERS_2026 = Object.freeze(
  RIVALRY_PAIRS.flatMap(pair => [pair.managerA, pair.managerB])
);

const SLEEPER_MANAGER_ALIASES = Object.freeze({
  t0z: "babttz",
  flemme: "Tamsir",
  dioguito17: "Olivier",
  bm2222: "Birama",
  bigruisma: "Marius",
  mouzay: "YeezyJr",
  layemasterz: "Abdoulaye",
  sneakyslayermg: "Magatte",
  lfmendes: "Louis François",
  estocade: "Ado",
  saitaamaa22: "Toughness",
  mouhammadat: "Mat"
});

function regularGames(matchupArchive) {
  return matchupArchive.seasons.flatMap(season => season.weeks.flatMap(week =>
    week.matchups.map(matchup => ({
      year: season.year,
      week: week.week,
      sides: [
        { manager: matchup.team1Manager, team: matchup.team1Name, points: matchup.team1Score },
        { manager: matchup.team2Manager, team: matchup.team2Name, points: matchup.team2Score }
      ]
    }))));
}

function isPair(sides, managerA, managerB) {
  const managers = new Set(sides.map(side => side.manager));
  return managers.size === 2 && managers.has(managerA) && managers.has(managerB);
}

function resultFor(points, opponentPoints) {
  if (points > opponentPoints) return "W";
  if (points < opponentPoints) return "L";
  return "T";
}

/**
 * @param {Object} matchupArchive Archive Yahoo (public/data/yahoo-matchups.json)
 * @param {Array<Object>} [playoffGames] Games de playoffs Yahoo/2025, déjà résolus en managers
 * @param {Array<Object>} [liveMeetings] Confrontations Sleeper 2026 déjà jouées, issues de
 *   buildSleeperSeasonMeetings — chaque saison régulière 2026 rejoint le bilan all-time dès
 *   qu'un vrai matchup est publié par Sleeper entre deux managers d'une paire suivie.
 */
export function buildRivalryRecords(matchupArchive, playoffGames = [], liveMeetings = []) {
  const games = regularGames(matchupArchive);

  return RIVALRY_PAIRS.map(pair => {
    const yahooMeetings = games.filter(game => isPair(game.sides, pair.managerA, pair.managerB))
      .map(game => {
        const sideA = game.sides.find(side => side.manager === pair.managerA);
        const sideB = game.sides.find(side => side.manager === pair.managerB);
        return {
          year: game.year,
          week: game.week,
          teamA: sideA.team,
          teamB: sideB.team,
          pointsA: sideA.points,
          pointsB: sideB.points,
          resultA: resultFor(sideA.points, sideB.points)
        };
      });
    const sleeperMeetings = liveMeetings
      .filter(meeting => isPair([{ manager: meeting.managerA }, { manager: meeting.managerB }], pair.managerA, pair.managerB))
      .map(meeting => {
        const pointsA = meeting.managerA === pair.managerA ? meeting.pointsA : meeting.pointsB;
        const pointsB = meeting.managerA === pair.managerA ? meeting.pointsB : meeting.pointsA;
        return {
          year: meeting.year,
          week: meeting.week,
          teamA: pair.managerA,
          teamB: pair.managerB,
          pointsA,
          pointsB,
          resultA: resultFor(pointsA, pointsB)
        };
      });
    const meetings = [...yahooMeetings, ...sleeperMeetings].sort((a, b) => a.year - b.year || a.week - b.week);
    const postseason = playoffGames.filter(game =>
      isPair([game.winner, game.loser], pair.managerA, pair.managerB));
    const winsA = meetings.filter(game => game.resultA === "W").length;
    const winsB = meetings.filter(game => game.resultA === "L").length;
    const ties = meetings.length - winsA - winsB;
    const pointsA = meetings.reduce((sum, game) => sum + game.pointsA, 0);
    const pointsB = meetings.reduce((sum, game) => sum + game.pointsB, 0);
    const latestWinner = [...meetings].reverse().find(game => game.resultA !== "T")?.resultA;
    let streak = 0;

    for (const game of [...meetings].reverse()) {
      if (game.resultA !== latestWinner) break;
      streak += 1;
    }

    return {
      ...pair,
      games: meetings.length,
      winsA,
      winsB,
      ties,
      pointsA,
      pointsB,
      pointDifference: pointsA - pointsB,
      lastFive: meetings.slice(-5),
      streak: latestWinner ? {
        manager: latestWinner === "W" ? pair.managerA : pair.managerB,
        games: streak
      } : null,
      playoffs: {
        games: postseason.length,
        winsA: postseason.filter(game => game.winner.manager === pair.managerA).length,
        winsB: postseason.filter(game => game.winner.manager === pair.managerB).length
      }
    };
  });
}

export function sleeperManager(user) {
  const candidates = [user?.display_name, user?.username]
    .filter(Boolean)
    .map(value => String(value).trim().toLocaleLowerCase("fr"));
  return candidates.map(candidate => SLEEPER_MANAGER_ALIASES[candidate]).find(Boolean) || null;
}

export function buildSleeperWeek(matchupRows, rosters, users) {
  const userById = new Map(users.map(user => [user.user_id, user]));
  const managerByRoster = new Map(rosters.map(roster => [
    Number(roster.roster_id),
    sleeperManager(userById.get(roster.owner_id))
  ]));
  const grouped = new Map();

  for (const row of matchupRows) {
    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const sides = grouped.get(row.matchup_id) || [];
    sides.push(row);
    grouped.set(row.matchup_id, sides);
  }

  return [...grouped.values()].filter(sides => sides.length === 2).map(sides => ({
    managerA: managerByRoster.get(Number(sides[0].roster_id)),
    managerB: managerByRoster.get(Number(sides[1].roster_id)),
    pointsA: Number(sides[0].points) || 0,
    pointsB: Number(sides[1].points) || 0
  })).filter(matchup => matchup.managerA && matchup.managerB);
}

/**
 * Étend buildSleeperWeek à plusieurs semaines déjà jouées, pour nourrir le bilan all-time
 * (Rivalry Tracker 2026) — pas seulement la semaine 8 proposée. Ignore les semaines pas
 * encore jouées (0–0).
 *
 * @param {Array<{week: number, rows: Array<Object>}>} weeksOfRows
 * @param {Array<Object>} rosters
 * @param {Array<Object>} users
 * @param {Object} [options]
 * @param {number} [options.season=2026]
 */
export function buildSleeperSeasonMeetings(weeksOfRows, rosters, users, { season = 2026 } = {}) {
  return weeksOfRows.flatMap(({ week, rows }) =>
    buildSleeperWeek(rows, rosters, users)
      .filter(matchup => matchup.pointsA > 0 || matchup.pointsB > 0)
      .map(matchup => ({ ...matchup, week, year: season }))
  );
}
