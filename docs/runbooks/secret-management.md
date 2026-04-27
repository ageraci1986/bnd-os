# Runbook — Gestion des secrets

> **Stratégie** : Vercel Encrypted Env (production + preview) + `.env.local` (dev local). Pas de Doppler / Infisical en V1.
> **Référence** : [docs/security.md §3](../security.md), [ADR 0002](../adr/0002-auth.md)

## Workflow d'ajout d'un nouveau secret

1. Définir le **nom** (UPPER_SNAKE_CASE), la **sensibilité** (🔴/🟠/🟡), et l'**owner**.
2. Ajouter la clé dans `.env.example` avec un commentaire explicatif. **Aucune valeur**.
3. Ajouter la validation Zod dans `apps/web/lib/env.ts`.
4. Ajouter le secret dans :
   - `.env.local` (dev local de chaque dev)
   - Vercel `Production` env
   - Vercel `Preview` env (placeholder ou valeur staging)
   - GitHub Actions secrets (placeholder pour build CI uniquement, jamais réel)
5. Si secret de production → entrée dans [`docs/security.md §3`](../security.md) (table inventaire) avec rotation.

## Règles dures

- **Jamais** de secret réel dans `package.json`, `.github/`, `docs/`, `mockups/`, ou tout fichier tracké.
- **Jamais** de secret en `NEXT_PUBLIC_*`. Si un secret semble nécessaire côté client, c'est une erreur de design — passer par un endpoint serveur.
- **Jamais** de secret dans une URL (les URLs sont loggées par Vercel et CDN).
- **Jamais** de secret dans un commentaire ou log.

## Outils

| Outil                                  | Rôle                                       |
| -------------------------------------- | ------------------------------------------ |
| `gitleaks`                             | Scan pre-commit + CI                       |
| `eslint` (rule custom)                 | Détecte `process.env.X` direct côté client |
| `next/env` validation via `lib/env.ts` | Échec build si manquant                    |
| Vercel Encrypted Env                   | Stockage runtime + chiffrement au repos    |

## Provisioning d'un nouvel environnement (Phase 1.5)

1. Créer le projet Supabase → noter URL, anon key, service-role key, JWT secret, DATABASE_URL
2. Créer le projet Resend → vérifier domaine `mail.nexushub.app`
3. Créer la base Upstash Redis → noter REST URL + TOKEN
4. Créer le projet Sentry → DSN
5. Créer Inngest workspace → event key + signing key
6. Créer Slack app + Azure AD app (Phase 6)
7. **Tout coller dans Vercel Env** (jamais Slack, jamais Drive, jamais email)
8. Tester `pnpm build` localement avec ces valeurs avant de déployer
