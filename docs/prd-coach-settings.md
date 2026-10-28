# PRD — Réglages du Coach privé

28/10/2026. Statut : v1 implémentée localement, migration écrite mais **non appliquée**.

## Problème

Trois choix d'exploitation sont aujourd'hui figés dans le code ou demandent du SQL :

- l'équipe suivie (`t0z` codé en dur dans `/api/coach`, `COACH_TEAM` ailleurs) ;
- le mode « changements seulement » des bulletins (`?delta=1` dans l'URL n8n) et la fenêtre
  « proche du coup d'envoi » (3 h dans `scripts/coach-delta.js`) ;
- les noms de managers : le renommage du 28/10 (`owners.display_name`) a été fait en SQL à la main.

Le propriétaire du Coach doit pouvoir les régler depuis la page privée, sans déploiement ni accès
à la base, avec une trace de ce qui a changé.

## Solution (v1)

Un panneau « Réglages » dans `/coach/`, derrière le même accès que le plan.

1. **Équipe suivie** — un roster Sleeper de la saison, stocké par `roster_id` (stable même si le
   compte Sleeper change de nom, cf. MouhammadAT → Shiro00). Priorité : paramètre `team` explicite
   d'un appel bearer > réglage enregistré > `COACH_TEAM` > `t0z`. Le Coach web, le contrôle avant
   verrouillage, le journal (synchronisation du jeudi et du mardi) suivent la même résolution.
   Les routes publiques (Trade Hub, contexte IA, Start/Sit) gardent leur sélecteur et leur défaut.
2. **Bulletins** — `deltaByDefault` (les appels bearer sans `delta` utilisent le mode
   « changements seulement » ; `delta=1` / `delta=0` restent prioritaires) et
   `nearKickoffHours` (0,5 à 24 h, pas de 0,5 h ; défaut 3 h).
3. **Managers** — liste des propriétaires Supabase : nom affiché, comptes plateforme liés
   (`owner_platform_ids`), alias confirmés du code. Seul `owners.display_name` est modifiable :
   texte nettoyé, 1–40 caractères, sans caractère de contrôle, unique sans tenir compte de la casse,
   écrit seulement si la valeur précédente est encore celle lue (pas d'écrasement concurrent),
   journalisé (ancien nom, nouveau nom, date) dans la même transaction.

Les **alias restent en lecture seule** : un alias rattache un compte à une identité confirmée.
L'ajouter reste un changement de code relu (`SLEEPER_MANAGER_ALIASES`), jamais une saisie libre.

## Hors périmètre / v2

- Alias stockés en base (table d'alias + preuve de confirmation + revue) : utile si un nouveau
  manager arrive en cours de saison, mais exige un processus de confirmation ; à décider.
- Réglages par saison ou multi-ligues ; gestion des workflows n8n depuis la page.
- Mobile : non requis.

## Contraintes et cas limites

- Table absente, Supabase non configuré ou lecture en erreur : valeurs par défaut, source
  `DEFAULT`/`UNAVAILABLE` affichée ; l'enregistrement répond 503 sans rien casser.
- Fonction de renommage absente : 503 `OWNER_RENAME_UNAVAILABLE`, aucune écriture partielle.
- Équipe enregistrée qui n'existe plus dans la ligue : erreur explicite du Coach (comme un `team`
  inconnu), jamais un repli silencieux sur une autre équipe.
- Écritures par cookie : même origine exigée ; bearer accepté (automatisation).
- Aucun secret ni identifiant de compte privé dans les réponses ; les `platform_user_id` ne sont
  pas renvoyés au navigateur.

## Approche technique

- Migration `supabase/migrations/20261028_coach_settings.sql` : `coach_settings` (une ligne par
  saison/ligue, RLS sans policy), `owner_display_name_changes` (audit, RLS sans policy) et la fonction
  `rename_owner_display_name(owner, expected, next)` (`security invoker`, exécution révoquée pour
  `public`, `anon`, `authenticated`), qui vérifie l'ancien nom et l'unicité puis écrit nom + audit.
- `scripts/coach-settings.js` : normalisation, résolution de l'équipe, store Supabase (cache 30 s,
  invalidé à l'écriture) et liste/renommage des propriétaires.
- Routes `GET`/`PUT /api/coach/settings`, `PUT /api/coach/settings/owners/:id`, avant le garde
  GET-only de `server.js`, mêmes règles que `/api/coach/war-room`.
- Vue pure `public/assets/coach-settings-view.js` (rendu testable), branchée dans `coach-ui.js`.

## Mesure du succès

- Plus aucun SQL manuel pour un renommage ; chaque renommage a sa ligne d'audit.
- Changer d'équipe suivie change le Coach web et les jobs n8n sans modifier de workflow
  (sauf ceux qui passent `team=` explicitement, qui restent prioritaires).
- Tests : validation, priorité, dégradation sans table, audit, accès et même origine.
