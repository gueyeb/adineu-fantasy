# Export et diagnostics — 7 octobre 2026

## Livraison précédente

PR #1 fusionnée dans `main` : `39fddad403cbf3636242c7853bec8c2f83d8e91b`.
Les neuf empreintes exposées par `/api/version` en production correspondent aux fichiers de ce commit.
Empreinte agrégée : `76161a3052531cf016c34daa862bb8c9d4772a3efdaccd4ded2bf4ac4da9fdc0`.
Cela vérifie ces fichiers, pas tous les fichiers du dépôt. La page Coach répond dans le navigateur ; le roster privé reste derrière la connexion, donc validation visuelle desktop/mobile encore ouverte.

## Cet incrément

- AI Context texte : couverture agrégée par roster/candidats au lieu de la répétition de toute la provenance JSON. Comptages projection/usage, sources ROS, plage des dates de collecte, nombre de sources, données inconnues et joueurs affectés (12 noms maximum) restent visibles.
- Les causes datées et URLs par joueur/semaine restent dans le JSON de décision. Une bye connue ne devient pas une projection absente. Une provenance manquante reste inconnue.
- Coach : diagnostics de projection des candidats ajoutés à ceux du roster, avec le périmètre explicite dans le JSON et résumé dans le message n8n.
- Potentiel de coupe non chiffré signalé dans n8n et AI Context : le gain affiché exclut ce potentiel ; comparer une autre coupe avant décision.

Aucun gain, ordre de sélection, plafond ou montant d'enchère n'est recalibré. La valorisation de l'optionalité reste ouverte ; attribuer arbitrairement des points au signal déplacerait le problème.

Validation : suite complète, contrôles statiques, versions d'assets et whitespace. Le test de gros pool conserve 1 000 lacunes datées dans le JSON avec un résumé borné dans le texte. Tests dédiés : `test/provenance-summary.test.js`.
