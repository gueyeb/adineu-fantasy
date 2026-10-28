import { buildSosAiContext, formatSosHandoff } from '../public/assets/sos-ai-context.js';
/** Explanatory attachment only: never feed these fields to decision scoring. */
const horizons = ['PAST', 'NEXT_3', 'FANTASY_ROS', 'FANTASY_PLAYOFFS'];
function buildPositionCoachSos({ context, waivers, bundle, position = 'WR', now = Date.now() }) {
  const roster = ['starters', 'bench', 'ir'].flatMap(group => (context.myTeam?.[group] ?? []).map(entry => entry.player ?? entry));
  const candidates = Object.values(waivers?.byPosition ?? {}).flat();
  const stale = bundle && (Date.parse(bundle.asOf) > now || now - Date.parse(bundle.asOf) >= 15 * 60_000
    || bundle.horizons.NFL_ROS.teams.some(team => team.opponents.some(game => Date.parse(game.kickoff) <= now)));
  const available = bundle && !stale;
  const seen = new Set();
  const players = [...roster.map(player => ({ player, scope: 'ROSTER' })), ...candidates.map(player => ({ player, scope: 'WAIVER' }))]
    .filter(({ player }) => player?.position === position).filter(({ player, scope }) => {
      const key = `${scope}:${player.sleeperId}`; if (seen.has(key)) return false; seen.add(key); return true;
    }).map(({ player, scope }) => {
      const team = available ? bundle.horizons.FANTASY_ROS.teams.find(team => team.team === player.nflTeam) : null;
      const sos = team && team.coverageStatus === 'COMPLETE' && team.sosScore !== null ? team : null;
      return { playerId: player.sleeperId, position, name: player.name, nflTeam: player.nflTeam, scope, sos,
        reason: !bundle ? 'SOS_UNAVAILABLE' : stale ? 'SOS_STALE' : !team ? 'NFL_TEAM_UNAVAILABLE' : !sos ? team.reason || 'SOS_NOT_CLASSIFIABLE' : null,
        signal: sos?.difficulty ? `${sos.difficulty}_${position}_ROS_SCHEDULE` : null,
        horizons: available ? Object.fromEntries(horizons.map(h => [h, bundle.horizons[h].teams.find(t => t.team === player.nflTeam) ?? null])) : null };
    });
  return { snapshotId: available ? bundle.snapshotId : null, asOf: available ? bundle.asOf : null,
    reason: !bundle ? 'SOS_UNAVAILABLE' : stale ? 'SOS_STALE' : null, players,
    aiContext: available ? JSON.parse(buildSosAiContext(bundle.horizons.FANTASY_ROS, { format: 'JSON', detail: 'COMPACT', exportedAt: new Date(now).toISOString() })) : null,
    explanation: 'Contexte explicatif WR et RB. Vérifier rôle, routes, targets, disponibilité et coût de coupe. Aucun signal SOS ne suffit à ADD ou START ; projections et décisions inchangées.' };
}
export function buildCoachSos({ rbBundle, ...options }) {
  const wr = buildPositionCoachSos({ ...options, bundle: options.bundle?.methodologyVersion === 'WR_TEMPORAL_V1' ? options.bundle : null });
  const rb = buildPositionCoachSos({ ...options, bundle: rbBundle?.methodologyVersion === 'RB_TEMPORAL_V1' ? rbBundle : null, position: 'RB' });
  return { ...wr, snapshotId: wr.snapshotId ?? rb.snapshotId, asOf: wr.asOf ?? rb.asOf, reason: wr.reason && rb.reason ? wr.reason : null, players: [...wr.players, ...rb.players],
    positions: { WR: { snapshotId: wr.snapshotId, asOf: wr.asOf, reason: wr.reason }, RB: { snapshotId: rb.snapshotId, asOf: rb.asOf, reason: rb.reason } }, rbAiContext: rb.aiContext };
}
export function formatCoachSos(sos) {
  if (!sos) return '';
  return '\n\nSOS WR / RB — CONTEXTE EXPLICATIF\n' +
    Object.entries(sos.positions ?? {}).map(([position, capture]) => `${position} snapshot ${capture.snapshotId ?? 'indisponible'} · ${capture.asOf ?? capture.reason}\n`).join('') +
    sos.players.map(row => `${row.scope} ${row.name} ${row.position} (${row.nflTeam ?? '?'}) : ${row.sos ? `Fantasy ROS #${row.sos.rank} · ${row.sos.sosScore} ${row.position} PPR concédés/match ajustés · ${row.sos.coveredGames}/${row.sos.gamesInWindow} couverts · prochains ${row.sos.opponents.slice(0, 3).map(g => `S${g.week} ${g.opponent}`).join(', ')} · ${row.signal ?? 'signal indisponible'}` : row.reason}`).join('\n') + '\n' + sos.explanation + [sos.aiContext, sos.rbAiContext].filter(Boolean).map(value => '\n\n' + formatSosHandoff(value)).join('');
}

/** Chat version: only players whose schedule is not neutral; the full listing stays on the page. */
export function formatCoachSosBrief(sos) {
  if (!sos) return '';
  const notable = sos.players.filter(row => row.scope === 'ROSTER' && row.sos?.difficulty && row.sos.difficulty !== 'NEUTRAL');
  const unavailable = Object.entries(sos.positions ?? {}).filter(([, capture]) => !capture.snapshotId).map(([position]) => position);
  return '\n\nSOS WR / RB (explicatif, sans effet sur les décisions)\n' +
    (notable.length ? notable.map(row => `• ${row.name} ${row.position} (${row.nflTeam ?? '?'}) : ${row.sos.difficulty === 'FAVORABLE' ? 'calendrier favorable' : 'calendrier difficile'} · Fantasy ROS #${row.sos.rank}`).join('\n')
      : '• Aucun calendrier marqué favorable ou difficile parmi tes WR/RB.') +
    (unavailable.length ? `\nSOS indisponible : ${unavailable.join(', ')}.` : '');
}
