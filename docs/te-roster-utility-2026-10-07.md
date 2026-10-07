# Utilité d’un TE supplémentaire — 07/10/2026

Livré localement, sans déploiement ni modification de workflow n8n. Le diagnostic `teRosterUtility` explique le scénario ajout–coupe déjà évalué ; il ne change aucun score, enchère ou action.

## Contrat

- Configuration de ligue : un slot TE, bonus TE nul, calendrier des byes 2026 configuré.
- Référence : TE du slot déclaré ; à défaut, seul TE titulaire identifiable ou seul TE actif possédé. Plusieurs références possibles restent indéterminées. Les réserves sont exclues.
- Semaines TE/FLEX issues des lineups avant/après du fit choisi. Le gain est celui de la lineup entière, y compris un ancien TE déplacé en FLEX ; ne pas additionner une deuxième fois les pertes de coupe déjà incluses.
- Remplacement de bye annoncé seulement dans la durée du rôle, avec calendrier connu et comparaison couverte. Même bye, rôle trop court, projection manquante, statut bloqué ou slot verrouillé restent explicites.
- Gain brut, coût optionnel de coupe, perte après rôle et gain net réutilisent les métriques canoniques. Une utilité sportive peut être annulée par la coupe.
- Valeur de secours sur blessure future et valeur d’une acquisition alternative restent `null` : ni blessure future ni coût nul d’une place libre ne sont inventés.
- Un diagnostic recalculé après acquisitions précédentes précise ces hypothèses. Coach conserve ce diagnostic du plan, sans le doubler avec celui de la watchlist sur le roster initial.

## Sorties partagées

Waiver, AI Context et Coach partagent le diagnostic et les métriques. Le texte indique bye, utilisation projetée et coût de coupe ; le JSON conserve les semaines, références et limites. Coach/n8n affiche au plus trois diagnostics TE, les détails restent dans le JSON. Les étapes et alternatives du portefeuille de claims transportent le champ. Les snapshots capturent le contexte du slot TE et le module entre dans l’empreinte du modèle ; le replay utilise le même évaluateur. Les anciens contextes sans slot déclaré utilisent la règle de référence conservatrice.

## Evals

Les fixtures sont fictives et ne constituent pas des projections de joueurs réels. Treize tests couvrent : bye dans/hors rôle, FLEX, gain annulé par la coupe, couverture absente, même bye/calendrier inconnu, rotation couplée, égalité des métriques entre sorties, référence ambiguë, IR, verrouillage et statut bloqué, TE déclaré avec autre TE en FLEX, et priorité du scénario recalculé sur la watchlist.

Signal de livraison : tests ciblés et suite complète réussis, vérification statique/assets et diff propres. Pas de compilation ni linter disponibles dans ce dépôt. Le chantier général WR/FLEX et le diagnostic détaillé des projections manquantes restent ouverts.

Validation exécutée : 367 tests réussis ; `npm run check`, `npm run assets:check`, syntaxe JavaScript et `git diff --check` réussis.
