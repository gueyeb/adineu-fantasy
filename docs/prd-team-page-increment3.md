# Mini-PRD — Incrément 3 : Transactions Feed + Record Watch (`/teams/`)

Statut : **brouillon pour revue**.
Contexte : `docs/prd-team-page.md` (Incréments 1–2, livrés) scopait explicitement ces deux items hors-v1 — « chacun mérite son propre mini-PRD quand on y arrive ». On y est. FAAB restant et streak, aussi listés en P2, sont déjà livrés (cf. `public/assets/team-metrics.js`) et ne sont pas repris ici.

## Pourquoi

La page équipe répond déjà à « comment va mon équipe » (record, roster, force, alertes) et « est-ce que je performe » (all-play). Il manque deux angles : **l'activité récente** (qu'est-ce que ce manager a fait cette semaine — trade, waiver) et **le contexte historique** (est-ce que cette saison est en train de marquer l'histoire de la ligue). Les deux sont des compléments, pas des blocages — la page reste complète sans eux.

## Portée

**Dans le scope :**
1. Flux de transactions récentes de l'équipe sélectionnée (waivers/FA réussis + trades, 3 dernières semaines).
2. Record Watch : comparaison des stats live de l'équipe sélectionnée à 3 records historiques Yahoo (2019–2025) déjà affichés sur `/hall-of-fame/`.

**Hors-scope explicite :**
- Flux de transactions *toute la ligue* (juste celles de l'équipe sélectionnée, cohérent avec le reste de la page).
- Historique de transactions complet saison (fenêtre glissante 3 semaines en v1 — voir décision #1).
- Nouveaux records Yahoo au-delà des 3 retenus (biggest blowout, closest win, etc. — déjà visibles sur `/hall-of-fame/`, pas dupliqués ici).
- Records incluant la saison 2026 en cours (le record book reste 100% Yahoo 2019–2025 ; comparer une saison à elle-même n'aurait pas de sens).

## Décisions d'architecture

**1. Transactions : fenêtre glissante de 3 semaines, pas l'historique complet.**
Vérifié en direct (`curl .../league/{id}/transactions/{leg}`) : l'API Sleeper n'a pas d'endpoint "toutes les transactions" — un fetch par semaine (`leg`), chacun retournant `{type: waiver|free_agent|trade, status: complete|failed, adds, drops, roster_ids, waiver_budget, draft_picks, created}`. La semaine 1 seule contient 57 transactions (32 waivers, 24 FA, 1 trade) rien que pour toute la ligue. Aller chercher les ~14 semaines de la saison en parallèle à chaque chargement de page est un coût réseau disproportionné pour un flux "activité récente". Je propose de fetcher uniquement `[currentWeek-2, currentWeek]` (3 requêtes Sleeper max, en parallèle avec les autres fetches de la page), filtré sur `roster_ids.includes(rosterId)` et `status === "complete"` (les claims échoués ne sont pas des mouvements réels). *Réversible* : si l'historique complet devient un besoin réel, un 4e incrément peut l'ajouter sans toucher à celui-ci.

**2. Record Watch : extraction de `buildYahooRecordBook` en module isomorphe, comme `roster-view.js` en Incrément 1.**
`buildYahooRecordBook` (private, `public/assets/site.js:217`) calcule déjà tout le record book Yahoo pour `/hall-of-fame/` — c'est une fonction pure (aucun I/O), seulement jamais testée ni exportée puisqu'elle n'avait qu'un seul appelant. La page équipe en devient le 2e — le même seuil de duplication qui a justifié l'extraction de `roster-view.js` en Incrément 1 s'applique ici. Je l'extrais telle quelle (comportement inchangé) vers `public/assets/record-book.js` avec `test/record-book.test.js` (nouveau — elle n'a jamais eu de couverture directe), et `site.js` migre vers l'import (refactor mécanique).

**3. Record Watch : 3 records seulement, ceux déjà déductibles des données déjà chargées sur la page.**
La page a déjà, sans fetch supplémentaire : le score hebdo max de l'équipe cette saison (dérivable de `matchupRows`, déjà chargé pour All-Play/Power Rankings), le streak actuel (`roster.metadata.streak`, déjà utilisé pour l'affichage), et les points pour cumulés (`standingsRow.points_for`, déjà affiché). Je compare ces 3 valeurs aux records Yahoo correspondants (`highScore.points`, meilleur streak ≥7 victoires, meilleur total PF sur une saison) :

| Record affiché | Valeur live comparée | Formule |
|---|---|---|
| Score le plus haut sur un match (Yahoo, toutes saisons) | Score hebdo max de l'équipe cette saison | `recordBook.highScore.points` vs `max(matchupRows filtrés sur ce manager)` |
| Plus longue série de victoires (Yahoo, ≥7) | Streak actuel Sleeper | `recordBook.topStreaks[0].wins` vs `formatStreak` déjà parsé |
| Points marqués sur une saison | Points pour cumulés à date | `pointsRecord.pf` (déjà calculé dans `site.js` pour `/hall-of-fame/`) vs `standingsRow.points_for` |

Affichage : écart brut ("à 14.3 pts du record"), jamais un pourcentage de chance ou une projection — même discipline anti-fabrication que Power Rankings/All-Play. Si l'équipe *dépasse* un record, le label change ("nouveau record de la ligue" plutôt qu'un écart négatif confus).

## Sources de données

| Bloc UI | Source | Détail |
|---|---|---|
| Transactions récentes | Sleeper `/league/{id}/transactions/{leg}` × 3 (fenêtre courante) | Filtré `roster_ids` + `status:complete` ; noms de joueurs via `playerMap` déjà chargé |
| Record Watch | `public/assets/record-book.js` (extrait de `site.js`) + `data/yahoo-history.json`, `data/yahoo-matchups.json`, `data/yahoo-playoffs.json` (déjà chargés côté `/hall-of-fame/`, nouveau fetch sur `/teams/`) | Comparé à `matchupRows`, `roster.metadata.streak`, `standingsRow.points_for` déjà en mémoire sur la page |

Nouveau coût réseau net pour `/teams/` : 3 requêtes Sleeper (transactions) + 3 fichiers JSON statiques (record book, mis en cache navigateur comme le reste du site) — aucune nouvelle clé, aucun nouvel endpoint serveur.

## Incrément 3 — découpage proposé

**3a — Record Watch** (le plus petit delta : aucune nouvelle donnée réseau côté Sleeper, juste extraction + 3 fichiers JSON déjà publics)
- `public/assets/record-book.js` + `test/record-book.test.js`, migration de `site.js`.
- Bloc "Record Watch" sur `/teams/` : 3 cartes (score hebdo, streak, PF saison), écart au record, label spécial si dépassement.

**3b — Transactions Feed**
- `public/assets/transactions.js` (`filterTeamTransactions(rows, rosterId)` — pure, testée) + fetch parallèle des 3 dernières semaines dans `teams.js`.
- Rendu : liste chronologique, type (waiver/FA/trade), joueurs ajoutés/coupés (noms via `playerMap`), budget FAAB engagé si waiver.
- Dégradation propre si Sleeper indisponible ou aucune transaction sur la fenêtre (état vide, pas une erreur).

Chaque sous-incrément livrable et testable seul, comme la convention du repo.

## Risques & mitigations

- **Fenêtre de 3 semaines peut sembler arbitraire / cacher une grosse transaction plus ancienne.** → Acceptable en v1, label explicite "3 dernières semaines" plutôt qu'implicite. Réversible si demande d'historique complet.
- **Record Watch peut créer une fausse impression de "compétition contre le passé".** → Toujours écart brut, jamais de classement ni de score de proximité inventé — même garde-fou qu'ailleurs sur le site (AGENTS.md).
- **`buildYahooRecordBook` n'a jamais été testée unitairement — l'extraire peut révéler un bug latent invisible jusqu'ici.** → `test/record-book.test.js` couvre le comportement actuel avant toute modification ; si un test échoue, c'est un bug pré-existant à signaler, pas un problème introduit par ce PRD.

## Ce qui ne change pas

Aucun changement de schéma Supabase, aucune nouvelle dépendance npm, aucun nouvel endpoint serveur. `/hall-of-fame/` continue d'afficher exactement le même record book qu'aujourd'hui (comportement inchangé par la migration).
