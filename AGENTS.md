# AGENTS.md — NexusHub

> Guide opérationnel pour tout assistant (Codex, IA, dev humain) travaillant sur le projet **NexusHub**.
> Ce fichier est le **contrat de qualité, sécurité et architecture**. Il doit être lu avant toute action sur le code et **mis à jour à chaque évolution structurante**.
>
> **Document source produit :** [PRD-NexusHub.md](./PRD-NexusHub.md) · **Maquettes** : [mockups/](./mockups/)
> **Suivi d'avancement :** [progress.md](./progress.md)

---

## 1. Vision technique

NexusHub est une **agency OS** (gestion de projet + communications + connaissance client) destinée aux agences de 5–20 personnes, jonglant entre plusieurs clients. La plateforme doit être :

- **Sécurisée par défaut** — aucun secret en clair, chiffrement au repos des tokens externes, rotation possible.
- **Temps réel** — Kanban, checklist, communications doivent se synchroniser sans recharger.
- **Bilingue (FR/EN)** dès la V1.
- **Desktop-first** (V1), avec un design system propre permettant un portage mobile en V1.5.
- **Testable** — 100% du domain métier et des API exposées doit être couvert par des tests.

---

## 2. Stack technique (validée pour la V1)

> Toute proposition de modification de la stack doit faire l'objet d'une décision ADR documentée dans [docs/adr/](./docs/adr/) avant implémentation.

### Frontend

