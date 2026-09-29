/**
 * Adineu Fantasy — Waiver Opportunity Cost (Trade Finder page).
 *
 * Answers the adjacent question to trades: is picking up this free agent worth a FAAB bid, and
 * how much does it actually buy my lineup? Reuses buildProjectedLineup (trade-score.js) unchanged
 * -- adding one candidate to the player pool and re-optimizing the lineup is exactly the same
 * "best lineup from a pool" math already shipped and tested for trades, so a free agent's
 * incremental lineup gain is just (lineup with them added) - (lineup without them). No new model,
 * and never a synthetic bid-acceptance percentage -- see docs/prd-waiver-opportunity-cost.md.
 */
import { buildProjectedLineup } from "./trade-score.js?v=2";

const identity = player => String(player.sleeperId || player.name);

/** Free agent = any candidate player not currently on any of the 12 rosters. */
export function identifyFreeAgents(candidatePlayers = [], rosters = []) {
  const rosteredIds = new Set();
  for (const roster of rosters) {
    for (const id of roster.players || []) rosteredIds.add(String(id));
  }
  return candidatePlayers.filter(player => player.sleeperId && !rosteredIds.has(String(player.sleeperId)));
}

/**
 * Per-candidate incremental lineup gain: your optimal lineup with the free agent added to your
 * pool, minus your current optimal lineup. Capped to the top `cap` candidates by their own direct
 * projection (optionally restricted to `positionsOfInterest` first) so this stays a short,
 * actionable list rather than a scan of every unrostered player -- the cap is applied BEFORE
 * scoring, so a deep candidate outside the cap is never evaluated even if it would have gained.
 * Only candidates that would actually crack the lineup (gain > 0) are returned.
 */
export function findWaiverOpportunities({ myPlayers = [], freeAgents = [], positionsOfInterest = null, cap = 40 }) {
  const myBefore = buildProjectedLineup(myPlayers);

  const projected = freeAgents.filter(player => Number.isFinite(player.projectedPpg)).sort((a, b) => b.projectedPpg - a.projectedPpg);
  // An empty starter slot (e.g. no DEF rostered) is the biggest gain available, but a DEF/K never
  // survives a raw-projection cap: always evaluate the best few candidates for those slots.
  const emptyPositions = new Set(myBefore.emptySlots.map(slot => slot.replace(/\d+$/, "")).filter(pos => pos !== "FLEX"));
  const forEmpty = [...emptyPositions].flatMap(pos => projected.filter(player => (player.position || "").toUpperCase() === pos).slice(0, 5));
  let candidates = projected;
  if (positionsOfInterest && positionsOfInterest.length) {
    const wanted = new Set(positionsOfInterest.map(pos => String(pos).toUpperCase()));
    candidates = candidates.filter(player => wanted.has((player.position || "").toUpperCase()));
  }
  candidates = [...new Set([...forEmpty, ...candidates.slice(0, cap)])];

  return candidates
    .map(freeAgent => {
      const after = buildProjectedLineup([...myPlayers, freeAgent]);
      const gain = Number((after.total - myBefore.total).toFixed(1));
      const takenSlot = after.slots.find(slot => slot.sleeperId === identity(freeAgent));
      return { player: freeAgent, gain, slot: takenSlot ? takenSlot.slot : null };
    })
    .filter(opportunity => opportunity.gain > 0)
    .sort((a, b) => b.gain - a.gain);
}
