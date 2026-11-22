/** Fantasy league SOS: actual opponent scores, separate from NFL positional SOS. */
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const numeric = value => typeof value === 'number' && Number.isFinite(value);

export function buildTeamSchedules({ teams, weeks, completedThroughWeek, regularWeekCount }) {
  const ids = teams.map(team => String(team.id));
  const validWeeks = [];
  const gamesByWeek = new Map();
  for (let week = 1; week <= regularWeekCount; week++) {
    const rows = weeks[week] || [];
    const games = new Map();
    for (const row of rows) {
      const peers = row.matchup_id == null ? [] : rows.filter(other => other.matchup_id === row.matchup_id);
      if (peers.length !== 2 || peers[0].roster_id === peers[1].roster_id) continue;
      const opponent = peers.find(other => other.roster_id !== row.roster_id);
      if (!ids.includes(String(opponent.roster_id))) continue;
      games.set(String(row.roster_id), { week, opponentId: String(opponent.roster_id), points: row.points, opponentPoints: opponent.points });
    }
    gamesByWeek.set(week, games);
    if (week <= completedThroughWeek && rows.length === ids.length && ids.every(id => rows.filter(row => String(row.roster_id) === id).length === 1 && games.has(id)) &&
      rows.every(row => numeric(row.points)) && rows.some(row => row.points !== 0)) validWeeks.push(week);
  }
  const averages = new Map(ids.map(id => [id, mean(validWeeks.map(week => gamesByWeek.get(week).get(id).points))]));
  const result = teams.map(team => {
    const id = String(team.id);
    const games = Array.from({ length: regularWeekCount }, (_, i) => {
      const week = i + 1;
      const game = gamesByWeek.get(week).get(id);
      if (!game) return { week, status: 'unavailable' };
      const completed = validWeeks.includes(week);
      return { ...game, status: completed ? 'completed' : week <= completedThroughWeek ? 'unverified' : 'upcoming',
        result: completed ? game.points > game.opponentPoints ? 'V' : game.points < game.opponentPoints ? 'D' : 'N' : null,
        opponentAverage: averages.get(game.opponentId) };
    });
    const past = games.filter(game => game.status === 'completed');
    const future = games.filter(game => game.week > completedThroughWeek);
    const coveredFuture = future.filter(game => numeric(game.opponentAverage));
    return { ...team, id, games, played: past.length, wins: past.filter(g => g.result === 'V').length,
      losses: past.filter(g => g.result === 'D').length, ties: past.filter(g => g.result === 'N').length,
      ppg: averages.get(id), sos: mean(past.map(g => g.opponentPoints)),
      ros: future.length && coveredFuture.length === future.length ? mean(coveredFuture.map(g => g.opponentAverage)) : null,
      remaining: future.length, coveredFuture: coveredFuture.length };
  });
  // Compare with the equally weighted pool of possible opponents, excluding self.
  // Repeated scheduled opponents still count once per meeting in the raw SOS/ROS.
  for (const team of result) {
    const opponents = result.filter(other => other.id !== team.id);
    team.opponentBaseline = opponents.length && opponents.every(other => numeric(other.ppg))
      ? mean(opponents.map(other => other.ppg)) : null;
    for (const field of ['sos', 'ros']) {
      team[`${field}Adjusted`] = numeric(team[field]) && numeric(team.opponentBaseline)
        ? Math.round((team[field] - team.opponentBaseline) * 1e8) / 1e8 : null;
    }
  }
  for (const field of ['sos', 'ros', 'ppg', 'sosAdjusted', 'rosAdjusted']) {
    for (const team of result) team[`${field}Rank`] = numeric(team[field]) ? 1 + result.filter(other => numeric(other[field]) && other[field] > team[field]).length : null;
  }
  return { teams: result, validWeeks, missingWeeks: Array.from({ length: Math.min(completedThroughWeek, regularWeekCount) }, (_, i) => i + 1).filter(w => !validWeeks.includes(w)) };
}

/** Replay the two teams against each other using published scores from the same week. */
export function buildVirtualDuel(a, b) {
  if (!a || !b || String(a.id) === String(b.id)) return null;
  const eligible = game => game.status === 'completed' && !game.isPlayoff && numeric(game.points);
  const weeks = a.games.filter(eligible).flatMap(game => {
    const other = b.games.find(row => row.week === game.week && eligible(row));
    if (!other) return [];
    const pointsA = Math.round(game.points * 100);
    const pointsB = Math.round(other.points * 100);
    return [{ week: game.week, pointsA: pointsA / 100, pointsB: pointsB / 100,
      resultA: pointsA > pointsB ? 'V' : pointsA < pointsB ? 'D' : 'N' }];
  }).sort((x, y) => x.week - y.week);
  const wins = weeks.filter(row => row.resultA === 'V').length;
  const losses = weeks.filter(row => row.resultA === 'D').length;
  const ties = weeks.length - wins - losses;
  return { weeks, recordA: { wins, losses, ties }, recordB: { wins: losses, losses: wins, ties },
    leaderId: wins > losses ? a.id : losses > wins ? b.id : null };
}

