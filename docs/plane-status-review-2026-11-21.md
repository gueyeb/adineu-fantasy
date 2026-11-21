# Revue Plane — 21 novembre 2026

Projet ADIN, workspace Dakhine HQ. Tâches et rapports Supabase relus en direct.
Au début : 17 tickets, 12 ouverts ; ADIN-2, 4, 6, 7 et 9 déjà terminés.

**État après traitement : 15 tickets terminés, ADIN-10 et ADIN-14 encore ouverts.**
La liste de dix tâches en fin de document décrit le point intermédiaire, avant
la livraison et les audits ci-dessous.

## Traitement et livraison du 21 novembre

### ADIN-17 — optimiseur hebdomadaire corrigé et livré

Commit `88be7c1eab901b77a1a088d92134fe8e0362127a`, poussé sur main.
Coolify, déploiement `js08o40o8wwc8880g88w4wsk` : commit Running confirmé dans
l'UI. Le 21/11 à 02:17:47 UTC, `/api/version` correspond aux 15 empreintes locales,
y compris l'optimiseur ajouté au manifeste. `/api/lineup-advisor?team=t0z` retourne
S11, `effectiveWeek=11`, couverture complète, gain 0 et aucun mouvement.

Deux reproductions échouaient avant correction : Burden CHI en bye S10 pouvait
être sélectionné avec une projection absente ou périmée ; une projection absente
déclenchait le repli rang/ADP de `weeklyEstimate`. Le comparateur hebdomadaire
utilise désormais uniquement les projections publiées ; semaine transmise par
Coach, contexte IA, conseiller et contrôle avant verrouillage. Bye et absents
exclus, règle partagée avec optimal/Boom/Safe. Si une projection d'un joueur
éligible manque, gain et optimum sont inconnus, aucun mouvement chiffré publié.
Les titulaires absents déjà verrouillés sont conservés dans leur slot fixe à 0,
sans permission d'édition supposée. Aucun changement de valeur marché/ROS.

Syntaxe Node et contrôles statiques valides ; 738 tests réussis, puis quatre
tests HTTP ciblés de version/Coach après ajout de l'empreinte. Aucun build,
typecheck ou linter configuré. Coach fictif à 390×844 : avertissement visible,
largeur document 390 px, aucune erreur console.

### ADIN-1 / ADIN-3 — production QC-01

`/teams/`, Boukki : manager Babacar, compte @t0z, all-play **49–61 sur 110
confrontations en 10 semaines**, indicateur explicitement nommé profondeur
catalogue (distinct des projections et valeurs ROS). `/matchups/`, S11 : le duel
avant kickoff affiche une estimation figée et datée ; les cinq duels commencés
retirent le pourcentage pré-match. Deux modes scores/estimation séparés.
Audit public GET-only `scripts/audit-sleeper-sync.js`, 02:13:38 UTC : S1–S10
MATCH, 12 rosters par semaine, zéro écart. Cela ne certifie pas le planning n8n.

### ADIN-5 / ADIN-11 — n8n relu sans exécution manuelle

- Weekly Sleeper Sync `uR9N9hD9voSLwk7V` : publié, mardi 10:00, timezone explicite
  Europe/Paris ; succès 10/11 et 17/11 à 10:00:15 Paris (09:00:15 UTC), exécutions
  40181 et 42359.
- Bilan waivers `ahjkH8varA4sXvGl` : publié, jeudi 09:00 ; timezone héritée
  **Europe/Berlin**, même décalage/DST que Paris sur ces dates. Succès 12/11 et
  19/11 à 09:00:42 local (08:00:42 UTC), exécutions 40821 et 43053. Ne pas écrire
  que ce workflow possède un override Europe/Paris. Aucun horaire modifié.
- Coach `WSIPLP3jam3PC000` : publié, URL GET `/api/coach` sans delta forcé,
  filtre « Changement utile ? » = `{{ $json.notify !== false }}` is true.
  Succès 10/11 et 17/11 à 10:30:24 local (40190, 42368). Tests delta inclus
  dans la suite : plan inchangé => pas de notification. Aucun bulletin envoyé
  par cette session, aucune modification de workflow.

### ADIN-12 — Coach réel à 390 px et mesure de payload

