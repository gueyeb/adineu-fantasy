const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const rank = xs => xs.map(x => 1 + xs.filter(v => v < x).length + (xs.filter(v => v === x).length - 1) / 2);
export function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const a = rank(xs), b = rank(ys), ma = mean(a), mb = mean(b);
  const numerator = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const denominator = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return denominator ? numerator / denominator : null;
}
const category = (x, mu) => mu > 0 ? x / mu >= 1.12 ? 'FAVORABLE' : x / mu <= 0.88 ? 'DIFFICULT' : 'NEUTRAL' : null;
export function evaluateSos(bundle, observations, evaluatedAt) {
  observations = observations.filter(row => !row.position || row.position === (bundle.methodologyVersion === 'RB_TEMPORAL_V1' ? 'RB' : 'WR'));
  const forecast = bundle.horizons.NFL_ROS;
  const actuals = new Map(observations.map(row => [`${row.gameId}|${row.defense}`, row]));
  const rows = []; const exclusions = {};
  for (const team of forecast.teams) for (const game of team.opponents) {
    const observed = actuals.get(`${game.gameId}|${game.opponent}`);
    let reason = null;
    if (!(Date.parse(bundle.asOf) < Date.parse(observed?.kickoff ?? game.kickoff))) reason = 'LATE_SNAPSHOT';
    else if (game.adjustedDifficulty === null) reason = 'MISSING_PREDICTION';
    else if (!observed || !Number.isFinite(observed.actualAllowedPpr) || Date.parse(observed.kickoff) >= Date.parse(evaluatedAt)) reason = 'MISSING_RESULT';
    if (reason) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    rows.push({ snapshotId: bundle.snapshotId, gameId: game.gameId, targetWeek: game.week, defense: game.opponent, offensiveTeam: team.team,
      predictedAllowedPpr: game.adjustedDifficulty, actualAllowedPpr: reason ? null : observed.actualAllowedPpr,
      absoluteError: reason ? null : Math.abs(game.adjustedDifficulty - observed.actualAllowedPpr), reason });
  }
  const pairs = rows.filter(row => !row.reason);
  const confusion = {};
  for (const row of pairs) {
    const key = `${category(row.predictedAllowedPpr, forecast.leagueAverage)}:${category(row.actualAllowedPpr, forecast.leagueAverage)}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
  }
  const result = { snapshotId: bundle.snapshotId, methodologyVersion: bundle.methodologyVersion, position: bundle.methodologyVersion === 'RB_TEMPORAL_V1' ? 'RB' : 'WR', evaluatedAt, sample: pairs.length, total: rows.length,
    coveragePct: rows.length ? pairs.length / rows.length * 100 : 0, exclusions,
    mae: mean(pairs.map(row => row.absoluteError)),
    // Naive baseline: every defense allows the league average. skill > 0 means the forecast beats it.
    baselineMae: forecast.leagueAverage > 0 ? mean(pairs.map(row => Math.abs(forecast.leagueAverage - row.actualAllowedPpr))) : null,
    spearman: spearman(pairs.map(r => r.predictedAllowedPpr), pairs.map(r => r.actualAllowedPpr)),
    classificationAccuracy: forecast.leagueAverage > 0 ? mean(pairs.map(row => Number(category(row.predictedAllowedPpr, forecast.leagueAverage) === category(row.actualAllowedPpr, forecast.leagueAverage)))) : null,
    confusion, reliability: pairs.length < 30 ? 'INSUFFICIENT_SAMPLE' : 'DESCRIPTIVE_ONLY', rows };
  result.skill = result.mae !== null && result.baselineMae > 0 ? 1 - result.mae / result.baselineMae : null;
  return result;
}