export const formatScheduleAdjustment = value => numeric(value) ? `${value > 0 ? '+' : ''}${fmt(value)} pts/match` : '—';
const fmt = value => numeric(value) ? value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
export function scheduleMessage(teams, validWeeks) {
  const lines = ['🏈 *ADINEU · Calendriers & rivalités*', `Semaines validées : ${validWeeks.join(', ') || 'aucune'}`];
  for (const team of teams) lines.push(`\n👕 *${team.name}*`,
    `✅ ${team.wins} victoires · ❌ ${team.losses} défaites · 🤝 ${team.ties} égalités`,
    `🎯 *Attaque* : ${fmt(team.ppg)} pts/match · rang ${team.ppgRank ?? '—'}`,
    `🥊 *SOS subi brut* : ${fmt(team.sos)} pts encaissés/match · rang ${team.sosRank ?? '—'} (1 = plus dur)`,
    `🗓️ *Calendrier restant brut* : ${fmt(team.ros)} pts/match adverses · ${team.coveredFuture}/${team.remaining} affiches couvertes`,
    `⚖️ *Référence hors soi* : ${fmt(team.opponentBaseline)} pts/match`,
    `*SOS ajusté* : ${formatScheduleAdjustment(team.sosAdjusted)} · rang ${team.sosAdjustedRank ?? '—'}`,
    `*ROS ajusté* : ${formatScheduleAdjustment(team.rosAdjusted)} · rang ${team.rosAdjustedRank ?? '—'} (1 = plus dur)`);
  if (teams.length === 2 && teams.every(t => numeric(t.sos))) {
    const [a, b] = teams;
    lines.push(a.sos === b.sos ? '\n⚖️ *Même SOS subi brut.*' : `\n🥵 ${a.sos > b.sos ? a.name : b.name} a encaissé ${fmt(Math.abs(a.sos - b.sos))} pts de plus par match : moyenne brute plus élevée sur ces semaines.`);
  }
  if (teams.length === 2 && teams.every(t => numeric(t.sosAdjusted))) {
    const [a, b] = teams;
    lines.push(a.sosAdjusted === b.sosAdjusted ? '\n⚖️ Même difficulté ajustée.'
      : `\n⚖️ ${a.sosAdjusted > b.sosAdjusted ? a.name : b.name} a le SOS ajusté le plus élevé, après exclusion de soi de la référence.`);
  }
  if (teams.length === 2) {
    const [a, b] = teams;
    const duel = buildVirtualDuel(a, b);
    if (duel) {
      lines.push('\n⚔️ *Duel virtuel · A contre B chaque semaine*');
      if (!duel.weeks.length) lines.push('Aucune semaine commune validée pour le moment.');
      else {
        lines.push(`${a.name} : *${duel.recordA.wins}V–${duel.recordA.losses}D–${duel.recordA.ties}N*`,
          `${b.name} : *${duel.recordB.wins}V–${duel.recordB.losses}D–${duel.recordB.ties}N*`,
          duel.leaderId === null ? '🤝 Duel à égalité !' : `🏆 *${teams.find(t => t.id === duel.leaderId).name} mène le duel !*`,
          `📊 ${duel.weeks.length} semaines comparées · mêmes scores réels, adversaires remplacés virtuellement.`,
          ...duel.weeks.map(row => `S${row.week} : ${fmt(row.pointsA)} — ${fmt(row.pointsB)} · ${row.resultA === 'N' ? '🤝 Égalité' : `✅ ${row.resultA === 'V' ? a.name : b.name}`}`));
      }
      lines.push('Bilan hypothétique, distinct du classement officiel.');
    }
  }
  lines.push('\nℹ️ ROS = moyenne actuelle des points marqués par les futurs adversaires, répétitions incluses. Ajusté = brut moins la moyenne des adversaires possibles, sans soi : positif = plus dur, négatif = plus doux que cette référence. Estimation, pas une prédiction. Saison régulière uniquement. Source : Sleeper.');
  return lines.join('\n');
}
