## Contexte

<!-- Pourquoi ce changement ? Lien vers issue / ADR / progress.md §X.Y -->

## Changements

<!-- Liste concise. -->

-

## Tests

<!-- Comment a-t-on validé le changement ? -->

- [ ] Unit / integration tests added or updated
- [ ] E2E tests updated if user flow impacted
- [ ] Manual test steps reproductibles

## Sécurité

<!-- Cocher si applicable. Si tout est coché et N/A, ajouter "N/A". -->

- [ ] Aucun secret en clair (vérifié `gitleaks` local)
- [ ] Aucune nouvelle dépendance sans Context7 vérifié
- [ ] Validation Zod sur toute nouvelle entrée utilisateur / API
- [ ] Vérification rôle (Admin / Member) côté serveur si action sensible
- [ ] Vérification `workspace_id` sur toute requête Prisma touchée
- [ ] Pas de PII / token dans logs ajoutés

## Performance / a11y

- [ ] Pas de régression LCP / INP perçue
- [ ] Composants UI : axe-core OK, focus visible, navigation clavier

## Captures (si UI)

<!-- Avant / Après -->

## Checklist finale

- [ ] CLAUDE.md ou progress.md mis à jour si décision technique / étape achevée
- [ ] ADR créée si choix architectural
