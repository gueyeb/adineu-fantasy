/** Reconstruct past difficulty only from authentic pregame weekly archives. */
export function frozenPastSos(current, archives) {
  const result = structuredClone(current.horizons.PAST);
  result.perspective = 'FROZEN_PREGAME';
  result.archiveIds = archives.map(bundle => bundle.snapshotId);
  for (const team of result.teams) {
    for (const game of team.opponents) {
      const eligible = archives.filter(bundle => bundle.season === current.season && bundle.methodologyVersion === current.methodologyVersion
        && Date.parse(bundle.asOf) < Date.parse(game.kickoff)).sort((a, b) => b.asOf.localeCompare(a.asOf));
      let prediction = null;
      for (const bundle of eligible) {
        const source = bundle.horizons.NFL_ROS.teams.find(row => row.team === team.team)?.opponents.find(row => row.gameId === game.gameId && row.opponent === game.opponent);
        if (source?.adjustedDifficulty !== null && source?.adjustedDifficulty !== undefined) { prediction = { ...source, predictionSnapshotId: bundle.snapshotId }; break; }
      }
      Object.assign(game, prediction ? { opponentWrPprAllowed: prediction.opponentWrPprAllowed, opponentWrGames: prediction.opponentWrGames, adjustedDifficulty: prediction.adjustedDifficulty, status: prediction.status, predictionSnapshotId: prediction.predictionSnapshotId } : { opponentWrPprAllowed: null, opponentWrGames: 0, adjustedDifficulty: null, status: 'MISSING_DVP' });
    }
    const covered = team.opponents.filter(game => game.adjustedDifficulty !== null);
    team.coveredGames = covered.length;
    team.coveragePct = team.gamesInWindow ? Number((covered.length / team.gamesInWindow * 100).toFixed(2)) : 100;
    team.coverageStatus = team.scheduleComplete && covered.length === team.gamesInWindow ? 'COMPLETE' : covered.length ? 'PARTIAL' : 'UNAVAILABLE';
    team.sosScore = covered.length ? Number((covered.reduce((sum, game) => sum + game.adjustedDifficulty, 0) / covered.length).toFixed(2)) : null;
    team.rank = null; team.difficulty = null;
    team.reason = !covered.length && team.gamesInWindow ? 'NO_PREGAME_ARCHIVE' : covered.length < team.gamesInWindow ? 'PARTIAL_PREGAME_ARCHIVE' : team.gamesInWindow ? null : team.reason;
  }
  const ranked = result.teams.filter(team => team.coverageStatus === 'COMPLETE' && team.sosScore !== null)
    .sort((a, b) => b.sosScore - a.sosScore || a.team.localeCompare(b.team));
  ranked.forEach((row, index) => { row.rank = index && row.sosScore === ranked[index - 1].sosScore ? ranked[index - 1].rank : index + 1; });
  result.rankedTeams = ranked.length;
  result.teams.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.team.localeCompare(b.team));
  result.warnings = [...result.warnings.filter(w => !w.startsWith('PARTIAL_RANKING')), 'AUTHENTIC_PREGAME_ARCHIVES_ONLY', ...(ranked.length < 32 ? [`PARTIAL_RANKING:${ranked.length}/32`] : [])];
  return result;
}
