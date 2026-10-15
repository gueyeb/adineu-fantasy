import { buildSosAiContext, formatSosHandoff } from '../public/assets/sos-ai-context.js';
/** Explanatory attachment only: never feed these fields to decision scoring. */
const horizons = ['PAST', 'NEXT_3', 'FANTASY_ROS', 'FANTASY_PLAYOFFS'];
export function buildCoachSos({ context, waivers, bundle, now = Date.now() }) {
  const roster = ['starters', 'bench', 'ir'].flatMap(group => (context.myTeam?.[group] ?? []).map(entry => entry.player ?? entry));
  const candidates = Object.values(waivers?.byPosition ?? {}).flat();
  const stale = bundle && (Date.parse(bundle.asOf) > now || now - Date.parse(bundle.asOf) >= 15 * 60_000
    || bundle.horizons.NFL_ROS.teams.some(team => team.opponents.some(game => Date.parse(game.kickoff) <= now)));
  const available = bundle && !stale;
  const seen = new Set();
  const players = [...roster.map(player => ({ player, scope: 'ROSTER' })), ...candidates.map(player => ({ player, scope: 'WAIVER' }))]
    .filter(({ player }) => player?.position === 'WR').filter(({ player, scope }) => {
      const key = `${scope}:${player.sleeperId}`; if (seen.has(key)) return false; seen.add(key); return true;
    }).map(({ player, scope }) => {
      const team = available ? bundle.horizons.FANTASY_ROS.teams.find(team => team.team === player.nflTeam) : null;
      const sos = team && team.coverageStatus === 'COMPLETE' && team.sosScore !== null ? team : null;
      return { playerId: player.sleeperId, name: player.name, nflTeam: player.nflTeam, scope, sos,
        reason: !bundle ? 'SOS_UNAVAILABLE' : stale ? 'SOS_STALE' : !team ? 'NFL_TEAM_UNAVAILABLE' : !sos ? team.reason || 'SOS_NOT_CLASSIFIABLE' : null,
        signal: sos?.difficulty ? `${sos.difficulty}_WR_ROS_SCHEDULE` : null,
        horizons: available ? Object.fromEntries(horizons.map(h => [h, bundle.horizons[h].teams.find(t => t.team === player.nflTeam) ?? null])) : null };
    });
  return { snapshotId: available ? bundle.snapshotId : null, asOf: available ? bundle.asOf : null,
    reason: !bundle ? 'SOS_UNAVAILABLE' : stale ? 'SOS_STALE' : null, players,
    aiContext: available ? JSON.parse(buildSosAiContext(bundle.horizons.FANTASY_ROS, { format: 'JSON', detail: 'COMPACT', exportedAt: new Date(now).toISOString() })) : null,
    explanation: 'Contexte explicatif WR uniquement. Vérifier rôle, routes, targets, disponibilité et coût de coupe. Aucun signal SOS ne suffit à ADD ou START ; projections et décisions inchangées.' };
}
export function formatCoachSos(sos) {
  if (!sos) return '';
  return '\n\nSOS WR — CONTEXTE EXPLICATIF\n' +
    `Snapshot ${sos.snapshotId ?? 'indisponible'} · ${sos.asOf ?? sos.reason}\n` +
    sos.players.map(row => `${row.scope} ${row.name} (${row.nflTeam ?? '?'}) : ${row.sos ? `Fantasy ROS #${row.sos.rank} · ${row.sos.sosScore} WR PPR concédés/match ajustés · ${row.sos.coveredGames}/${row.sos.gamesInWindow} couverts · prochains ${row.sos.opponents.slice(0, 3).map(g => `S${g.week} ${g.opponent}`).join(', ')} · ${row.signal ?? 'signal indisponible'}` : row.reason}`).join('\n') + '\n' + sos.explanation + (sos.aiContext ? '\n\n' + formatSosHandoff(sos.aiContext) : '');
}
