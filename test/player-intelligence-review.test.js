import test from 'node:test';
import assert from 'node:assert/strict';
import { listReviewableNews, reviewPlayerNews } from '../scripts/player-intelligence-review.js';
import { applyPlayerIntelligence, intelligenceEvidence, mergePlayerObservations } from '../scripts/player-intelligence.js';
import { renderCoachIntelligence, readIntelligenceReview } from '../public/assets/coach-intelligence-view.js';

const now = Date.parse('2026-11-21T12:00:00Z');
const scope = { leagueId: 'L', season: 2026, targetWeek: 11 };
const index = new Map([['p', { name: 'A Player', nflTeam: 'LAR', position: 'WR', injuryStatus: 'Out' }]]);
const context = { scope, index, selected: new Set(['p']), now };
const freshState = () => ({ observations: [{ ...scope, playerId: 'p', playerName: 'A Player', nflTeam: 'LAR', position: 'WR', kind: 'NEWS', certainty: 'REPORTED',
  source: 'https://www.nfl.com/news/report', publishedAt: '2026-11-21T11:00:00.000Z', expiresAt: '2026-11-22T11:00:00.000Z', value: { headline: 'Official update' } }] });
const request = (state, kind = 'INJURY', value = { outThroughWeek: 14 }) => {
  const row = listReviewableNews(state, context)[0];
  return { action: 'confirm', kind, value, observationId: row.id, expectedRevision: row.revision, validForHours: 24, verified: true };
};

test('operator confirmation binds identity/source/publication and feeds the current decision evidence', () => {
  const state = freshState();
  const input = request(state);
  // Caller cannot substitute the source, player or publication date.
  input.source = 'https://evil.example'; input.playerId = 'other'; input.publishedAt = new Date(now).toISOString();
  const result = reviewPlayerNews(state, input, context);
  assert.equal(result.shouldRecompute, true);
  assert.equal(state.observations[0].certainty, 'REPORTED');
  const fact = state.observations[1];
  assert.equal(fact.source, state.observations[0].source);
  assert.equal(fact.publishedAt, state.observations[0].publishedAt);
  assert.equal(fact.playerId, 'p');
  assert.equal(fact.reviewedAt, new Date(now).toISOString());
  assert.equal(intelligenceEvidence(state.observations, { ...scope, now }).eventsById.p.outThroughWeek, 14);
  assert.equal(intelligenceEvidence(state.observations, { ...scope, now: now - 1000 }).eventsById.p, undefined);
});

test('verification, freshness, team/week, identity and optimistic revision are required', () => {
  const state = freshState(), input = request(state);
  assert.throws(() => reviewPlayerNews(state, { ...input, verified: false }, context), /verification/);
  assert.throws(() => reviewPlayerNews(state, { ...input, validForHours: 169 }, context), /Validity/);
  assert.throws(() => reviewPlayerNews(state, { ...input, expectedRevision: 'old' }, context), /changed/);
  assert.throws(() => reviewPlayerNews(state, input, { ...context, selected: new Set() }), /no longer/);
  assert.throws(() => reviewPlayerNews(state, input, { ...context, scope: { ...scope, targetWeek: 12 } }), /no longer/);
  const expired = freshState(); expired.observations[0].expiresAt = new Date(now - 1000).toISOString();
  assert.throws(() => reviewPlayerNews(expired, request(expired), context), /expired/);
  assert.equal(state.observations.length, 1);
});

test('correcting and withdrawing a reviewed fact retain audit history without redating its source', () => {
  const state = freshState();
  reviewPlayerNews(state, request(state), context);
  reviewPlayerNews(state, request(state, 'INJURY', { outThroughWeek: 13 }), { ...context, now: now + 1000 });
  assert.equal(state.history.length, 1);
  const listed = listReviewableNews(state, context)[0];
  reviewPlayerNews(state, { action: 'revoke', kind: 'INJURY', observationId: listed.id, expectedRevision: listed.revision }, { ...context, now: now + 2000 });
  assert.equal(state.history.length, 2);
  assert.equal(intelligenceEvidence(state.observations, { ...scope, now: now + 2000 }).eventsById.p, undefined);
  const revoked = state.observations[1];
  mergePlayerObservations(state, [{ ...revoked, revokedAt: undefined, revokedBy: undefined }], now + 3000);
  assert.ok(state.observations[1].revokedAt);
  assert.equal(state.observations[1].publishedAt, state.observations[0].publishedAt);
});

test('only explicit return clearance can remove an injury status; a role stays scoped', () => {
  const state = freshState();
  assert.throws(() => reviewPlayerNews(state, request(state, 'STATUS', { injuryStatus: null }), context), /explicit injury/);
  reviewPlayerNews(state, request(state, 'RETURN', { clearedForWeek: 11 }), context);
  assert.equal(applyPlayerIntelligence(index, state.observations, { ...scope, now }).get('p').injuryStatus, null);
  reviewPlayerNews(state, request(state, 'ROLE', { announcedRole: 'BACKUP', roleWeeks: 1 }), context);
  assert.equal(intelligenceEvidence(state.observations, { ...scope, now }).rolesById.p.roleConfirmation, 'UNCONFIRMED');
  assert.equal(intelligenceEvidence(state.observations, { ...scope, targetWeek: 12, now }).rolesById.p, undefined);
});

test('review rendering escapes source content and requires an explicit unchecked attestation', () => {
  const state = freshState(); state.observations[0].value.headline = '<script>alert(1)</script>';
  const rows = listReviewableNews(state, context);
  const html = renderCoachIntelligence({ scope, observations: rows });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /name="verified" required/);
  assert.ok(!html.includes('name="verified" required checked'));
  assert.ok(!html.includes('ROLE:STARTING_QB'));
  assert.ok(!renderCoachIntelligence({ scope, observations: [{ ...rows[0], source: 'javascript:alert(1)' }] }).includes('href="javascript:'));
});

test('review form builds only explicit bounded facts and refuses vague windows', () => {
  const base = { action: 'confirm', observationId: 'id', expectedRevision: 'revision', verified: true, validForHours: '24', week: 11 };
  assert.ok(readIntelligenceReview({ ...base, fact: '' }).error);
  assert.ok(readIntelligenceReview({ ...base, fact: 'INJURY:WINDOW', outThroughWeek: '' }).error);
  assert.ok(readIntelligenceReview({ ...base, fact: 'INJURY:WINDOW', outThroughWeek: '10' }).error);
  assert.deepEqual(readIntelligenceReview({ ...base, fact: 'RETURN:CLEARED' }).payload.value, { clearedForWeek: 11 });
  assert.deepEqual(readIntelligenceReview({ ...base, fact: 'ROLE:STARTER', roleWeeks: '2' }).payload.value, { announcedRole: 'STARTER', roleWeeks: 2 });
});
