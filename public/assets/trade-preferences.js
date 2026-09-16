export const PLAYER_STATUSES = { LISTEN: "À l’écoute", KEEP: "Keep · à conserver", SHOP: "Shop · à proposer", UNTOUCHABLE: "Untouchable · exclu" };

export const playerKey = player => String(player.sleeperId || player.name);

export function playerStatus(player, preferences = {}) {
  const status = preferences[playerKey(player)];
  return Object.hasOwn(PLAYER_STATUSES, status) ? status : "LISTEN";
}

export function preferenceAdjustment(players, preferences = {}) {
  if (players.some(player => playerStatus(player, preferences) === "UNTOUCHABLE")) return null;
  return players.reduce((score, player) => score + ({ SHOP: 8, KEEP: -20 }[playerStatus(player, preferences)] || 0), 0);
}