L'utilisateur a ouvert la session privée de production. Après le redémarrage,
une nouvelle connexion a été nécessaire (sessions serveur en mémoire).
Lineups actuelle/proposée, journal réel et contrôles de choix inspectés à
390×844 : largeur document 390 px, aucune erreur console. Bilans 2/4, points
produits/titularisés, claims perdus et contrefactuels distincts ; aucun formulaire
enregistré. Les choix explicites restent non renseignés : ADIN-10 demeure ouvert
pour l'adoption réelle, pas pour une absence d'implémentation.

`GET /api/free-agents?team=t0z` : 1 519 971 octets décodés, 85 758 puis 85 764
octets transférés avec compression, TTFB 9,52 s première lecture / 3,51 s seconde,
66 lignes et 66 `dropCandidatesOmitted`, aucune liste de coupes candidate transférée.
Deux lectures ne prouvent pas l'état précis des caches ni une amélioration de latence
par rapport à octobre. Pas de nouvelle optimisation entreprise sans mesure.

### ADIN-8 — avant/après à snapshot constant

Fixture `test/fixtures/trade-validation-2026-10-28.json`, extrait sourcé de trois
rosters S8. Ancien moteur `7fe3ff6` extrait via git archive ; moteur actuel `88be7c1`,
même fixture, `view=ALL`, `limit=null`, `currentWeek=8`, horloge 28/10 13:30 UTC.
Le nouveau moteur reçoit aussi les projections hebdomadaires présentes dans cette
même fixture (ancien moteur ne les exploitait pas). Inputs et valeurs des joueurs
inchangés après les deux appels. Ce n'est pas une comparaison de scores invariants.
[Résultats structurés](trade-snapshot-review-2026-11-21.json).

| Roster | Recommandées avant → après | Négociables avant → après | Exploration avant → après |
| --- | ---: | ---: | ---: |
| Boukki | 1 → 0 | 1 → 2 | 167 → 132 |
| Super Sayan warriors | 1 → 0 | 1 → 0 | 4 → 14 |
| Estocade | 2 → 0 | 3 → 2 | 15 → 12 |

Revue qualitative de toutes les pistes hors exploration :

- Burden contre Pitts + Stevenson : Stevenson remplace Love au RB2 de Boukki,
  Estocade améliore son FLEX avec Burden et cède un TE de banc. Boukki doit couper
  un joueur (Kamara candidat) ; coût, profondeur et coupe non confirmée affichés.
  Moyennes +1,8/+1,8 pts/sem ; simulations +4,5/+8,4 pts. Piste conditionnelle,
  jamais acceptation ou exécution certifiée. Également visible en sens inverse.
- Warren contre Tuten + Dowdle : Super Sayan améliore son RB2, Boukki récupère
  deux RB et améliore RB2 tout en baissant légèrement RB1. Coupe Kamara et perte
  de la profondeur Dowdle chez l'adversaire explicites. Simulation +1,9/+4,7 pts :
  gains modestes, négociation seulement.
- Burden contre McConkey + Stevenson : même motivation FLEX/RB2, McConkey Out
  et retour non confirmé ; scénarios positifs mais faibles (Estocade +0,6 à +6,3,
  Boukki +0,8 à +5,3 pts), pas de recommandation ferme.
- Super Sayan sans piste principale est un résultat valide. L'ancien échange
  Puka contre Tuten + McMillan n'est plus recommandé après prise en compte de
  la couverture des byes et du contrôle hebdomadaire.

Timing absent de cet extrait : `TIMING_EVIDENCE_MISSING`, coupes/exécution
UNVERIFIED. Les chiffres restent des simulations historiques conditionnelles,
pas des trades applicables aujourd'hui ni une validation prédictive. Aucun taux
d'acceptation inventé, aucun réglage de valeur pour améliorer ce bilan.

### ADIN-13 — réconciliation documentaire

Roadmap actualisée avec les preuves ci-dessus et les deux limites restantes.
Snapshot RB du 20/10 relu en production : S7 `sos-weekly-rb-v1` et WR
`sos-weekly-v1` pris à 08:00:20 UTC ; weekly pris à 08:00:28 UTC.
Les anciennes entrées « non déployé » restent identifiées comme historiques.
L'évaluation des profils de rôle (20 fenêtres) et la décision SOS QB/TE restent
ouvertes dans la roadmap : les clôtures QC ne les déclarent pas livrées.

### Deux tâches encore ouvertes

- **ADIN-10** : obtenir de vrais choix/motifs d'opérateur ; aucun refus inféré,
  aucun choix artificiel inscrit pour faire passer l'audit.
- **ADIN-14** : observer la progression effective pendant un match NFL ; livraison,
  bascule des scénarios, mobile et détails vérifiés, mais pas cette observation.