- **Next.js 15** (App Router, RSC, Server Actions) + **React 19**
- **TypeScript** en mode `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Tailwind CSS v4** avec design tokens importés depuis `mockups/styles.css` (mappés en variables CSS et tokens Tailwind)
- **Radix UI** (primitives accessibles) + composants custom calqués sur les mockups
- **@dnd-kit/core** pour le Kanban (drag & drop accessible)
- **TanStack Query** v5 pour le data fetching client
- **Zustand** (UI state global léger : modal stack, theme, client filter)
- **React Hook Form** + **Zod** (formulaires + validation partagée client/serveur)
- **Framer Motion** pour micro-animations (countdown auto-move, modals)
- **next-intl** (FR/EN avec ICU MessageFormat)

### Backend & data

- **Supabase** = plateforme unique BaaS choisie pour V1 (PostgreSQL 16 managé + Auth + Realtime + Storage + Edge Functions)
- **Prisma 6** ORM + migrations versionnées (`prisma/migrations/`) — appliquées sur Supabase via `db push` en dev, via CI/CD en staging/prod
- **Supabase Auth** (gotrue) pour identité, sessions, invitations magic-link, MFA prêt V1.5
- **Supabase Realtime** (broadcast + presence) pour Kanban, checklist, communications
- **Supabase Storage** pour avatars (V1) et pièces jointes (V1.5)
- **Resend** (emails transactionnels — invitations custom, alertes)
- **Inngest** (jobs background : scan d'échéances, archivage 30j, sync OAuth refresh)
- **Upstash Redis** (rate limiting, cache éphémère, OAuth state nonces, idempotency keys)

> **Note Auth :** Supabase Auth est utilisé pour la couche identité, mais le **flow d'invitation custom** (avec lien signé HMAC + Resend) reste géré côté NexusHub pour contrôler le contenu de l'email, l'expiration (72h) et l'audit log. Supabase fournit la session une fois le mot de passe défini par l'invité.

### Intégrations externes

- **Slack** : `@slack/bolt` (OAuth 2.0 + Events API + signing secret)
- **Microsoft Graph** : `@microsoft/microsoft-graph-client` (OAuth 2.0 délégué pour Exchange)
- **Web Push** : `web-push` + Service Worker

### Qualité & DX

- **ESLint** (`next/core-web-vitals`, `@typescript-eslint/strict`, `eslint-plugin-security`, `eslint-plugin-react-hooks`)
- **Prettier** + **prettier-plugin-tailwindcss**
- **Husky** + **lint-staged** + **commitlint** (Conventional Commits)
- **Vitest** (unit + integration) — **Playwright** (E2E)
- **Storybook** 8 (composants UI isolés, visual regression via Chromatic)
- **gitleaks** pre-commit (scan secrets)
- **Renovate** ou **Dependabot** (mises à jour automatisées + audit)

### Hébergement

- **Vercel** (front + edge + serverless) — projet `nexushub`
- **Supabase** (DB managée + Auth + Realtime + Storage) — projet `nexushub-prod` + `nexushub-staging`
- **Upstash** (Redis serverless) — base `nexushub-prod`
- **Sentry** (monitoring erreurs + tracing) — projet `nexushub-web`
- **Resend** (transactional email) — domaine vérifié `mail.nexushub.app` (à acquérir)
- **Better Stack** ou **Axiom** (logs structurés) — à finaliser en Phase 13

### Outils Context7 obligatoires

> Avant **toute** installation / mise à jour de dépendance, interroger Context7 MCP pour valider la version, les peer deps, les breaking changes et la compatibilité TypeScript.

---

## 3. Architecture du repo

```
nexushub/
├── apps/
│   └── web/                      # Next.js 15 (frontend + API routes)
│       ├── app/                  # App Router
│       │   ├── (auth)/           # Login, signup invitation, forgot
│       │   ├── (app)/            # Routes authentifiées
│       │   │   ├── overview/
│       │   │   ├── projects/
│       │   │   ├── communications/
│       │   │   ├── clients/
│       │   │   ├── templates/
│       │   │   ├── team/
│       │   │   ├── settings/
│       │   │   └── integrations/
│       │   ├── api/              # Route handlers (REST minimal + webhooks)
│       │   │   ├── webhooks/slack/
│       │   │   └── webhooks/graph/
│       │   └── layout.tsx
│       ├── components/           # UI atoms / molecules / templates
│       ├── features/             # Feature folders (kanban, checklist, raci…)
│       ├── lib/                  # Server-side utilities (auth, db, crypto)
│       ├── hooks/                # React hooks réutilisables
│       ├── stores/               # Zustand stores
│       ├── locales/              # FR / EN
│       └── styles/
├── packages/
│   ├── db/                       # Prisma schema + migrations + seed
│   ├── domain/                   # Domain logic pure TypeScript (testable)
│   │   ├── kanban/               # Auto-move, blocked column, archivage
│   │   ├── checklist/            # Progression rules
│   │   ├── client-filter/        # Filtre client global
│   │   └── permissions/          # RBAC Admin / Membre
│   ├── integrations/             # Adapters Slack / Graph (factices testables)
│   └── ui/                       # Design system (Storybook)
├── docs/
│   ├── adr/                      # Architecture Decision Records
│   ├── security.md               # Threat model, runbooks
│   ├── api.md                    # Contrats d'API
│   └── runbooks/                 # Procédures (rotation secret, incident)
├── infra/
│   ├── github-actions/
│   └── supabase/                 # Policies RLS
├── e2e/                          # Playwright
├── .env.example                  # Aucune valeur réelle
├── AGENTS.md                     # ← Ce fichier
├── PRD-NexusHub.md
├── progress.md
└── README.md
```

**Règle d'or** : la **logique métier (`packages/domain`)** est **pure TypeScript**, sans dépendance Next/Prisma. Elle est testée à 100%.

---

## 4. Sécurité — règles non négociables

> **Toute violation de cette section bloque le merge.** Les revues de code doivent vérifier ces points en priorité.

### 4.1 Secrets & variables d'environnement

1. **Aucun secret en clair** dans le code, les commits, les logs, les messages d'erreur, les commentaires, les screenshots.
2. Toutes les valeurs sensibles passent par `process.env.X` côté serveur **uniquement**. **Jamais** de `NEXT_PUBLIC_*` pour un secret.
3. Le fichier `.env.example` liste **les clés** (sans valeurs) avec un commentaire explicatif. `.env.local`, `.env.production` sont dans `.gitignore`.
4. Secrets de production : **Vercel Encrypted Env** (ou Doppler / Infisical). Rotation **trimestrielle** documentée dans `docs/runbooks/secret-rotation.md`.
5. Pre-commit hook **gitleaks** obligatoire. CI bloque tout commit contenant un pattern de secret.
6. Chaque secret a un **owner** (humain) et une **date d'expiration** documentés.

### 4.2 Tokens OAuth (Slack, Microsoft Graph)

1. Les access/refresh tokens externes sont **chiffrés AES-256-GCM** avant stockage en DB. Clé de chiffrement (`ENCRYPTION_KEY`) gérée via env, jamais commitée, rotation possible (versioning `key_version` dans la table).
2. **Jamais** retourner un token externe dans une réponse API, un log, une erreur, un événement de monitoring.
3. **Refresh token rotation** : à chaque refresh, l'ancien est révoqué, le nouveau remplace en transaction.
4. State OAuth (param `state`) signé HMAC + nonce single-use stocké Redis (TTL 10min) pour prévenir CSRF.
5. Scopes OAuth **minimaux** pour Slack et Graph. Documentés dans `docs/security.md`.
6. Webhook Slack : vérification **signature** (`X-Slack-Signature`) + timestamp (rejet si > 5 min). Webhook Graph : validation `validationToken` + `clientState`.

### 4.3 Authentification utilisateur

1. **Supabase Auth** gère le hashage des mots de passe (bcrypt côté Supabase, conforme OWASP) et les sessions JWT. Configurer `JWT expiry = 1h`, `refresh token rotation = ON`, `reuse interval = 10s`.
2. Sessions côté NexusHub : cookies **httpOnly + Secure + SameSite=Lax** (Lax requis pour OAuth callbacks ; les Server Actions critiques exigent un token CSRF double-submit en plus).
3. **Token d'invitation custom** : signé HMAC SHA-256, **single-use**, expire en **72h** (décision ADR 0001), invalidé après usage. Stocké **hashé** (SHA-256) en DB. Le lien email contient le token clair, jamais loggé.
4. Une fois l'invitation acceptée, on appelle `supabase.auth.admin.createUser()` côté serveur, puis on signe immédiatement le user avec le mot de passe défini.
5. Rate limiting (Upstash Redis + middleware) :
   - login : 5 tentatives / IP / 15 min (en plus du rate limit Supabase)
   - reset password : 3 / email / heure
   - invitation : 20 / Admin / jour
   - signup via invitation : 5 / token / heure
6. **CSRF** : double-submit cookie pour Server Actions et endpoints mutables. Origin/Referer validés.
7. **2FA** : Supabase Auth supporte TOTP nativement, activation prévue V1.5 via Settings.
8. **JWT verification côté serveur** : toujours vérifier la signature avec la clé Supabase (`SUPABASE_JWT_SECRET`) avant d'autoriser une requête. **Jamais** faire confiance à un user_id côté client.

### 4.4 Autorisations (RBAC)

1. Toute requête (API + Server Action) passe par un **`requireUser(req, role?)`** qui charge la session, vérifie le rôle (`Admin` | `Member`) et le **workspace_id**.
2. Toutes les requêtes Prisma incluent **systématiquement** `where: { workspace_id }` (pas de fuite multi-tenant). Validé par lint custom + revue.
3. **Row Level Security PostgreSQL** activé sur toutes les tables, policies par `workspace_id`.
4. Capacités sensibles (inviter / retirer membre, gérer intégrations, supprimer client/projet) → `Admin` uniquement, vérifié serveur **et** UI cachée.
5. **Dernier Admin protégé** : impossible de retirer / dégrader le seul Admin restant (validation domain + DB constraint).

### 4.5 Validation & échappement

1. **Zod schemas** pour 100% des entrées (forms, API bodies, query params, headers custom). Schémas partagés client/serveur.
2. Aucune concaténation SQL, **uniquement** Prisma / requêtes paramétrées. `$queryRawUnsafe` interdit (lint rule).
3. Sortie HTML : React échappe par défaut. `dangerouslySetInnerHTML` interdit sauf cas validé par revue de sécurité avec **DOMPurify**.
4. Téléchargements / pièces jointes (V1.5) : scan antivirus + content-type validé + nom de fichier sanitisé.

### 4.6 Headers HTTP & transport

- HTTPS only (HSTS `max-age=31536000; includeSubDomains; preload`)
- CSP stricte (script-src 'self' nonce-X, pas d'`unsafe-inline`)
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` désactivant tout sauf le strict nécessaire (notifications)
- Configurés dans `middleware.ts` + `next.config.ts`

