/**
 * Adineu Fantasy — display identity: confirmed canonical manager, platform account, team name.
 *
 * Pure and display-only. Keys used elsewhere (Supabase owner names, Sleeper team names used to map
 * playoff odds) are never rewritten here. Only confirmed aliases resolve a manager: an unknown
 * account stays an account, never promoted from a nickname. A team name equal to the account is the
 * sync fallback, not a team name chosen by the manager.
 */

/** Confirmed Sleeper accounts (display_name/username, lower-case) → canonical archive manager. */
export const SLEEPER_MANAGER_ALIASES = Object.freeze({
  t0z: "babttz",
  flemme: "Tamsir",
  dioguito17: "Olivier",
  bm2222: "Birama",
  bmb22: "Birama",
  bigruisma: "Marius",
  mouzay: "YeezyJr",
  layemasterz: "Abdoulaye",
  sneakyslayermg: "Magatte",
  lfmendes: "Louis François",
  estocade: "Ado",
  saitaamaa22: "Toughness",
  mouhammadat: "Mat",
  shiro00: "Mat"
});

const fold = value => String(value ?? "").trim().toLocaleLowerCase("fr");
const CANONICAL_BY_FOLDED = new Map(Object.values(SLEEPER_MANAGER_ALIASES).map(name => [fold(name), name]));

/** Confirmed alias or an already-canonical name; null otherwise. */
export function canonicalManagerName(name) {
  const key = fold(name);
  if (!key) return null;
  return SLEEPER_MANAGER_ALIASES[key] ?? CANONICAL_BY_FOLDED.get(key) ?? null;
}

/**
 * account: platform name as stored or read (Supabase owner, Sleeper display_name).
 * accountIsCurrent: true only when read from live Sleeper users, so the label never calls a stored
 * name the current account.
 */
export function describeIdentity({ account = null, teamName = null, accountIsCurrent = false } = {}) {
  const manager = canonicalManagerName(account);
  const publicTeam = teamName && fold(teamName) !== fold(account) && fold(teamName) !== fold(manager) ? teamName : null;
  return { manager, account: account || null, accountIsCurrent, teamName: publicTeam };
}

export function managerLabel(identity) {
  return identity.manager ?? (identity.account ? `@${identity.account}` : "Manager inconnu");
}

/** No public team name: Sleeper's own default, "Team <account>", so the label matches the app. */
export function teamLabel(identity) {
  return identity.teamName ?? (identity.account ? `Team ${identity.account}` : "Équipe sans nom public");
}

/** Secondary line: the account behind a canonical manager, labeled current or as recorded. */
export function accountNote(identity) {
  if (!identity.account || !identity.manager || fold(identity.account) === fold(identity.manager)) return null;
  return `${identity.accountIsCurrent ? "Compte Sleeper" : "Compte enregistré"} · @${identity.account}`;
}

/** One-line label for a current Sleeper roster picker: team · manager (@current account). */
export function rosterOptionLabel({ account = null, teamName = null } = {}) {
  const identity = describeIdentity({ account, teamName, accountIsCurrent: true });
  const manager = identity.manager ? `${identity.manager} (@${identity.account})` : identity.account ? `@${identity.account}` : "Manager inconnu";
  return `${teamLabel(identity)} · ${manager}`;
}
