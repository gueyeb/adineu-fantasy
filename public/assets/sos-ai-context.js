import { sosDifficultyFields, buildSosSummary } from './sos-insights.js?v=c553d8c0f3';

/** Pure export of captured SOS data. Never fetches or recalculates rankings. */
export function buildSosAiContext(snapshot, options = {}) {
  if (!snapshot?.snapshotId || !Array.isArray(snapshot.teams)) throw Error('Snapshot SOS indisponible.');
  const position = snapshot.methodologyVersion === 'RB_TEMPORAL_V1' ? 'RB' : 'WR';
  const { scope = 'ALL', team = '', detail = 'FULL', format = 'MARKDOWN', comparisons = [], filters = {}, trends = [], modelFeedback = null, exportedAt = new Date().toISOString() } = options;
  if (!['ALL', 'SELECTED', 'EXTREMES'].includes(scope) || !['FULL', 'COMPACT'].includes(detail) || !['MARKDOWN', 'JSON'].includes(format)) throw Error('Options SOS invalides.');
  if (scope === 'SELECTED' && !snapshot.teams.some(row => row.team === team)) throw Error('Sélectionnez une équipe.');
  if (comparisons.some(row => row.methodologyVersion !== snapshot.methodologyVersion || row.snapshotId !== snapshot.snapshotId || row.asOf !== snapshot.asOf)) throw Error('Les horizons doivent partager le même snapshot.');
  const select = rows => rows.filter(row => scope === 'ALL' || (scope === 'SELECTED' ? row.team === team : row.rank !== null && (row.rank <= 10 || row.rank >= 23)));
  const project = row => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => detail === 'FULL' || !['opponents', 'byeWeeks'].includes(key))), ...sosDifficultyFields(row) });
  const capture = row => ({ snapshotId: row.snapshotId, asOf: row.asOf, season: row.season, window: row.window, perspective: row.perspective ?? row.window?.viewMode,
    position, methodologyVersion: row.methodologyVersion, shrinkGames: row.shrinkGames, leagueAverage: row.leagueAverage, sources: row.sources,
    rankedTeams: row.rankedTeams, warnings: row.warnings, teams: select(row.teams).map(project),
    summary: row.summary ?? buildSosSummary(row, select(row.teams), row === snapshot ? trends : []) });
  const rules = [
    'Rang 1 = calendrier le plus favorable ; rangs officiels conservés après filtrage.',
    'Difficulté relative : rangs 1–10 favorables, 11–22 intermédiaires, 23–32 difficiles. Égalités conservées ; aucun rang inventé.',
    `Score = ${position} PPR concédés par match, ajustés ; tous les ${position} adverses, pas une projection individuelle.`,
    'Difficulté absolue : favorable à +12 % de la moyenne NFL, difficile à −12 %, neutre entre les deux. Un rang extrême peut donc rester neutre.',
    'Couverture = disponibilité des données, jamais précision prédictive. Les mesures MODEL_FEEDBACK sont descriptives, pas une garantie.',
    'PAST courant est rétrospectif ; seules les archives pré-match permettent une évaluation prédictive.',
    'Vérifier rôle, routes, targets, disponibilité et coût de coupe. Aucun ADD ou START sur le seul SOS ; projections et décisions inchangées.',
    'Distinguer faits, scores SOS, fiabilité et implications fantasy. Ne pas inventer de données hebdomadaires ou de joueurs absentes.'
  ];
  const selected = capture(snapshot);
  let feedback = { status: 'UNAVAILABLE', reason: 'Aucune évaluation archivée chargée ; aucune fiabilité déduite de la couverture.' };
  if (modelFeedback?.snapshotId) {
    const forecast = modelFeedback.forecast ?? (modelFeedback.snapshotId === snapshot.snapshotId ? snapshot : null);
    if (!forecast || forecast.methodologyVersion !== snapshot.methodologyVersion || forecast.snapshotId !== modelFeedback.snapshotId || !forecast.asOf) throw Error('Provenance de l’évaluation SOS incohérente.');
    const selectedTeams = new Set(selected.teams.map(row => row.team));
    feedback = { ...modelFeedback, status: modelFeedback.sample > 0 ? 'AVAILABLE' : 'PENDING', metricScope: 'ALL_MATCHUPS_IN_FORECAST',
      forecast: { snapshotId: forecast.snapshotId, asOf: forecast.asOf, methodologyVersion: forecast.methodologyVersion, window: forecast.window, sources: forecast.sources },
      rows: detail === 'FULL' ? (modelFeedback.rows ?? []).filter(row => selectedTeams.has(row.offensiveTeam)) : undefined };
  }
  const data = { schema: 'adineu.sos.v1', position, scoring: 'FULL_PPR', exportedAt, scope, team, detail, filters,
    source: 'https://adineu-fantasy.bakene.tech/sos/', snapshot: selected, comparisons: comparisons.map(capture), modelFeedback: feedback, interpretationRules: rules };
  if (format === 'JSON') return JSON.stringify(data, null, 2);
  const safe = value => String(value ?? '—').replace(/[\r\n|]/g, ' ');
  const num = value => Number.isFinite(value) ? value.toFixed(2) : '—';
  const matchupText = rows => rows.map(g => `S${g.week} ${g.opponent} (${num(g.adjustedDifficulty)})`).join(', ') || 'indisponible';
  const sections = [data.snapshot, ...data.comparisons].map(row => [
    `## ${safe(row.window?.horizon)} · S${row.window?.startWeek}–S${row.window?.endWeek}`,
    `Snapshot: ${row.snapshotId}\nCalcul: ${row.asOf}\nPerspective: ${safe(row.perspective)}\nClassement: ${row.rankedTeams}/32 équipes classées`,
    `Méthode: ${row.methodologyVersion} · k=${row.shrinkGames} · moyenne NFL=${num(row.leagueAverage)}`,
    `Sources datées: ${JSON.stringify(row.sources)}`,
    '### Résumé IA',
    `Top (rangs 1–3, dans la sélection) : ${row.summary.top.map(t => `${t.team} #${t.rank} ${num(t.sosScore)}`).join('; ') || 'indisponible'}`,
    `Bottom (rangs 30–32, dans la sélection) : ${row.summary.bottom.map(t => `${t.team} #${t.rank} ${num(t.sosScore)}`).join('; ') || 'indisponible'}`,
    `Comparaison de rang : ${row.summary.previousSnapshotId ?? 'aucune archive antérieure comparable'}${row.summary.previousAsOf ? ` · ${row.summary.previousAsOf}` : ''}. ${row.summary.rankChangeMeaning}`,
    ...row.summary.teams.map(t => `- ${t.team} : variation de rang ${t.rankChange ?? '—'} ; matchs les plus favorables de l’horizon : ${matchupText(t.easiestMatchups)} ; les plus difficiles : ${matchupText(t.hardestMatchups)}`),
    `| Rang | Équipe | ${position} PPR ajustés | Couverture | Relative | Absolue | Motif |`, '| --- | --- | --- | --- | --- | --- | --- |',
    ...row.teams.map(t => `| ${t.rank ?? '—'} | ${safe(t.team)} | ${num(t.sosScore)} | ${t.coveredGames}/${t.gamesInWindow} · ${t.coverageStatus} | ${t.relativeDifficulty ?? '—'} | ${t.absoluteDifficulty ?? '—'} | ${safe(t.reason)} |`),
    ...(detail === 'FULL' ? row.teams.map(t => `### ${t.team} — adversaires\n${(t.opponents ?? []).map(g => `- S${g.week} ${g.opponent} · ${g.kickoff} · DvP brut ${num(g[position === 'RB' ? 'opponentRbPprAllowed' : 'opponentWrPprAllowed'])} (${g[position === 'RB' ? 'opponentRbGames' : 'opponentWrGames']} matchs) · ajusté ${num(g.adjustedDifficulty)} · ${g.status} · match ${g.gameId}${g.predictionSnapshotId ? ` · archive ${g.predictionSnapshotId}` : ''}`).join('\n')}\nByes hors moyenne: ${(t.byeWeeks ?? []).join(', ') || 'aucun'}`) : []),
    `Avertissements: ${(row.warnings ?? []).join('; ') || 'aucun'}`
  ].join('\n'));
  const feedbackLines = feedback.status === 'UNAVAILABLE' ? [feedback.reason] : [
    `Statut: ${feedback.status} · ${feedback.reliability}\nPrévision: ${feedback.snapshotId} · ${feedback.forecast.asOf}\nRésultats évalués au: ${feedback.evaluatedAt}`,
    `Sources des observations: ${JSON.stringify(feedback.observationSources ?? null)}`,
    `Métriques globales de cette prévision (non recalculées sur la sélection): ${feedback.sample}/${feedback.total} observations · couverture évaluation ${num(feedback.coveragePct)} %`,
    `MAE: ${num(feedback.mae)} · Spearman: ${num(feedback.spearman)} · exactitude des classes: ${num(Number.isFinite(feedback.classificationAccuracy) ? feedback.classificationAccuracy * 100 : null)} %`,
    `Exclusions: ${JSON.stringify(feedback.exclusions)}`,
    ...(feedback.rows ?? []).filter(r => !r.reason).map(r => `- ${r.gameId} · S${r.targetWeek} ${r.offensiveTeam}/${r.defense} · prévu ${num(r.predictedAllowedPpr)} · observé ${num(r.actualAllowedPpr)} · erreur ${num(r.absoluteError)}${r.reason ? ` · ${r.reason}` : ''}`),
    'Échantillon insuffisant ou mesures descriptives : ne pas conclure à un pouvoir prédictif démontré. Ne pas additionner les mêmes matchs entre snapshots.'
  ];
  return ['# ADINEU FANTASY — SOS CONTEXT', `Schema: adineu.sos.v1\nPosition: ${position}\nScoring: Full PPR`, `Consultation / export: ${exportedAt}\nSource: ${data.source}\nSélection: ${scope} · ${detail}\nFiltres affichés: ${JSON.stringify(filters)} (sans recalcul des rangs ni scores)`, ...sections, '## MODEL_FEEDBACK', ...feedbackLines, '## Règles d’interprétation', rules.map(rule => `- ${rule}`).join('\n')].join('\n\n');
}
/** WR and RB exports side by side. Each keeps its own methodology, snapshot and ranks; nothing is merged. */
export function combineSosAiContexts(parts, format = 'MARKDOWN') {
  const ordered = [...parts].sort((a, b) => ['WR', 'RB'].indexOf(a.position) - ['WR', 'RB'].indexOf(b.position));
  if (format === 'JSON') return JSON.stringify({ schema: 'adineu.sos.combined.v1', positions: ordered.map(part => part.position),
    reports: Object.fromEntries(ordered.map(part => [part.position, JSON.parse(part.text)])) }, null, 2);
  return [`# ADINEU FANTASY — SOS COMBINÉ (${ordered.map(part => part.position).join(' + ')})\n\nRapports indépendants par position : méthodologie, snapshot et rangs propres à chacune. Ne pas comparer un score WR à un score RB ; croiser les deux seulement par équipe (ex. calendrier favorable aux RB, difficile aux WR).`,
    ...ordered.map(part => part.text.replace(/^(#+) /gm, '#$1 '))].join('\n\n---\n\n');
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
