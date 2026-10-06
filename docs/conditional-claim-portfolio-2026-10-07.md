# Claims alternatifs — livraison locale du 7 octobre 2026

Le plan gagnant existant reste disponible : chaque ajout recalcule roster, coupe, horizon et budget. Cette livraison ajoute les replis lorsqu’un candidat non retenu dans ce plan utilise la même coupe ou place libre, au même instant de traitement, qu’un claim retenu. Un simple conflit dans les évaluations initiales ne suffit pas : si deux acquisitions restent utiles après recalcul et justifient deux coupes distinctes, elles restent cumulables dans le plan.

Aucun claim, workflow n8n, service ou déploiement modifié. Les noms et montants de l’exemple ci-dessous sont des fixtures de test ; ce ne sont pas des enchères recommandées aujourd’hui pour Boukki.

## Exemple de branches

Une acquisition WR demande la coupe du même joueur de banc. Coleman est le premier choix, Harris le repli. La DEF peut utiliser une place libre.

| Résultat supposé du groupe WR | Acquisition WR | FAAB WR réservé | Suite |
| --- | --- | --- | --- |
| Coleman gagné | Coleman, une coupe | 47 $ | DEF et autres étapes recalculées |
| Coleman échoué/écarté, Harris gagné | Harris, la même coupe une fois | 23 $ | DEF et autres étapes recalculées |
| Aucun choix acquis | Aucun | 0 $ | Roster avant ce groupe conservé, suite recalculée |

Maximum pour ce groupe détaillé : 47 $, et non 70 $. Avec un repli à 60 $, le maximum devient 60 $, même si le plan principal réserve toujours 47 $. Si une étape suivante devient trop chère après le repli, elle disparaît de cette branche ; son budget n’est pas réservé artificiellement.

L’ordre reste opérationnel : ajout libre vérifié d’abord, waivers selon leur date de traitement, puis slot vide et utilité marginale. Une DEF libre peut donc précéder les claims ; une DEF en waiver plus tardif peut les suivre. La place libre est consommée une seule fois dans chaque branche.

## Contrat JSON

`acquisitionPlan.steps` et `reservedFaab` décrivent le plan principal supposant les succès précédents, comme avant. Le module commun `public/assets/waiver-plan.js` ajoute :

- `alternativeClaimGroups` : groupes du chemin principal, choix ordonnés, coupe/place partagée, date de traitement, budget avant, roster avant, IDs de dépendances et maximum d’enchère du groupe ;
- `claimPortfolio.groups` : groupes rencontrés sur les différentes branches, avec leurs hypothèses antérieures ;
- `claimPortfolio.scenarios` : résultats supposés des groupes, échecs des choix précédents, choix non tentés, étapes recalculées, FAAB réservé/restant et roster final supposé ;
- `primaryScenarioId` : branche correspondant au plan principal ;
- `maximumReviewedFaabExposure` : maximum de la dépense des scénarios détaillés, uniquement lorsque leur exploration est complète et le budget connu ;
- `evaluatedScenarioMaxFaab` : maximum effectivement calculé parmi les branches explorées ;
- `simultaneousSubmissionExposure:null`, `platformCancellationVerified:false`, `submitsAutomatically:false`.

Une branche remplace l’étape concernée ; elle ne s’ajoute pas aux autres branches. `dependsOnOutcomes` et `dependsOnPlayerIds` donnent les hypothèses, pas des résultats observés. Le motif réel d’échec reste inconnu ; OUTBID, CLAIM_REJECTED, PLAYER_UNAVAILABLE et CLAIM_SKIPPED sont des possibilités. Les fenêtres de rôle et protections des acquisitions précédentes sont conservées lors du recalcul.

L’exposition simultanée réelle sur Sleeper n’est pas certifiée : aucune annulation ou exclusion automatique entre claims n’est supposée. Le maximum décrit une branche revue puis revalidée après chaque résultat, pas la soumission de toutes les listes en parallèle.

## Limites explicites

Au maximum trois acquisitions par plan par défaut, deux replis par groupe et seize scénarios. Les autres candidats restent dans les listes individuelles du rapport mais ne deviennent pas des succès supposés dans ce groupe. Leur nombre omis est exposé. Les branches « aucun choix gagné » n’acquièrent pas automatiquement une option omise.

Si la limite de scénarios est atteinte, `PARTIAL_REVIEWED_SCENARIOS` et `SCENARIO_LIMIT_REACHED` : le maximum global reste `null`. Le maximum calculé n’est alors qu’un résultat parmi les branches explorées. Le budget initial reste une limite de chaque branche calculée. Les évaluations doivent être déterministes ; une branche forcée qui ne peut plus être reproduite signale `NON_DETERMINISTIC_EVALUATION` et empêche de publier un maximum complet.

La couverture concerne les résultats des groupes alternatifs. Les claims ordinaires hors groupes continuent à supposer leur succès ; tous les échecs possibles du marché ne sont pas énumérés. Le plan reste glouton, sans garantie d’optimalité ni probabilité de gagner.

## Rendu Coach, contexte et n8n

Le JSON est partagé entre Waiver, AI Context et Coach ; les snapshots et le recalcul hors réseau le conservent avec l’empreinte du modèle. Le `message` Coach affiche le plan principal puis « Coleman, puis Harris seulement si les choix précédents échouent ou sont écartés », le maximum du groupe et les limites. Quand un plan existe, les recommandations individuelles ne sont plus dupliquées au-dessus comme si elles étaient cumulables ; elles restent dans le JSON. La page Coach affiche toujours les cartes du chemin principal et ce message, sans nouveau sélecteur de branche.

L’export texte IA résume le plan et les groupes ; il ne répète pas toutes les branches détaillées du JSON. Le workflow n8n existant peut transmettre le même champ `message`. Son refus des rapports non publiables reste inchangé. Aucun envoi automatique réalisé dans cette livraison.

## Evals et validation

Critères de capacité : ordre des replis et trois issues du groupe ; budget maximal sans addition des alternatives ; suite recalculée après succès/échec ; plusieurs groupes combinés ; limites signalées sans faux maximum.

Critères de régression : disponibilités/horizons/prix invalides exclus ; ajouts légaux avec coupes distinctes conservés ; place libre consommée une fois ; rôle temporaire jamais prolongé ; budget inconnu conservé ; mêmes données dans Waiver/Context/Coach et rejeu des archives.

Signal de livraison locale : ces checks passent, plus la suite complète, les contrôles statiques et les versions d’assets. Tests dédiés : `test/waiver-alternatives.test.js`. Aucun accès réseau fournisseur ou production nécessaire pour ces tests.


Résultat : **354 tests passent**, dont quinze tests dédiés de portefeuille/rendu/API n8n. Vérification de syntaxe des quatre modules modifiés, contrôles du site statique, 42 versions d’assets et whitespace réussis. Aucun build/compilateur ou linter n’est défini dans ce dépôt. Les scénarios réels de claims ne sont pas soumis ; les règles d’annulation de la plateforme restent non certifiées.
