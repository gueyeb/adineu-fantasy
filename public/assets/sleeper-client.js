/**
 * Adineu Fantasy — client Sleeper partagé par le navigateur (site.js, teams.js, trade-ui.js,
 * matchups-live.js). Avant, chaque module refaisait ses propres appels (rosters, users, état NFL)
 * avec sa propre convention ; une page qui en combinait deux les chargeait deux fois.
 *
 * - `sleeperGet(path)` : une seule requête par chemin pendant la vie de la page (promesse partagée).
 *   Les échecs ne sont pas mis en cache (un nouvel essai refait la requête).
 * - `{ fresh: true }` : contourne le cache, pour les données live (scores en cours, bouton Actualiser).
 * - `{ optional: true }` : renvoie null au lieu de lever une erreur.
 */
export const SLEEPER_API = "https://api.sleeper.app/v1";
export const SLEEPER_LEAGUE_ID = "1392715510830878721";

const cache = new Map();

export function sleeperGet(path, { fresh = false, optional = false } = {}) {
  if (fresh || !cache.has(path)) {
    const request = fetch(`${SLEEPER_API}${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then(response => {
        if (!response.ok) throw new Error(`Sleeper HTTP ${response.status} (${path})`);
        return response.json();
      });
    request.catch(() => cache.delete(path));
    cache.set(path, request);
  }
  const promise = cache.get(path);
  return optional ? promise.catch(() => null) : promise;
}

/** League, rosters, users and NFL state in one call — shared by every page module. */
export async function getLeagueCore({ leagueId = SLEEPER_LEAGUE_ID } = {}) {
  const [league, rosters, users, state] = await Promise.all([
    sleeperGet(`/league/${leagueId}`),
    sleeperGet(`/league/${leagueId}/rosters`),
    sleeperGet(`/league/${leagueId}/users`),
    sleeperGet("/state/nfl")
  ]);
  return { league, rosters, users, state };
}