### 4.7 Logs & PII

1. Aucune **PII** (email, nom, contenu de message, token) dans les logs applicatifs. Toujours hashed/redacted.
2. Logs structurés (JSON) avec `request_id`, `workspace_id`, `user_id` (ID interne, pas email).
3. Audit log immuable (table `audit_log`, append-only) pour : login, invitation, retrait membre, connexion intégration, suppression client/projet, changement de rôle.
4. Sentry : `beforeSend` filtre PII (email, password, tokens) avant envoi.

### 4.8 Pipeline & dépendances

- `npm audit --audit-level=high` bloquant en CI
- **Snyk** ou **Socket** scan SCA hebdo
- **Semgrep** rules custom (interdit `eval`, `exec`, `Function()`, `child_process` sans whitelist)
- Renovate auto-merge sur patch, review humaine sur minor/major
- SBOM généré à chaque release (`cyclonedx`)

---

## 5. Standards de qualité de code

### 5.1 TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- **Aucun `any` implicite**. `any` explicite interdit sauf justification (commentaire `// any: <raison>`)
- **Pas de `// @ts-ignore`** sans `// @ts-expect-error <reason>`
- Types domain dans `packages/domain` ; types DTO dans `packages/db` (générés Prisma + Zod)

### 5.2 Architecture

