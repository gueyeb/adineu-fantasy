# Coach hebdomadaire et état du backlog — 7 octobre 2026

## Résultat de cet incrément

La page privée `/coach/` présente l'équipe à gauche, les mouvements à droite, trois priorités au maximum et les analyses détaillées dans une section repliée. Le bouton actuel/proposé montre les affectations complètes de slots, avec retour au banc des sortants. Les claims alternatifs sont regroupés par coupe/place libre et restent des scénarios à revalider, sans exécution Sleeper.

Pour QB/K/DEF, la liste affichée privilégie les projections de la semaine cible au lieu de l'ordre du marché ROS. Tous les candidats de ces postes entrent dans la recherche du plan, indépendamment de la limite d'affichage. Les autres postes conservent leur ordre et les candidats épinglés restent présents. Le même sélecteur sert au live et au recalcul hors réseau.

Un potentiel de coupe en progression peut maintenant être signalé comme non chiffré, avec regret inconnu. Ce signal ne change ni les gains numériques ni la sélection du modèle. Il ne remplace pas une valorisation/calibration de l'optionalité. Les projections absentes distinguent joueur absent et chargement échoué ; une bye connue reste hors de ces diagnostics.

## Vérification de production

Le contenu de `public/assets/coach-ui.js` servi en production correspondait au fichier du commit de départ `30454d20b626f281f180b4b0937b7ee28ea9823a`. Cela ne prouve pas l'identité de tout le backend. L'endpoint additif `/api/version` expose les empreintes de fichiers clés pour permettre une comparaison après déploiement ; `/api/health` reste inchangé.

## Backlog consolidé

| Sujet | État dans cet incrément | Suite |
| --- | --- | --- |
| Vue équipe/mouvements et 3 priorités | Implémenté et tests automatisés | Validation visuelle bloquée par accès localhost du navigateur ; puis déploiement |
| Streamers absents à faible score marché | Sélection corrigée live/recompute | Contrôler le board après déploiement |
| Rotations WR/FLEX | Affectations complètes dans le tableau proposé | Conserver l'explication groupée existante |
| Projections manquantes | Diagnostic roster ajouté ; provenance candidat conservée | Étendre le résumé aux candidats |
| Potentiel de coupe non valorisé | Signal explicite ; regret inconnu | Valoriser et calibrer, chiffres inchangés pour l'instant |
| Audit commit réellement déployé | Asset Coach vérifié ; empreintes serveur ajoutées | Comparer `/api/version` après livraison |
| Préférences KEEP / suivi Mike Washington | Mécanisme existant, aucune préférence utilisateur inventée | Enregistrer explicitement les choix si demandé |
| Portefeuille conditionnel / TE2 | Fonctionnalités existantes conservées | Évaluation des décisions et résultats |
| Prix spéculatif, probabilités d'enchère | Ouvert | Données et calibration nécessaires |
| Routes / first reads / SOS détaillé | Sources incomplètes | Ingestion numérique sourcée avant conclusions |
| Export IA compact de provenance | Ouvert | Réduire la verbosité sans perdre le diagnostic |

Le screenshot de référence inspire l'organisation comparative, sans importer les estimations ou modèles d'un autre service. Les états « codé », « testé » et « déployé » restent distincts.
