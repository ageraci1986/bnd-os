# NexusHub

> **Agency OS** — gestion projet + communications + connaissance client (Client › Projet › Tâche).
> Pour agences de 5–20 collaborateurs.

📚 **Documents de référence**

| Fichier                                | Rôle                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| [PRD-NexusHub.md](./PRD-NexusHub.md)   | Cahier des charges fonctionnel (V1)                                 |
| [CLAUDE.md](./CLAUDE.md)               | **Contrat technique, sécurité, qualité** — à lire avant tout commit |
| [progress.md](./progress.md)           | Suivi d'avancement par phase et étape                               |
| [docs/adr/](./docs/adr/)               | Architecture Decision Records                                       |
| [docs/security.md](./docs/security.md) | Threat model + procédures sécurité                                  |
| [docs/runbooks/](./docs/runbooks/)     | Procédures opérationnelles                                          |
| [mockups/](./mockups/)                 | Maquettes HTML de référence (design system source)                  |

---

## 🚀 Setup local

### Prérequis

- **Node.js 22+** (`nvm use` lit `.nvmrc`)
- **pnpm 9+** (`npm i -g pnpm@9`)
- **gitleaks** (recommandé) : `brew install gitleaks`
- Un projet **Supabase** dev provisionné (Phase 1.5)

### Installation

```bash
# 1. Cloner et installer
pnpm install

# 2. Copier l'environnement et remplir les valeurs
cp .env.example .env.local

# 3. Initialiser Husky (post-install runs `prepare`)
pnpm prepare

# 4. (Phase 2+) Générer le client Prisma + appliquer migrations
pnpm db:generate
pnpm db:migrate

# 5. Lancer en dev
pnpm dev
```

### Scripts principaux

| Script              | Description                                    |
| ------------------- | ---------------------------------------------- |
| `pnpm dev`          | Tous les workspaces en dev (Next.js sur :3000) |
| `pnpm build`        | Build de production                            |
| `pnpm lint`         | ESLint sur tout le repo (max-warnings=0)       |
| `pnpm typecheck`    | TypeScript sur tout le repo                    |
| `pnpm test`         | Tests Vitest (unit + integration)              |
| `pnpm e2e`          | Tests Playwright (E2E)                         |
| `pnpm format`       | Formattage Prettier                            |
| `pnpm secrets:scan` | Scan gitleaks local                            |
| `pnpm db:studio`    | Prisma Studio                                  |

---

## 🏗 Structure

```
nexushub/
├── apps/
│   └── web/              # Next.js 15 (App Router)
├── packages/
│   ├── db/               # Prisma schema + client
│   ├── domain/           # Logique métier pure (testée à 100 %)
│   ├── integrations/     # Adapters Slack, Graph, Resend
│   └── ui/               # Design system (Storybook)
├── e2e/                  # Playwright
├── docs/                 # ADR, security, runbooks
└── mockups/              # Maquettes HTML (référence design)
```

---

## 🔒 Règles d'or

1. **Aucun secret en clair** — jamais. `gitleaks` bloque pre-commit.
2. **Aucun `NEXT_PUBLIC_*`** ne contient un secret.
3. Toute requête Prisma inclut `where: { workspace_id }`.
4. Toute Server Action critique vérifie le rôle (Admin/Member) côté serveur.
5. RLS Postgres activée sur 100 % des tables.
6. Tests obligatoires sur la logique métier (`packages/domain` à 80 %+).
7. **Avant install d'un package** : Context7 MCP pour vérifier version + breaking changes.

Voir [CLAUDE.md](./CLAUDE.md) pour le détail.

---

## 📋 État du projet

Voir [progress.md](./progress.md). Phase courante : **Phase 1 — Setup repo, CI/CD, sécurité de base**.
