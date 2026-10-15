/** Pure export of captured SOS data. Never fetches or recalculates rankings. */
export function buildSosAiContext(snapshot, options = {}) {
  if (!snapshot?.snapshotId || !Array.isArray(snapshot.teams)) throw Error('Snapshot SOS indisponible.');
  const { scope = 'ALL', team = '', detail = 'FULL', format = 'MARKDOWN', comparisons = [], filters = {}, exportedAt = new Date().toISOString() } = options;
  if (!['ALL', 'SELECTED', 'EXTREMES'].includes(scope) || !['FULL', 'COMPACT'].includes(detail) || !['MARKDOWN', 'JSON'].includes(format)) throw Error('Options SOS invalides.');
  if (scope === 'SELECTED' && !snapshot.teams.some(row => row.team === team)) throw Error('Sélectionnez une équipe.');
  if (comparisons.some(row => row.snapshotId !== snapshot.snapshotId || row.asOf !== snapshot.asOf)) throw Error('Les horizons doivent partager le même snapshot.');
  const select = rows => rows.filter(row => scope === 'ALL' || (scope === 'SELECTED' ? row.team === team : row.rank !== null && (row.rank <= 10 || row.rank >= 23)));
  const project = row => detail === 'FULL' ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !['opponents', 'byeWeeks'].includes(key)));
  const capture = row => ({ snapshotId: row.snapshotId, asOf: row.asOf, season: row.season, window: row.window, perspective: row.perspective ?? row.window?.viewMode,
    methodologyVersion: row.methodologyVersion, shrinkGames: row.shrinkGames, leagueAverage: row.leagueAverage, sources: row.sources,
    rankedTeams: row.rankedTeams, warnings: row.warnings, teams: select(row.teams).map(project) });
  const rules = [
    'Rang 1 = calendrier le plus favorable ; rangs officiels conservés après filtrage.',
    'Score = WR PPR concédés par match, ajustés ; tous les WR adverses, pas une projection individuelle.',
    'Difficulté absolue : favorable à +12 % de la moyenne NFL, difficile à −12 %, neutre entre les deux. Un rang extrême peut donc rester neutre.',
    'Couverture = disponibilité des données, jamais précision prédictive. Fiabilité non fournie dans cet export.',
    'PAST courant est rétrospectif ; seules les archives pré-match permettent une évaluation prédictive.',
    'Vérifier rôle, routes, targets, disponibilité et coût de coupe. Aucun ADD ou START sur le seul SOS ; projections et décisions inchangées.',
    'Distinguer faits, scores SOS, fiabilité et implications fantasy. Ne pas inventer de données hebdomadaires ou de joueurs absentes.'
  ];
  const data = { schema: 'adineu.sos.v1', position: 'WR', scoring: 'FULL_PPR', exportedAt, scope, team, detail, filters,
    source: 'https://adineu-fantasy.bakene.tech/sos/', snapshot: capture(snapshot), comparisons: comparisons.map(capture), interpretationRules: rules };
  if (format === 'JSON') return JSON.stringify(data, null, 2);
  const safe = value => String(value ?? '—').replace(/[\r\n|]/g, ' ');
  const sections = [data.snapshot, ...data.comparisons].map(row => [
    `## ${safe(row.window?.horizon)} · S${row.window?.startWeek}–S${row.window?.endWeek}`,
    `Snapshot: ${row.snapshotId}\nCalcul: ${row.asOf}\nPerspective: ${safe(row.perspective)}\nClassement: ${row.rankedTeams}/32 équipes classées`,
    `Méthode: ${row.methodologyVersion} · k=${row.shrinkGames} · moyenne NFL=${row.leagueAverage}`,
    `Sources datées: ${JSON.stringify(row.sources)}`,
    '| Rang | Équipe | WR PPR ajustés | Couverture | Difficulté | Motif |', '| --- | --- | --- | --- | --- | --- |',
    ...row.teams.map(t => `| ${t.rank ?? '—'} | ${safe(t.team)} | ${t.sosScore ?? '—'} | ${t.coveredGames}/${t.gamesInWindow} · ${t.coverageStatus} | ${t.difficulty ?? '—'} | ${safe(t.reason)} |`),
    ...(detail === 'FULL' ? row.teams.map(t => `### ${t.team} — adversaires\n${(t.opponents ?? []).map(g => `- S${g.week} ${g.opponent} · ${g.kickoff} · DvP brut ${g.opponentWrPprAllowed ?? '—'} (${g.opponentWrGames} matchs) · ajusté ${g.adjustedDifficulty ?? '—'} · ${g.status} · match ${g.gameId}${g.predictionSnapshotId ? ` · archive ${g.predictionSnapshotId}` : ''}`).join('\n')}\nByes hors moyenne: ${(t.byeWeeks ?? []).join(', ') || 'aucun'}`) : []),
    `Avertissements: ${(row.warnings ?? []).join('; ') || 'aucun'}`
  ].join('\n'));
  return ['# ADINEU FANTASY — SOS CONTEXT', 'Schema: adineu.sos.v1\nPosition: WR\nScoring: Full PPR', `Consultation / export: ${exportedAt}\nSource: ${data.source}\nSélection: ${scope} · ${detail}\nFiltres affichés: ${JSON.stringify(filters)} (sans recalcul des rangs ni scores)`, ...sections, '## Règles d’interprétation', ...rules.map(rule => `- ${rule}`)].join('\n\n');
}

export const SOS_HANDOFF_KEY = 'adineu:sos-ai-context:v1';
export function readSosHandoff(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(SOS_HANDOFF_KEY);
    if (!raw || raw.length > 2_000_000) return null;
    const value = JSON.parse(raw);
    if (value.schema !== 'adineu.sos.v1' || !value.snapshot?.snapshotId || !Array.isArray(value.snapshot.teams) || !Number.isFinite(Date.parse(value.exportedAt)) || now - Date.parse(value.exportedAt) > 3_600_000 || Date.parse(value.exportedAt) > now) return null;
    formatSosHandoff(value); // Reject malformed payloads before the private Coach renders.
    return value;
  } catch { return null; }
}
export function formatSosHandoff(value) {
  return buildSosAiContext(value.snapshot, { ...value, format: 'MARKDOWN', comparisons: value.comparisons });
}