- **Domain logic pure** dans `packages/domain` — aucune dépendance externe (testable sans setup)
- **Adapters** pour intégrations externes (pattern hexagonal léger)
- **Server Actions** pour mutations simples ; **Route Handlers** pour webhooks et clients tiers
- **RSC par défaut**, `'use client'` uniquement quand nécessaire (interactivité, hooks)

### 5.3 Composants UI

- Composants **purs** quand possible. Logique métier dans hooks ou domain.
- Props typées, `children` explicite si présent.
- Accessibilité : labels, `aria-*`, focus visible, navigation clavier, contraste WCAG AA (Lighthouse a11y ≥ 95).
- **Storybook story** obligatoire pour chaque composant UI partagé.

### 5.4 Tests

- **Unit (Vitest)** : domain à 100%, hooks et utilitaires côté UI à 80%+
- **Integration** : Server Actions et Route Handlers (Prisma test DB via Testcontainers ou DB de test)
- **E2E (Playwright)** : 5 parcours utilisateurs du PRD §4 (bonus : auto-bloqué, auto-progression)
- **Visual regression** : Chromatic sur les composants critiques (Kanban card, modal carte, métriques Overview)
- **Coverage** : seuil 80% lignes/branches sur `packages/domain` ; 70% global. Bloque le merge en dessous.
- Tests **isolés** : pas de dépendance à l'ordre, mocks réseau via MSW.

### 5.5 Style

- ESLint + Prettier exécutés en pre-commit
- Imports triés (`eslint-plugin-import`)
- Pas de barrel files géants (`index.ts` qui re-exporte tout) — performance bundling
- Nommage : `kebab-case` pour fichiers, `PascalCase` pour composants/types, `camelCase` pour fonctions/vars
- Une fonction = une responsabilité ; signatures < 5 paramètres (sinon objet)

### 5.6 Commits & PR

- **Conventional Commits** : `feat(kanban): add auto-move countdown`
- PR < 400 lignes diff (cible). Si plus, scinder.
- Template PR : Contexte / Changements / Tests / Risques sécurité / Screenshots
- 1 reviewer minimum sur PR critique (auth, intégrations, permissions). 2 sur la sécurité.

---

## 6. Règles métier critiques (à ne jamais casser)

> Issues du PRD §8 et des maquettes. Toute modification d'une de ces règles **doit** mettre à jour PRD + tests + ce fichier.

### 6.1 Filtre client global

- Sélection d'un client → **toutes** les vues (Overview, Projets, Communications, Tâches) se recomposent.
- Chip client **persistante** dans la barre de contexte tant que filtre actif.
- État stocké en URL (`?client=<slug>`) **et** Zustand pour cohérence inter-onglets.
- Test E2E obligatoire : naviguer entre 3 sections en gardant le filtre.

### 6.2 Auto-progression checklist

- Délai exact : **1800 ms** (1,8 s).
- Décocher un item **avant** la fin du délai → annulation du déplacement, bandeau disparaît.
- Carte en **dernière colonne** → reste, candidate à archivage **30 jours** plus tard (job Inngest quotidien).
- Événement émis : `card.auto_advanced` avec badge violet "Auto" dans l'activité.
- Test unitaire domain : timer mocké, scénarios coché/décoché/coché-puis-décoché.

