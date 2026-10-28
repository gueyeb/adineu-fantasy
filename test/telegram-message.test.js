import test from "node:test";
import assert from "node:assert/strict";
import { fitTelegramMessage, TELEGRAM_LIMIT } from "../scripts/telegram-message.js";
import { formatCoachSosBrief } from "../scripts/sos-coach.js";

test("a short message is sent unchanged", () => {
  assert.deepEqual(fitTelegramMessage("ligne 1\nligne 2"), { message: "ligne 1\nligne 2", truncated: false, fullLength: 15 });
});

test("a long message keeps whole lines, stays under Telegram's limit and says where the rest is", () => {
  const text = Array.from({ length: 600 }, (_, i) => `• ligne ${i} — ${"x".repeat(30)}`).join("\n");
  const { message, truncated, fullLength } = fitTelegramMessage(text, { moreAt: "https://example.test/coach/" });
  assert.equal(truncated, true);
  assert.equal(fullLength, text.length);
  assert.ok(message.length <= TELEGRAM_LIMIT);
  const body = message.split("\n\n… message tronqué")[0];
  assert.ok(text.startsWith(body) && text[body.length] === "\n", "cut on a line boundary");
  assert.match(message, /tronqué \(\d+ caractères\) — détail complet : https:\/\/example\.test\/coach\/$/);
});

test("a single oversized line is cut by characters instead of dropped", () => {
  const { message } = fitTelegramMessage("y".repeat(5000));
  assert.ok(message.length <= TELEGRAM_LIMIT);
  assert.match(message, /^y+\n\n… message tronqué/);
});

test("the chat SOS section lists only non-neutral roster schedules", () => {
  const row = (name, scope, difficulty) => ({ name, scope, position: "WR", nflTeam: "BUF", sos: difficulty ? { difficulty, rank: 3 } : null });
  const sos = { positions: { WR: { snapshotId: "a" }, RB: { snapshotId: null } },
    players: [row("Facile", "ROSTER", "FAVORABLE"), row("Neutre", "ROSTER", "NEUTRAL"), row("Waiver", "WAIVER", "DIFFICULT"), row("Inconnu", "ROSTER", null)] };
  const text = formatCoachSosBrief(sos);
  assert.match(text, /Facile WR \(BUF\) : calendrier favorable/);
  assert.doesNotMatch(text, /Neutre|Waiver|Inconnu/);
  assert.match(text, /SOS indisponible : RB\./);
  assert.match(formatCoachSosBrief({ positions: {}, players: [] }), /Aucun calendrier marqué/);
  assert.equal(formatCoachSosBrief(null), "");
});
