# PRD — Leaders de la semaine

Statut : implémenté localement, 14/10/2026. Origine : demande d'un classement hebdomadaire par
poste « façon Yahoo / FantasyPros Game Day ».

## Problème

Un top 10 par points seul est une page à regarder : Sleeper l'affiche déjà et il ne change aucune
décision. Ce qui manque est le lien entre « qui a marqué » et ce qu'on peut en faire : le joueur
est-il libre, était-il sur un banc, sa performance vient-elle de son volume ou d'un touchdown ?

## Solution et périmètre

Un onglet **Leaders** dans le Game Center (`/matchups/#leaders`), public, par semaine :

- top 10 par poste (QB, RB, WR, TE, K, DEF) au barème exact de la ligue ;
- qui le détient aujourd'hui, ou « agent libre » ; « banc » quand son manager ne l'a pas aligné ;
- points réels, projection Sleeper d'avant-match, écart ;
- Usage Score et signal `BUY_LOW` / `SELL_HIGH` existants (QB/RB/WR/TE) ;
- par poste, les trois meilleurs agents libres de la semaine avec leur rang, même hors top 10 ;
- « + Suivre » sur un agent libre : alimente la watchlist du War Room. Le bouton n'apparaît que
  dans un navigateur déjà passé par `/coach/`.

Hors périmètre : play-by-play, scores en direct à la minute (Sleeper le fait), classement cumulé
sur la saison, toute recommandation chiffrée (enchère, valeur d'échange) — elles restent dans le
Waiver Wire, le Trade Finder et le Coach.

## Approche technique

- **Module pur** `public/assets/weekly-leaders.js` : `leaguePoints(ligne, barème)` (somme des stats
  Sleeper × `scoring_settings` de la ligue) et `buildWeeklyLeaders`. Testé par
  `test/weekly-leaders.test.js`.
- **Barème de la ligue, pas `pts_ppr`** : sur la semaine 5, le calcul reproduit 167/167 scores
  publiés par Sleeper pour la ligue ; `pts_ppr` en manque 13 (interception à −2, kickers, défenses).
  La projection est rescorée au même barème, sinon l'écart comparerait deux barèmes.
- **Serveur** : `getWeeklyLeaders` (`scripts/league-context.js`) + `GET /api/leaders?week=`. Le
  navigateur ne peut pas charger l'index joueurs Sleeper (15 Mo) ; le serveur l'a déjà en cache.
- **Détention** : rosters actuels (c'est ce qui est actionnable). « Banc » vient du lineup de la
  semaine consultée, et seulement si le détenteur n'a pas changé depuis.
- Aucune écriture, aucune table.

## Critères de succès

- Les points affichés pour un joueur de la ligue sont ceux de Sleeper, au centième.
- Un agent libre dans un top 10 se suit en un clic et un motif, sans quitter la page.
- La page ne publie aucun chiffre que le Waiver Wire ou le Coach contrediraient : elle n'en calcule
  aucun de plus.

## Cas limites et contraintes

- Semaine sans match joué : état vide, pas de tableau à zéro.
- Semaine en cours : classement partiel, stats en cache 5 minutes, mention « en cours ».
- Joueur sans projection : `null`, pas d'écart ; jamais 0 par défaut.
- Projections des kickers : Sleeper ne projette que `fgm_50p` ; il est compté au tarif 50–59 yards
  quand le détail manque.
- L'Usage Score est celui des trois dernières semaines terminées, pas celui de la semaine consultée.
- Joueur échangé ou coupé depuis : le détenteur affiché est l'actuel, sans mention « banc ».
- Usage indisponible : le classement s'affiche sans la colonne renseignée.
