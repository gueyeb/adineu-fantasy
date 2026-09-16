/**
 * Adineu Fantasy — Yahoo-era record book (2019-2025).
 *
 * Pure aggregation over the frozen Yahoo archive's regular-season matchup rows and playoff games —
 * no I/O, no live data. Extracted out of site.js in Increment 3 of the team page: /hall-of-fame/
 * was its only consumer until /teams/'s Record Watch panel became a 2nd — same "factor at the
 * threshold of duplication" rule already applied to roster-view.js in Increment 1.
 *
 * Takes playoffSeasons pre-computed (site.js's allYahooPlayoffSeasons(data, playoffArchive)) rather
 * than the raw data/playoffArchive pair, so this module doesn't need to duplicate the Yahoo-history
 * helpers (yahooUrl, normalizeTeamName, managerForHistoryTeam) that stay private to site.js and are
 * used elsewhere there for unrelated rendering.
 */
export function buildYahooRecordBook(matchupArchive, playoffSeasons) {
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

  const playoffGames = playoffSeasons.flatMap(season =>
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
