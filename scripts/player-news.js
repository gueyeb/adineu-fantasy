import { parse } from 'parse5';
import { createHash } from 'node:crypto';

export const NFL_NEWS_URL = 'https://www.nfl.com/news';
const children = node => node.childNodes || [];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const content = node => node.nodeName === '#text' ? node.value : children(node).map(content).join(' ');
const clean = value => value.replace(/\s+/g, ' ').trim();
const descendants = (node, tag) => children(node).flatMap(child => [ ...(child.tagName === tag ? [child] : []), ...descendants(child, tag) ]);
const nameKey = name => clean(name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' '));
export const newsId = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only explicit dates on official news cards; no inferred status, role or availability. */
export function parseOfficialPlayerNews(html, { now = Date.now() } = {}) {
  const root = parse(html), articles = new Map();
  for (const node of descendants(root, 'a')) {
    let url;
    try { url = new URL(attr(node, 'href'), NFL_NEWS_URL); } catch { continue; }
    if (url.origin !== 'https://www.nfl.com' || url.href.length > 400 || !/^\/news\/[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash) continue;
    const time = descendants(node, 'time')[0];
    const rawDate = time && attr(time, 'datetime');
    if (!rawDate || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate)) continue;
    const published = Date.parse(rawDate);
    if (!Number.isFinite(published) || published > now || published < now - 48 * 3600000) continue;
    const paragraphs = descendants(node, 'p').map(p => clean(content(p))).filter(Boolean);
    if (!paragraphs.length || paragraphs[0].length > 500) continue;
    articles.set(url.href, { source: url.href, headline: paragraphs[0], summary: paragraphs.slice(1).join(' ').slice(0, 1500), publishedAt: new Date(published).toISOString() });
  }
  if (!articles.size) throw Error('No recent dated official NFL news cards available');
  return [...articles.values()].slice(0, 100);
}

export function matchPlayerNews(articles, index, selected) {
  // Full name only, unique across the entire catalogue. No surname or fuzzy matching.
  const names = new Map();
  for (const [id, player] of index) {
    const key = nameKey(player.name || '');
    if (key.split(' ').length < 2 || !['QB', 'RB', 'WR', 'TE', 'K'].includes(player.position)) continue;
    names.set(key, names.has(key) ? null : id);
  }
  const rows = [];
  for (const article of articles) {
    const haystack = ` ${nameKey(`${article.headline} ${article.summary}`)} `;
    for (const [name, playerId] of names) {
      if (playerId && selected.has(playerId) && haystack.includes(` ${name} `)) rows.push({ ...article, playerId });
    }
  }
  return rows.slice(0, 100);
}

export function claimNewsDelivery(state, { scopeKey, now }) {
  const queue = state.playerNewsQueues?.[scopeKey];
  if (!queue) return { notifyNews: false };
  queue.pending = queue.pending.filter(row => Date.parse(row.expiresAt) > now);
  if (!queue.pending.length || queue.delivery && Date.parse(queue.delivery.leaseUntil) > now) return { notifyNews: false };
  const rows = queue.pending.slice(0, 3);
  const deliveryId = newsId([scopeKey, rows.map(row => row.id)]);
  queue.delivery = { id: deliveryId, rowIds: rows.map(row => row.id), leaseUntil: new Date(now + 5 * 60000).toISOString() };
  const message = ['ADINEU — Actualités NFL officielles', 'Informations publiées : aucun changement automatique de statut ou de recommandation.',
    ...rows.map(row => `${row.playerName} — ${row.headline}\nPublié : ${row.publishedAt}\n${row.source}`),
    'Examiner les faits dans le Coach : https://adineu-fantasy.bakene.tech/coach/#coach-intelligence-details'].join('\n\n');
  return { notifyNews: true, deliveryId, message };
}