### 6.3 Colonne "Bloqué"

- **Toujours présente**, jamais éditable, jamais supprimable, jamais déplaçable (contrainte DB + UI désactivée).
- Une carte y entre **automatiquement** si `due_date < now()` ET pas dans la dernière colonne.
- Repousser l'échéance → la carte **sort automatiquement** de Bloqué et retourne en `previous_column_id` (mémorisé).
- Job Inngest cron **toutes les heures** : scan global des échéances dépassées par workspace.
- Métrique Overview "Cartes bloquées" = `COUNT WHERE in_blocked_column AND workspace_id = X`. Affichage rouge si > 0.

### 6.4 Templates Kanban

- Un template est **figé au moment de la création du projet**. Modifier un template **n'impacte pas** les projets existants.
- Implémentation : copy-on-create des colonnes du template vers le projet.

### 6.5 Slack bidirectionnel

- Message reçu sur canal mappé → ingéré côté NexusHub via Events API.
- Réponse depuis NexusHub → publiée sur le canal Slack via `chat.postMessage` avec attribution claire (auteur NexusHub).
- Mapping canal ↔ client au niveau **workspace** (pas par utilisateur).

### 6.6 RACI

- 4 valeurs : **R** (Responsable, bleu) / **A** (Approbateur, ambre) / **C** (Consulté, vert) / **I** (Informé, gris).
- Un contact peut avoir une seule valeur RACI par projet (à confirmer hypothèse PRD §10).

### 6.7 Permissions

| Capacité                         | Admin |    Membre     |
| -------------------------------- | :---: | :-----------: |
| Accès projets/clients            |   ✓   |       ✓       |
| CRUD projets/clients/templates   |   ✓   |       ✓       |
| Inviter/retirer membre           |   ✓   |       ✗       |
| Gérer intégrations workspace     |   ✓   |       ✗       |
| Connecter son propre Exchange    |   ✓   | ✓ (à valider) |
| Modifier ses propres préférences |   ✓   |       ✓       |

---

## 7. Performance

- **LCP < 2.5s** sur page la plus lourde (Overview avec données réelles)
- **INP < 200ms** sur interactions Kanban
- Bundle JS initial < 200 KB gzip
- Images : `next/image` + AVIF/WebP, lazy par défaut
- Requêtes Prisma : `select`/`include` explicites (jamais de full row sans raison) ; index sur `workspace_id`, `client_id`, `due_date`, `column_id`
- Server Components first ; Client Components seulement quand nécessaire
- Realtime : abonnements scopés (`channel:project:<id>`), debounce updates locales (50ms)

---

## 8. Internationalisation

- Locales : `fr` (défaut) et `en`
- Tous les textes UI passent par `useTranslations()` (`next-intl`)
- Dates : `Intl.DateTimeFormat` avec timezone utilisateur (param Settings)
- Pluriels et genres gérés via ICU MessageFormat
- Le contenu utilisateur (noms, descriptions, commentaires) **n'est pas traduit**

---

## 9. Hypothèses PRD §10 — **DÉCIDÉES** (2026-04-27)

Validées par Angelo L. le 2026-04-27. Décisions formalisées dans [`docs/adr/0001-prd-hypotheses.md`](./docs/adr/0001-prd-hypotheses.md).

| #   | Hypothèse                                  | Décision actée                                                                 |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| 1   | Durée validité lien d'invitation           | **72h**                                                                        |
| 2   | Archivage carte dernière colonne après 30j | **OUI, opt-in par projet**                                                     |
| 3   | Navigation calendrier                      | **Précédent/Suivant + bouton "Aujourd'hui" + sélecteur mois/année**            |
| 4   | Bandeau alerte carte en Bloqué             | **OUI, rouge, en tête du modal, CTA "Modifier l'échéance"**                    |
| 5   | Rôles projet (étape 4 wizard)              | **Lead / Member**                                                              |
| 6   | Modification rôle membre existant          | **OUI, Admin uniquement**                                                      |
| 7   | Protection dernier Admin                   | **OUI, contrainte DB + UI**                                                    |
| 8   | Gestion intégrations par Membre            | **Slack = Admin (workspace) ; Exchange = délégué (chacun connecte sa boîte)**  |
| 9   | Profil utilisateur                         | **OUI : avatar, nom/prénom, changement mot de passe dans Settings**            |
| 10  | Sauvegarde Paramètres                      | **Automatique avec toast de confirmation**                                     |
| 11  | Types événements notifiables               | **Liste fixe V1, granularité on/off par type**                                 |
| 12  | Niveau accessibilité                       | **WCAG 2.1 AA**                                                                |
| 13  | Navigateurs supportés                      | **Chrome, Edge, Firefox, Safari — 2 dernières versions stables**               |
| 14  | Suppression client avec projets actifs     | **Interdite, message d'erreur explicite avec lien vers les projets concernés** |
| 15  | Suppression projet                         | **Soft delete + corbeille 30 j, restauration Admin**                           |

