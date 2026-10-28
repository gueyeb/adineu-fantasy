/** Telegram rejects any text over 4096 characters ("message is too long"). */
export const TELEGRAM_LIMIT = 4096;

/**
 * Keeps whole lines until the limit, then appends a footer saying the rest is on the page.
 * The full text stays available to the caller; nothing is summarized or reworded here.
 */
export function fitTelegramMessage(message, { limit = TELEGRAM_LIMIT, moreAt = null } = {}) {
  const text = String(message ?? '');
  if (text.length <= limit) return { message: text, truncated: false, fullLength: text.length };
  const footer = `\n\n… message tronqué (${text.length} caractères)${moreAt ? ` — détail complet : ${moreAt}` : ''}`;
  const budget = limit - footer.length;
  const kept = [];
  let size = 0;
  for (const line of text.split('\n')) {
    const next = size + line.length + (kept.length ? 1 : 0);
    if (next > budget) break;
    kept.push(line);
    size = next;
  }
  // A single line longer than the budget is cut on a character boundary rather than dropped.
  const body = kept.length ? kept.join('\n') : text.slice(0, budget);
  return { message: body + footer, truncated: true, fullLength: text.length };
}
