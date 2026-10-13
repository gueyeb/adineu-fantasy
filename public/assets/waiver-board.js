/** Streaming decisions use the target week; ROS market order stays intact for other positions. */
export function selectWaiverBoard(marketRows, { limitPerPosition = 10, position = null } = {}) {
  const byPosition = {};
  for (const row of marketRows) {
    if (position && row.position !== position.toUpperCase()) continue;
    (byPosition[row.position] ??= []).push(row);
  }
  return Object.values(byPosition).flatMap(rows => {
    const streaming = ["QB", "K", "DEF"].includes(rows[0]?.position);
    const ordered = streaming ? [...rows].sort((a, b) =>
      (b.weekProjection ?? -Infinity) - (a.weekProjection ?? -Infinity) ||
      String(a.sleeperId).localeCompare(String(b.sleeperId))) : rows;
    return ordered.filter((row, i) => i < limitPerPosition || row.poolEntry?.pinned);
  });
}
