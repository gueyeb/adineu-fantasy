import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest();

export function createCoachAuth({ password = "", now = Date.now, secure = true } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const lifetime = 8 * 60 * 60 * 1000;
  const cookie = (value, age) => `adineu_coach=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const prune = () => {
    for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
    for (const [key, entry] of attempts) if (entry.expires <= now()) attempts.delete(key);
  };
  return {
    enabled: Boolean(password),
    login(value, address) {
      prune();
      if (attempts.size >= 10000 && !attempts.has(address)) return { status: 429 };
      const entry = attempts.get(address) || { count: 0, expires: now() + 15 * 60 * 1000 };
      if (entry.count >= 10) return { status: 429 };
      if (!password || !timingSafeEqual(digest(String(value)), digest(password))) {
        entry.count++;
        if (attempts.size < 10000 || attempts.has(address)) attempts.set(address, entry);
        return { status: 401 };
      }
      if (sessions.size >= 1000) return { status: 429 };
      attempts.delete(address);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, now() + lifetime);
      return { status: 200, cookie: cookie(token, lifetime / 1000) };
    },
    authenticated(header = "") {
      prune();
      const token = header.split(";").map(part => part.trim()).find(part => part.startsWith("adineu_coach="))?.slice(13);
      return Boolean(token && sessions.has(token));
    },
    logout(header = "") {
      const token = header.split(";").map(part => part.trim()).find(part => part.startsWith("adineu_coach="))?.slice(13);
      sessions.delete(token);
      return cookie("", 0);
    }
  };
}
