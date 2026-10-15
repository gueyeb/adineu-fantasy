/** Presentation annotations only. Never change forecasts, ranks or archived inputs. */
export function sosDifficultyFields(team) {
  const ranked = Number.isInteger(team.rank) && team.rank >= 1 && team.rank <= 32;
  return {
    relativeDifficulty: ranked ? team.rank <= 10 ? 'FAVORABLE' : team.rank >= 23 ? 'DIFFICULT' : 'NEUTRAL' : null,
    absoluteDifficulty: team.difficulty ?? null
  };
}

export function buildSosSummary(snapshot, teams = snapshot.teams, trends = []) {
  const previous = trends.filter(row => row.methodologyVersion === snapshot.methodologyVersion
    && (!row.horizon || row.horizon === snapshot.window?.horizon) && Date.parse(row.asOf) < Date.parse(snapshot.asOf))
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0];
  return {
    previousSnapshotId: previous?.snapshotId ?? null,
    previousAsOf: previous?.asOf ?? null,
    rankChangeMeaning: 'Ancien rang moins rang actuel ; positif = calendrier relativement plus favorable. La fenêtre peut avoir changé.',
    top: teams.filter(t => t.rank !== null && t.rank <= 3).map(t => ({ team: t.team, rank: t.rank, sosScore: t.sosScore })),
    bottom: teams.filter(t => t.rank !== null && t.rank >= 30).map(t => ({ team: t.team, rank: t.rank, sosScore: t.sosScore })),
    teams: teams.map(team => {
      const old = previous?.teams.find(row => row.team === team.team);
      const covered = (team.opponents ?? []).filter(game => Number.isFinite(game.adjustedDifficulty));
      const extreme = operation => covered.length ? covered.filter(game => game.adjustedDifficulty === operation(...covered.map(g => g.adjustedDifficulty)))
        .map(game => ({ week: game.week, opponent: game.opponent, adjustedDifficulty: game.adjustedDifficulty })) : [];
      return { team: team.team, rankChange: Number.isInteger(old?.rank) && Number.isInteger(team.rank) ? old.rank - team.rank : null,
        easiestMatchups: extreme(Math.max), hardestMatchups: extreme(Math.min) };
    })
  };
}