## Revues terminées dans Plane

ADIN-15 et ADIN-16 clôturés après ajout des résultats et limites dans leurs
descriptions. Aucun coefficient, workflow ou donnée de production modifié.

### ADIN-15 — projections et FAAB S9–S10

Rapports `model_feedback` 2026 : S9 généré le 10/11 à 09:00:30 UTC,
S10 le 17/11 à 09:00:36 UTC. MAE plus basse = meilleure précision.

| Semaine | Horizon | n | Sleeper | Adineu |
| --- | ---: | ---: | ---: | ---: |
| S9 | 3 | 45 | 4,21 | 4,47 |
| S9 | 4 | 110 | 3,83 | 3,92 |
| S9 | 5 | 106 | 3,95 | 3,91 |
| S10 | 4 | 33 | 5,85 | 6,26 |
| S10 | 5 | 91 | 4,93 | 5,00 |
| S10 | 6 | 92 | 4,74 | 4,74 |

Même cohorte entre modèles dans chaque ligne ; ne pas considérer les lignes
comme des observations indépendantes ni comme des joueurs uniques.
Le détail par poste montre des gains ponctuels, sans avantage régulier du mélange.
Les échantillons QB sont petits. Les scorecards S9/S10 ne contiennent pas les
horizons récents 1–2 : vérifier la couverture avant toute calibration.

FAAB : Brier S9 0,196 contre 0,252 pour la référence constante (22/27 notées),
S10 0,194 contre 0,252 (28/34). Couverture p25–p75 des enchères rivales 80 %
sur 15 cas puis 71 % sur 17 cas, cible 50 %. Meilleur Brier sur S8–S10,
mais intervalles trop couvrants dans ces échantillons. Cela ne mesure pas la
couverture des fourchettes de prix des seuls gagnants.

Décision : conserver provisoirement les coefficients et poursuivre la mesure.
La revue S8–S10 est effectuée ; aucune preuve assez robuste ici pour recalibrer.

### ADIN-16 — première revue experts à quatre semaines

Rapport S10 `experts.status=SCORED`, quatre semaines S7–S10 ACCEPTED pour
FantasyPros/Sleeper/Adineu avec exclusions kickoff/identités documentées.
Draft Sharks/CBS restent NOT_CONFIGURED. Cumul de métriques hebdomadaires pondérées
par échantillon sur cohorte commune, pas une corrélation recalculée sur tous les rangs.

| Poste | n joueur-semaines | MAE FantasyPros | MAE Sleeper |
| --- | ---: | ---: | ---: |
| QB | 106 | 6,167 | 6,193 |
| RB | 316 | 4,041 | 4,202 |
| WR | 509 | 4,157 | 4,081 |
| TE | 335 | 2,917 | 2,845 |
| K | 106 | 3,565 | 3,577 |
| DST | 106 | 4,442 | 4,421 |

Corrélation de rang : FantasyPros meilleur QB/RB/WR/TE, Sleeper meilleur K/DST.
Top-N : FantasyPros meilleur RB/WR, Sleeper meilleur QB/TE/K/DST.
Pas de vainqueur global cohérent entre métriques. Quatre semaines suffisent pour
cette première revue, pas pour affirmer une supériorité statistique.
Adineu = Sleeper à horizon 0 : aucun avantage du mélange usage ROS testé ici.
Décision : conserver le modèle et poursuivre le benchmark privé ; aucun classement
externe republié.

## Dix tâches restant ouvertes après la revue

- ADIN-17 : joueur en bye recommandé titulaire. Passé de Backlog à Todo,
  priorité haute ; aucune correction ni reproduction revendiquée dans cette revue.
- ADIN-1 : livraison et preuves de correction en production.
- ADIN-3 : distinction probabilités pré-match / scores live.
- ADIN-5 : horaires et exécutions n8n.
- ADIN-8 : comparaison qualitative des trades sur snapshots sourcés.
- ADIN-10 : adoption du journal et choix explicites.
- ADIN-11 : notifications n8n utiles.
- ADIN-12 : Coach mobile authentifié et payloads.
- ADIN-13 : réconciliation du backlog avec les preuves de production.
- ADIN-14 : StatTracker mobile, observation en match et livraison.

Les statuts historiques terminés n'ont pas été rouverts. Aucun test relancé pour
cette revue documentaire en lecture seule. Les modifications de code et documents
préexistantes dans le répertoire ont été conservées.
