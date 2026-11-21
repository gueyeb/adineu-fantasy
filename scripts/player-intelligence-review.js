import { createHash } from 'node:crypto';
import { normalizePlayerObservation } from './player-intelligence.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const newsObservationId = row => hash([row.playerId, row.source, row.publishedAt, row.value?.headline]);
const associated = (rows, news) => rows.filter(row => row.kind !== 'NEWS' && row.playerId === news.playerId && row.source === news.source && row.leagueId === news.leagueId && row.season === news.season && row.targetWeek === news.targetWeek);
const revision = rows => hash(rows);
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const inScope = (row, scope) => row.leagueId === scope.leagueId && row.season === scope.season && row.targetWeek === scope.targetWeek;

export function listReviewableNews(state, { scope, selected, index, now }) {
  return state.observations.filter(row => row.kind === 'NEWS' && row.certainty === 'REPORTED' && inScope(row, scope)
    && selected.has(row.playerId) && index.get(row.playerId)?.nflTeam === row.nflTeam && index.get(row.playerId)?.position === row.position
    && Date.parse(row.publishedAt) <= now && Date.parse(row.publishedAt) >= now - 7 * 86400000)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 100).map(row => {
      const facts = associated(state.observations, row);
      return { id: newsObservationId(row), playerName: row.playerName, playerId: row.playerId, position: row.position,
        headline: row.value.headline, source: row.source, publishedAt: row.publishedAt,
        expiresAt: row.expiresAt, canConfirm: Date.parse(row.expiresAt) > now, revision: revision(facts),
        facts: facts.map(fact => ({ kind: fact.kind, value: fact.value, expiresAt: fact.expiresAt, reviewedAt: fact.reviewedAt ?? null,
          revokedAt: fact.revokedAt ?? null, active: !fact.revokedAt && Date.parse(fact.expiresAt) > now })) };
    });
}

/** The operator attests to the fact, not just the existence of an official URL. */
export function reviewPlayerNews(state, input, context) {
  const { scope, index, now } = context;
  if (!input || !['confirm', 'revoke'].includes(input.action) || !['STATUS', 'INJURY', 'RETURN', 'ROLE'].includes(input.kind)) fail('Invalid review action');
  const candidates = listReviewableNews(state, context);
  const candidate = candidates.find(row => row.id === input.observationId);
  if (!candidate) fail('News no longer available for this team/week', 409);
  if (input.expectedRevision !== candidate.revision) fail('Facts changed; reload before reviewing', 409);
  const news = state.observations.find(row => row.kind === 'NEWS' && newsObservationId(row) === candidate.id && inScope(row, scope));
  const old = associated(state.observations, news).find(row => row.kind === input.kind);
  if (input.action === 'revoke') {
    if (!old || old.revokedAt) fail('No active confirmation to withdraw', 409);
    (state.history ??= []).push({ ...old });
    old.revokedAt = new Date(now).toISOString();
    old.revokedBy = 'COACH_OPERATOR';
  } else {
    if (input.verified !== true) fail('Explicit source verification required');
    if (!candidate.canConfirm) fail('News expired; a fresh source is required', 409);
    if (!Number.isInteger(input.validForHours) || input.validForHours < 1 || input.validForHours > 168) fail('Validity must be 1–168 hours');
    // Availability may only be cleared by an explicit RETURN, never a blank status.
    if (input.kind === 'STATUS' && (!['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus'].includes(input.value?.injuryStatus)
      || Object.keys(input.value).length !== 1)) fail('Select an explicit injury status');
    const row = normalizePlayerObservation({ ...scope, playerId: news.playerId, source: news.source, publishedAt: news.publishedAt,
      kind: input.kind, certainty: 'CONFIRMED', value: input.value,
      expiresAt: new Date(now + input.validForHours * 3600000).toISOString()
    }, { ...scope, index, now });
    row.reviewedAt = new Date(now).toISOString();
    row.reviewedBy = 'COACH_OPERATOR';
    row.originNewsId = candidate.id;
    if (old) {
      (state.history ??= []).push({ ...old });
      state.observations[state.observations.indexOf(old)] = row;
    } else state.observations.push(row);
  }
  state.history = (state.history || []).slice(-10000);
  state.updatedAt = new Date(now).toISOString();
  return { changed: true, shouldRecompute: true, action: input.action, playerId: news.playerId, kind: input.kind };
}