---

## 10. Procédure pour Codex (et tout assistant IA)

### Lancer une nouvelle feature (ou sous-feature significative)

> 🚨 **OBLIGATOIRE — AVANT TOUTE LIGNE DE CODE.** Dès qu'une nouvelle feature
> (ou sous-feature non triviale) est lancée, **invoquer la skill
> `superpowers:brainstorming`**. Pas de raccourci : même pour ce qui paraît
> simple, le brainstorm fait émerger le scope, les hypothèses cachées, les
> alternatives, et produit un spec validé dans `docs/superpowers/specs/`.
>
> Le flow est : `superpowers:brainstorming` → spec validé par l'utilisateur →
> `superpowers:writing-plans` → plan d'implémentation → worktree isolé →
> exécution (subagent-driven-development ou inline).
>
> Quand l'utilisateur dit « créons une nouvelle branche pour X » ou
> « j'aimerais intégrer Y », invoquer le brainstorming est la première
> action — pas créer la branche tout de suite.

Avant chaque action :

1. **Lire ce fichier** + les sections pertinentes du PRD + l'état dans `progress.md`.
2. Si tâche > 3 étapes : **TodoWrite**.
3. **Avant install d'un package** : interroger Context7 MCP (version, breaking changes, peer deps).
4. **Avant écriture de code** : vérifier qu'il n'existe pas déjà (chercher dans `packages/domain` et `components/`).
5. **Tests d'abord** sur logique métier (TDD encouragé).
6. **Pas de secret écrit en dur**, jamais. Si un secret manque dans `.env`, demander à l'utilisateur, ne pas inventer.
7. **Mettre à jour `progress.md`** dès qu'une étape est complétée (status, notes, blockers).
8. **Mettre à jour ce AGENTS.md** dès qu'une décision technique est prise (nouvelle dep, nouveau pattern, nouveau risque).

### Garde-fous

- Refuser d'implémenter une fonctionnalité qui contournerait une règle de la section 4 (sécurité).
- Refuser de désactiver un test, un lint ou un type-check pour faire passer du code.
- Refuser de stocker un secret côté client.
- Si un endroit de la stack semble flou (ex: choix d'auth, choix de DB), ouvrir une **ADR** dans `docs/adr/` et demander validation utilisateur avant de coder.

---

## 11. Journal des évolutions de ce document

| Date       | Modification                                                                                                           | Auteur            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 2026-04-27 | Création initiale (analyse PRD + mockups)                                                                              | Codex (Opus 4.7)  |
| 2026-04-27 | Décisions actées : Supabase (DB + Auth + Realtime + Storage), pnpm + turbo, 15 hypothèses PRD validées                 | Angelo L. + Codex |
| 2026-05-28 | §10 — règle obligatoire : invoquer `superpowers:brainstorming` avant toute nouvelle feature                            | Angelo L. + Codex |
| 2026-07-15 | Adapter IMAP générique (Communications iter 2) + sanitize partagé + tokens design system respectés                     | Angelo L. + Codex |
| 2026-07-16 | Mail send V1 (Communications iter 3) — Graph + IMAP SMTP + drafts + signatures + outbox pattern                        | Angelo L. + Codex |
| 2026-07-17 | Mail attachments V1.5 (Communications iter 4) — Storage + ClamAV self-hosted + Forward reprise + hasAttachments denorm | Angelo L. + Codex |

> **Règle :** chaque modification de ce fichier ajoute une ligne ici.
