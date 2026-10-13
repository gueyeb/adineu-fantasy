# PRD — Waiver War Room

Statut : implémenté le 13/10/2026 ; synchronisation entre appareils ajoutée le 14/10/2026. Origine : retour d'usage de Sleeper — la découverte
des joueurs se fait au fil des matchs, le portefeuille de claims ne se fige qu'après le lundi.

## Problème

Le moteur produit un plan de claims et des [claims alternatifs](conditional-claim-portfolio-2026-10-07.md),
mais chaque rapport est une photo : rien ne retient qu'un joueur a été repéré dimanche, pourquoi,
ni ce que valait son enchère avant les derniers matchs. Sleeper offre une watchlist sans motif ni
date, et aucun lien avec la coupe. Il manque la boucle de révision entre « je repère » et « je saisis ».

## Solution et périmètre

Un panneau « War Room » sur `/coach/` (accès privé Boukki), en cinq blocs :

1. **Watchlist évolutive** — liste choisie par l'utilisateur, distincte du `WATCH` du moteur.
   Chaque entrée porte la date d'ajout, la semaine et un motif obligatoire. Un joueur suivi est
   évalué même hors du top affiché ; s'il est pris par une équipe, la ligne le dit.
2. **Candidat vs coupe** — pour chaque joueur suivi ou planifié : coupe désignée, delta de lineup
   semaine par semaine (`weeklyLineupDeltas`), gain net total, horizon.
3. **Claims concurrents** — regroupement par joueur à couper de tout ce qui est actionnable (plan,
   replis, joueurs suivis). Deux lignes sur la même coupe ne se cumulent pas.
4. **Révision des enchères** — l'enchère proposée et le plafond personnel de chaque ligne sont
   historisés ; la révision compare l'état courant au dernier relevé pris avant que la dernière
   semaine de matchs soit complète (`dataThroughWeek` inférieur).
5. **Ordre à saisir dans Sleeper** — texte copiable : rang, joueur, enchère, coupe ; les replis
   suivent leur claim principal ; ajouts libres listés à part.

Hors périmètre : toute soumission, annulation ou écriture vers Sleeper ; probabilité de gagner une
enchère ; envoi n8n de la watchlist.

## Approche technique

- **Stockage : `localStorage`**, clé par saison/ligue/roster, comme les préférences du Trade Finder.
  Le serveur reste sans état et en lecture seule. Seuls les identifiants des joueurs suivis partent
  vers le serveur (en-tête `x-coach-watchlist`) ; motifs et dates restent dans le navigateur.
- **Module pur** `public/assets/war-room.js` : normalisation de la watchlist, historique des
  enchères, groupes par coupe, révisions, ordre de saisie. Testé par `test/war-room.test.js`.
- **Serveur** : `getFreeAgents({ watchIds })` renvoie `watchRows` (lignes évaluées, jamais ajoutées
  au board) et `watchMissing` (déjà détenu / hors pool). Le plan d'acquisition n'en dépend pas :
  suivre un joueur ne change ni le plan, ni la cohérence, ni la publication.
- **Coach** : `plan.warRoom = { rows, missing }` ; le navigateur y joint la watchlist locale.

## Critères de succès

- Un joueur ajouté pendant un match reste visible avec sa date et son motif jusqu'à son retrait.
- Après les matchs du lundi, chaque enchère modifiée affiche avant → après et la date du relevé.
- L'ordre copié se saisit dans Sleeper sans relire le rapport ; le total affiché ne compte qu'un
  succès par groupe de coupe.
- Avec ou sans watchlist, `/api/coach` renvoie le même `acquisitionPlan`.

## Cas limites et contraintes

- Joueur suivi déjà pris : conservé dans la liste, marqué « détenu par X », sans enchère.
- Ligne sans projection : aucune enchère (`null`), jamais 0 $ par défaut.
- Aucun relevé antérieur : « pas de référence », pas de révision inventée.
- Entre le relevé et la révision, la semaine opérationnelle avance : l'horizon se décale d'une
  semaine. Le delta mélange donc nouvelles données et semaine en moins — c'est indiqué.
- Annulation automatique entre claims d'une même coupe non vérifiée côté Sleeper
  (`platformCancellationVerified: false`) : l'ordre se revalide après chaque résultat.
- 40 joueurs suivis au plus, motif ≤ 200 caractères, 6 relevés par joueur, 21 jours de rétention.
- `localStorage` indisponible (navigation privée) : le panneau reste lisible, sans watchlist.

## Extension du 14/10/2026 — synchronisation entre appareils

Un joueur repéré sur le téléphone pendant les matchs doit être là sur l'ordinateur le mardi.

- Table `coach_war_room` (`supabase/migrations/20261014_coach_war_room.sql`) : une ligne par
  saison / ligue / roster (watchlist + relevés d'enchères). RLS activé, aucune policy : seule la clé
  secrète du serveur lit et écrit.
- `GET` / `PUT /api/coach/war-room` : même accès que le plan (session Coach ou jeton). Une écriture
  par session navigateur exige une origine identique ; tout est renormalisé côté serveur
  (`scripts/war-room-sync.js`), 64 Ko maximum.
- `localStorage` reste la première écriture : hors connexion ou sans session, rien ne change.
  À l'ouverture de `/coach/`, `syncWarRoom` aligne le navigateur : des modifications locales non
  envoyées l'emportent, sinon la copie serveur remplace la watchlist ; les relevés d'enchères sont
  toujours fusionnés (`mergeBidHistory`).
- Le plan, la cohérence et le message n8n restent indépendants de la watchlist.

Limites : dernier écrivain gagnant sur la watchlist — deux appareils modifiés hors connexion ne sont
pas fusionnés entrée par entrée ; un suivi ajouté depuis une page publique sans session Coach n'est
envoyé qu'à la prochaine ouverture de `/coach/` ; sans `SUPABASE_URL` / `SUPABASE_SECRET_KEY` côté
serveur, la route répond 503 et tout reste local.
