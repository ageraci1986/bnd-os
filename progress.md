# progress.md — NexusHub · Plan de développement

> **Dernière mise à jour :** 2026-04-27
> **Référent produit :** Angelo L.
> **Document maître produit :** [PRD-NexusHub.md](./PRD-NexusHub.md)
> **Document maître technique :** [CLAUDE.md](./CLAUDE.md)
>
> Ce fichier suit l'avancement **étape par étape**. Cocher les cases au fur et à mesure. Si une étape est bloquée, ajouter une note `> ⚠ Blocker:` en dessous.

---

## Légende

- `[ ]` à faire · `[x]` fait · `[~]` en cours · `[!]` bloqué · `[s]` skippé (avec justification)
- **Effort** : XS (< 0.5j) · S (0.5–1j) · M (1–3j) · L (3–7j) · XL (> 7j)

## Vue d'ensemble (jalons)

| Phase | Nom                                      | Effort cumulé | Statut |
| ----- | ---------------------------------------- | ------------- | ------ |
| 0     | Cadrage & fondations                     | M             | `[x]`  |
| 1     | Setup repo, CI/CD, sécurité de base      | M             | `[~]`  |
| 2     | Modèle de données + Auth                 | L             | `[~]`  |
| 3     | Design system + Shell applicatif         | L             | `[ ]`  |
| 4     | Module Clients & Contacts (RACI)         | M             | `[ ]`  |
| 5     | Module Projets (Kanban + règles auto)    | XL            | `[ ]`  |
| 6     | Module Communications (Slack + Exchange) | XL            | `[ ]`  |
| 7     | Templates (Email + Kanban)               | M             | `[ ]`  |
| 8     | Overview (Dashboard)                     | M             | `[ ]`  |
| 9     | Équipe, Paramètres, Notifications        | M             | `[ ]`  |
| 10    | i18n FR/EN                               | S             | `[ ]`  |
| 11    | Tests E2E + perfs + a11y                 | M             | `[ ]`  |
| 12    | Hardening sécurité + audit               | M             | `[ ]`  |
| 13    | Préparation release V1                   | S             | `[ ]`  |

---

## Phase 0 — Cadrage & fondations ✅ TERMINÉE (2026-04-27)

**Objectif :** Trancher les hypothèses du PRD §10 et figer les décisions structurantes avant d'écrire la moindre ligne de code applicatif.

- [x] **0.1** Validation des 15 hypothèses PRD §10 → [`docs/adr/0001-prd-hypotheses.md`](./docs/adr/0001-prd-hypotheses.md)
- [x] **0.2** ADR auth → **Supabase Auth** retenu → [`docs/adr/0002-auth.md`](./docs/adr/0002-auth.md)
- [x] **0.3** ADR base de données → **Supabase** retenu → [`docs/adr/0003-db.md`](./docs/adr/0003-db.md)
- [x] **0.4** ADR realtime → **Supabase Realtime** retenu → [`docs/adr/0004-realtime.md`](./docs/adr/0004-realtime.md)
- [x] **0.5** ADR jobs background → **Inngest** retenu → [`docs/adr/0005-jobs.md`](./docs/adr/0005-jobs.md)
- [x] **0.6** ADR design system → tokens depuis `mockups/styles.css` + Tailwind v4 + Radix → [`docs/adr/0006-design-system.md`](./docs/adr/0006-design-system.md)
- [ ] **0.7** Threat model détaillé STRIDE — sera affiné en Phase 12 avec audit final (squelette dans `docs/security.md`)
- [ ] **0.8** Provisioning comptes hébergement (Vercel, Supabase, Upstash, Resend, Sentry) → action utilisateur, à faire en Phase 1.5
- [ ] **0.9** Stratégie gestion secrets : **Vercel Encrypted Env** retenu pour V1 (simplicité + intégration native) → finalisation runbook en Phase 1.5

---

## Phase 1 — Setup repo, CI/CD, sécurité de base

**Objectif :** Un repo qui builde, qui teste, qui scanne les secrets, prêt à recevoir le premier feature commit.

### 1.1 Bootstrap monorepo

- [x] Init `pnpm` workspace + `turbo`
- [x] Créer arborescence `apps/web`, `packages/{db,domain,integrations,ui}`
- [x] Init Next.js 15 dans `apps/web` (App Router, TypeScript strict, Tailwind v4)
- [x] Configurer `tsconfig.base.json` partagé (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] Ajouter `.editorconfig`, `.nvmrc` (Node 22 LTS), `.npmrc`

### 1.2 Outillage qualité

- [x] ESLint flat config (`@typescript-eslint/strict` + `eslint-plugin-security` + Next plugin)
- [x] Prettier + `prettier-plugin-tailwindcss`
- [x] Husky + lint-staged (gitleaks + lint sur fichiers modifiés, pre-push typecheck+test)
- [x] commitlint + Conventional Commits (scopes définis)
- [x] Scripts root `pnpm dev | build | lint | typecheck | test | e2e | format | secrets:scan`

### 1.3 Tests

- [x] Vitest configuré (apps/web + packages/domain) avec coverage thresholds
- [x] Testing Library + `@testing-library/jest-dom`
- [x] Playwright configuré (`e2e/` workspace + smoke spec testant security headers)
- [x] MSW configuré pour mocker réseau
- [x] Premier test smoke (`<HomePage />` rend) + tests Kanban domain (15 cas)

### 1.4 Sécurité du pipeline

- [x] Pre-commit `gitleaks` (`.gitleaks.toml` avec rules custom Supabase/Slack/Resend)
- [x] CI GitHub Actions : `install`, `lint`, `typecheck`, `test`, `build`, `e2e`, `security` (gitleaks-action + audit + semgrep)
- [x] CodeQL workflow (analyse statique JS/TS)
- [x] Renovate configuré (auto-merge patch, lock file maintenance, vulnerability alerts)
- [x] Template PR (`.github/pull_request_template.md`) avec checklist sécurité
- [x] CODEOWNERS pour paths sensibles
- [ ] Branch protection sur `main` (à activer dans GitHub UI après push initial)

### 1.5 Docs initiales

- [x] `README.md` (description, setup local, scripts, liens vers PRD/CLAUDE/progress)
- [x] `.env.example` exhaustif (toutes les variables, **aucune valeur**)
- [x] `docs/api.md` (squelette + table endpoints + Server Actions)
- [x] `docs/security.md` (politique secrets, threat model STRIDE, inventaire secrets, RLS)
- [x] `docs/runbooks/secret-rotation.md`, `incident-response.md`, `secret-management.md`

---

## Phase 2 — Modèle de données + Auth

### 2.1 Schéma Prisma

- [x] Modèles : `Workspace`, `User` (mirror auth.users), `Membership` (avec rôle `admin|member`), `Invitation` (token_hash + expires_at)
- [x] Modèles : `Client`, `Contact` (RACI enum), `ClientChannelMapping` (Slack workspace-level)
- [x] Modèles : `Project` (archive_auto_done opt-in), `ProjectType`, `ProjectMember` (role lead/member)
- [x] Modèles : `Column` (avec `is_blocked_system`), `Card` (`previous_column_id`, `short_ref` auto), `CardAssignee`, `ChecklistItem`, `Comment`
- [x] Modèles : `KanbanTemplate` + `KanbanTemplateColumn`, `EmailTemplate`
- [x] Modèles : `Integration` (encrypted_tokens + key_version + scope workspace/user), `OAuthState`
- [x] Modèles : `Notification`, `PushSubscription`, `NotificationPreference`, `ActivityEvent`, `AuditLog` (append-only)
- [x] Modèles : `EmailMessage`, `SlackMessage` (Note V1.5)
- [x] Index sur `workspace_id`, `client_id`, `due_date`, `column_id`, `created_at` + uniques métier
- [x] **RLS Postgres** complet (`prisma/sql/02_rls_policies.sql`) — policies par workspace_id, Admin-only sur invitations/intégrations/audit
- [x] Triggers (`prisma/sql/03_triggers_and_constraints.sql`) : sync auth.users → public.users, last-Admin protection, garde Bloqué column unique, short_ref auto, updated_at générique
- [x] Soft delete (`deleted_at`) sur `Project`, `Card`, `Client`, `Contact`, `Comment`
- [x] Helpers Postgres (`prisma/sql/01_extensions_and_helpers.sql`) : `workspace_ids_for_current_user()`, `is_workspace_admin()`
- [x] Schéma validé via `prisma validate` + `prisma generate` OK
- [ ] Migration initiale appliquée sur Supabase staging (en attente — dépend de B)
- [ ] Seed dev (5 clients, 14 projets fictifs, types des mockups) — à écrire en Phase 2.3

### 2.2 Crypto utilitaire

- [x] `packages/domain/crypto` : AES-256-GCM `encryptString` / `decryptString` avec key versioning (rotation prête)
- [x] HMAC-SHA-256 `hmacSha256` / `verifyHmacSha256` (signature invitations, webhooks)
- [x] SHA-256 hex `sha256Hex` (token-at-rest)
- [x] `randomToken` (url-safe, 256-bit entropy)
- [x] `createInvitationToken` / `validateInvitationTokenShape` (token = random.hmac, hash en DB)
- [x] `timingSafeEqual` (constant-time string compare)
- [s] Argon2id wrapper : **délégué à Supabase Auth** (cf. ADR 0002) — pas d'implémentation NexusHub
- [x] **25 tests unitaires** : round-trip, IV unique, key rotation, GCM auth-tag, HMAC verification, token forgery, timing safety

### 2.3 Auth (Supabase Auth + flow invitation custom)

- [ ] Configurer Supabase project : `JWT expiry = 3600s`, `refresh token rotation = ON`, `reuse interval = 10s`
- [ ] Désactiver inscription publique côté Supabase (`enable_signup = false` dans dashboard, fallback DB trigger)
- [ ] Configurer SMTP custom Supabase → Resend (templates email FR/EN)
- [ ] Client Supabase server-side (`@supabase/ssr`) + helpers `getUser()`, `getSession()`
- [ ] Login email/password (rate limit Upstash 5/15min en plus de Supabase)
- [ ] Mot de passe oublié (`supabase.auth.resetPasswordForEmail`, rate limit 3/h)
- [ ] **Invitation flow custom** complet :
  - [ ] Endpoint Admin `POST /api/invitations` (rôle Admin requis, audit log)
  - [ ] Génération token random 256 bits + signature HMAC (clé `INVITATION_SECRET`)
  - [ ] Stockage `Invitation { email, role, workspace_id, token_hash (SHA-256), expires_at, consumed_at }`
  - [ ] Mail Resend avec lien `https://app.nexushub.app/signup/[token]`
  - [ ] Page `/signup/[token]` (valide / expiré / déjà utilisé)
  - [ ] Validation token → `supabase.auth.admin.createUser()` côté server-only avec service-role key + login automatique
  - [ ] Marquer invitation `consumed_at`, créer `Membership`, audit log
- [ ] Sessions Supabase : cookies httpOnly + Secure + SameSite=Lax (Lax requis pour callbacks)
- [ ] CSRF (double-submit) sur Server Actions et endpoints mutables
- [ ] `requireUser(req, role?)` middleware Next.js + RLS Postgres en complément
- [ ] **Tests** : login OK/KO, invitation valide/expirée/déjà-utilisée/forgée, rate limit, dernier-Admin protégé
- [ ] **Audit log** : login_success, login_failed, invitation_sent, invitation_accepted, member_removed, role_changed, password_reset

### 2.4 Headers & middleware sécurité

- [ ] `middleware.ts` : auth gating, CSP avec nonce, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [ ] `next.config.ts` : `poweredByHeader: false`, headers globaux
- [ ] Test : `npm audit` clean, `lighthouse-ci` security score ≥ 95

---

## Phase 3 — Design system + Shell applicatif

### 3.1 Design tokens

- [ ] Convertir variables CSS de `mockups/styles.css` en Tailwind v4 theme (`@theme`)
- [ ] Mode clair + sombre via `data-theme`
- [ ] Polices Plus Jakarta Sans via `next/font`
- [ ] Storybook 8 + theme provider + dark mode toggle

### 3.2 Composants UI primaires (Storybook)

- [ ] `Button` (primary / ghost / danger / icon, sm/md/lg)
- [ ] `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
- [ ] `Tag` (success/danger/warning/info/primary + variantes catégories)
- [ ] `TagClient` (5 couleurs)
- [ ] `BadgeAuto` (gradient violet/rose)
- [ ] `Avatar` (initiales + couleur)
- [ ] `ProgressBar` (success / warning / danger)
- [ ] `Card` / `CardSoft`, `MetricCard`
- [ ] `Modal` (avec backdrop blur)
- [ ] `Toast` (succès / erreur / info, lecteur d'écran)
- [ ] `Tooltip`, `DropdownMenu`, `Popover` (Radix)
- [ ] **Tests** : a11y (axe-core), visual regression (Chromatic) sur chaque composant

### 3.3 Shell

- [ ] `<Sidebar>` (brand, nav main, clients actifs, atelier, profil utilisateur)
- [ ] `<Topbar>` (search bar, theme toggle, notifications, "+ Nouveau projet")
- [ ] `<ContextBar>` (breadcrumb + chip client)
- [ ] `<AppLayout>` (grid sidebar + main, sticky topbar, glass effect)
- [ ] **Filtre client global** (Zustand store + URL `?client=<slug>`)
- [ ] Routing protégé `(app)` group avec `requireUser`
- [ ] Page 404, 500, accès refusé

### 3.4 Pages auth (login + signup invitation)

- [ ] Page `/login` (cf. mockup `01-login.html`)
- [ ] Page `/signup/[token]` (cf. mockup `02-signup.html`)
- [ ] Page `/forgot-password`
- [ ] Tests E2E : login OK/KO, signup avec lien valide/expiré

---

## Phase 4 — Module Clients & Contacts (RACI)

### 4.1 Domaine

- [ ] `packages/domain/clients` : règles RACI (un seul rôle par contact/projet, validation)
- [ ] Tests unitaires : création client, ajout contact, attribution RACI, suppression bloquée si projets actifs

### 4.2 UI

- [ ] Page `/clients` (liste cards + panneau fiche)
- [ ] Modal création / édition client (nom, couleur palette 5, canaux Slack à mapper)
- [ ] Table contacts avec RACI badges colorés
- [ ] Modal ajout / édition contact
- [ ] Soft delete + corbeille (visible Admin)

### 4.3 API

- [ ] Server Actions : `createClient`, `updateClient`, `deleteClient`, `addContact`, `updateContact`, `removeContact`, `setRACI`
- [ ] Validation Zod
- [ ] Tests integration

---

## Phase 5 — Module Projets (Kanban + règles auto)

### 5.1 Wizard nouveau projet (4 étapes)

- [ ] Étape 1 — infos générales (nom, client, description, dates)
- [ ] Étape 2 — type de projet (cards prédéfinies + création custom avec emoji picker)
- [ ] Étape 3 — sélection template Kanban (5 templates seed + Vide)
- [ ] Étape 4 — équipe + récapitulatif
- [ ] Server Action `createProject` (copie figée des colonnes du template)
- [ ] Tests E2E parcours 3 du PRD

### 5.2 Domaine — règles métier critiques

- [ ] `packages/domain/kanban`
  - [ ] `autoAdvanceCard(card, columns)` — règle 1.8s, dernière colonne, événements
  - [ ] `moveToBlocked(card, now)` — détection retard, mémorisation `previous_column_id`
  - [ ] `restoreFromBlocked(card, newDueDate)` — sortie auto
  - [ ] `archiveStaleCards(cards, now, 30j)` — candidats archivage
- [ ] **Tests unitaires exhaustifs** (timer mocké, scénarios coché/décoché/timing limite)

### 5.3 UI Kanban

- [ ] `<KanbanBoard>` avec @dnd-kit (drag & drop accessible clavier inclus)
- [ ] `<KanbanColumn>` configurable + colonne Bloqué non éditable (rouge, badge Auto)
- [ ] `<KanbanCard>` (titre, tag catégorie, échéance colorée, mini progress bar)
- [ ] Sélecteur projets en chips
- [ ] Toggle Kanban / Calendrier
- [ ] "+ Ajouter" (saisie rapide en bas de colonne)
- [ ] "+ Colonne" (avant Bloqué)
- [ ] Menu colonne ⋯ : renommer, déplacer L/R, supprimer (sauf Bloqué)
- [ ] Realtime sync (Supabase Realtime) pour DnD multi-user

### 5.4 Modal détail carte

- [ ] Titre éditable inline
- [ ] Tag catégorie + indication "→ {next} (auto si checklist complète)"
- [ ] Assignation membres (avatars + Add)
- [ ] Échéance + indicateur "à risque"
- [ ] Description multiligne (auto-save debounced 500ms)
- [ ] **Checklist** : add/check/uncheck/delete, progress bar live, bandeau vert "Checklist complète ✓", countdown 1.8s **annulable**
- [ ] Commentaires (avec ⌘+Enter)
- [ ] Bandeau alerte rouge si carte en Bloqué (avec CTA "Modifier l'échéance")
- [ ] Actions side : dupliquer, archiver, supprimer

### 5.5 Vue Calendrier

- [ ] Grille mensuelle (Lun-Dim)
- [ ] Navigation mois précédent/suivant + bouton "Aujourd'hui" + select mois/année
- [ ] Tâches positionnées sur due_date, clic → modal carte

### 5.6 Jobs background

- [ ] Inngest cron horaire : scan échéances dépassées → moveToBlocked
- [ ] Inngest cron quotidien : archivage cartes >30j en dernière colonne (si opt-in projet)
- [ ] Tests E2E parcours 4 du PRD (auto-bloqué)

---

## Phase 6 — Module Communications (Slack + Exchange)

### 6.1 Intégration Slack

- [ ] Setup app Slack (manifest, scopes mini : `channels:read`, `chat:write`, `users:read`)
- [ ] OAuth flow (state HMAC + nonce Redis TTL 10min)
- [ ] Stockage tokens chiffrés AES-256-GCM (`Integration` table, `key_version`)
- [ ] Refresh token rotation
- [ ] Webhook Events API : signature `X-Slack-Signature` vérifiée, timestamp < 5min
- [ ] Mapping canal ↔ client (UI workspace-level)
- [ ] Ingestion messages → table `SlackMessage` filtrée par client
- [ ] Envoi via `chat.postMessage` (attribution auteur NexusHub)
- [ ] Tests : signature webhook valide/invalide, mapping, ingestion, envoi

### 6.2 Intégration Microsoft Graph (Exchange)

- [ ] Setup app Azure AD (scopes mini : `Mail.Read`, `Mail.Send`, `User.Read`)
- [ ] OAuth délégué (par utilisateur) — chaque membre connecte sa boîte
- [ ] Stockage tokens chiffrés (idem Slack)
- [ ] Subscription Graph (webhook validation `validationToken` + `clientState`)
- [ ] Auto-association email → client (par domaine déclaré sur fiche client)
- [ ] Envoi via Graph `/sendMail`
- [ ] Tests integration

### 6.3 UI Communications

- [ ] Layout 2 panneaux (liste 380px + reader)
- [ ] Onglets Mails / Slack / Notes (Notes désactivé V1)
- [ ] Liste avec compteurs non lus + badge client coloré (mode tous clients)
- [ ] Reader : sujet, expéditeur, client, heure, corps
- [ ] Composer : recipients pills, CC, sélecteur template email, bouton Envoyer (⌘+Enter)
- [ ] Badge "Aide IA · V1.5" désactivé visuel
- [ ] Filtre client global appliqué automatiquement
- [ ] Tests E2E : envoyer un mail avec template, recevoir un Slack et répondre

---

## Phase 7 — Templates (Email + Kanban)

### 7.1 Templates Email

- [ ] Page `/templates/email`
- [ ] Liste + éditeur (objet + corps + variables cliquables)
- [ ] Variables : `{contact_name}`, `{client_name}`, `{project_name}`, `{sender_name}`, `{date}`
- [ ] Mode prévisualisation (variables remplacées par exemples)
- [ ] CRUD + duplication
- [ ] Sécurité : interdit le HTML brut dans le corps (sanitize côté serveur)

### 7.2 Templates Kanban

- [ ] Page `/templates/kanban`
- [ ] Sélecteur + CRUD templates
- [ ] Vue colonnes interactive (renommer inline, menu ⋯, +Colonne)
- [ ] Colonne Bloqué fixe non éditable
- [ ] **Test critique** : modifier un template **ne change pas** les projets existants

---

## Phase 8 — Overview (Dashboard)

- [ ] Bandeau de salutation contextuel (jour, prénom, métriques résumées)
- [ ] 6 métriques (projets actifs, mes tâches, Slack non lus, mails non lus, cartes bloquées en rouge, échéances aujourd'hui)
- [ ] Panneau "Tâches urgentes" (5 max, marker coloré, badge client)
- [ ] Panneau "Avancement projets" (barres + couleurs)
- [ ] Panneau "Activité récente" (feed avec badges Auto)
- [ ] Filtrage automatique par client actif
- [ ] Tests E2E : ouvrir Overview en mode tous-clients puis client, vérifier recalcul

---

## Phase 9 — Équipe, Paramètres, Notifications

### 9.1 Équipe & invitations (Admin only)

- [ ] Page `/team` (liste + invitations)
- [ ] Inviter (email + rôle), retirer, modifier rôle
- [ ] Protection dernier Admin
- [ ] Audit log

### 9.2 Paramètres utilisateur

- [ ] Langue FR/EN
- [ ] Fuseau horaire (Intl Timezone)
- [ ] Notifications push desktop on/off + granularité événements
- [ ] Notifications Slack on/off
- [ ] Profil (avatar, nom, mot de passe)
- [ ] Sauvegarde automatique avec toast

### 9.3 Notifications

- [ ] Service worker + Web Push (clé VAPID privée en env)
- [ ] Subscription par utilisateur, stockage chiffré
- [ ] Émetteur d'événements (`card.assigned`, `card.commented`, `card.blocked`, `email.new`, `slack.mention`)
- [ ] Slack DM bidirectionnel (option)

### 9.4 Intégrations

- [ ] Page `/integrations` (Admin pour Slack workspace, tous pour Exchange)
- [ ] Connect / Disconnect / Force sync / Settings
- [ ] Status badge (active / inactive / soon)

---

## Phase 10 — i18n FR/EN

- [ ] `next-intl` configuré, locales `fr.json` et `en.json`
- [ ] Toutes les chaînes UI extraites
- [ ] Pluriels et genres ICU
- [ ] Switch langue depuis Paramètres
- [ ] Tests : changement langue, dates formatées correctement

---

## Phase 11 — Tests E2E + perfs + a11y

- [ ] **5 parcours utilisateurs PRD §4** automatisés Playwright
- [ ] Parcours bonus : auto-progression checklist, auto-bloqué, mapping Slack
- [ ] Lighthouse CI : Perf ≥ 90, A11y ≥ 95, Best Practices ≥ 95, SEO ≥ 90
- [ ] axe-core sur chaque page principale (0 violation critique)
- [ ] Charge légère : 100 cartes/projet, 1000 cartes/workspace, vérifier latence < 200ms
- [ ] Coverage Vitest ≥ 80% lignes/branches sur `packages/domain`

---

## Phase 12 — Hardening sécurité + audit

- [ ] **Pen-test interne** : OWASP Top 10
  - [ ] Injection (SQL, XSS, command)
  - [ ] Broken Auth (session fixation, CSRF, brute force)
  - [ ] Sensitive Data Exposure (logs, erreurs, headers)
  - [ ] XXE / SSRF (intégrations externes)
  - [ ] Broken Access Control (multi-tenant leakage entre workspaces)
  - [ ] Misconfig (CSP, CORS, headers)
  - [ ] Vulnérables / outdated components
  - [ ] Insufficient Logging
- [ ] Vérification : aucun secret en clair dans repo, logs Sentry, build artifacts (recherche `gitleaks --redact` sur build)
- [ ] Vérification : aucun `NEXT_PUBLIC_*` n'expose de secret
- [ ] Vérification : tokens OAuth jamais dans réponses API (test automatisé)
- [ ] Vérification : RLS Postgres bloque cross-workspace (tests SQL avec rôle anon)
- [ ] Vérification : 100% des endpoints valident le rôle et le workspace
- [ ] Rotation initiale des secrets (preuve que la procédure marche)
- [ ] Sentry : `beforeSend` filtre PII testé
- [ ] SBOM généré + signé (cyclonedx)
- [ ] Documentation `docs/security.md` finalisée (threat model + mitigations + procédures)

---

## Phase 13 — Préparation release V1

- [ ] Migration DB de prod jouée en staging avec données représentatives
- [ ] Plan de rollback documenté (`docs/runbooks/rollback.md`)
- [ ] Monitoring Sentry + uptime configuré (alertes Slack)
- [ ] Page de status (statuspage.io ou similaire)
- [ ] Feature flags pour V1.5 (Aide IA, Notes IA, Email→Tâche, Vue par personne, Observateur)
- [ ] Charte de données / privacy policy / CGU validées (légal)
- [ ] DPA signé pour sous-traitants (Resend, Supabase, Vercel, Sentry, Upstash)
- [ ] Onboarding interne agence pilote (5 utilisateurs, 1 semaine de soak)
- [ ] Go/No-Go meeting → release production

---

## Hors V1 (V1.5 backlog)

| Item                                     | Source PRD     | Priorité |
| ---------------------------------------- | -------------- | -------- |
| Aide rédaction IA dans Communications    | §3             | High     |
| Intégration Notes IA (Fireflies / Otter) | §3             | Medium   |
| Conversion email → tâche (bouton)        | §3             | High     |
| Vue "Par personne" des tâches            | §3             | Medium   |
| Rôle Observateur (clients externes)      | §3             | High     |
| Notifications email                      | §3             | Medium   |
| Support mobile / tablette                | §3             | High     |
| 2FA utilisateur                          | CLAUDE.md §4.3 | High     |
| Recherche globale                        | PRD §11        | Medium   |
| Export PDF/CSV (fiche client, projet)    | PRD §11        | Low      |
| Pièces jointes mails                     | PRD §11        | High     |
| Multi-espace / multi-agence              | PRD §11        | Low      |

---

## Suivi des risques

| Risque                               | Probabilité | Impact | Mitigation                          | Owner         |
| ------------------------------------ | :---------: | :----: | ----------------------------------- | ------------- |
| Slack rate limits sur gros workspace |      M      |   M    | Backoff exponentiel + queue Inngest | _à attribuer_ |
| OAuth token leak via logs            |      L      |   XL   | Filtre Sentry + tests automatisés   | _à attribuer_ |
| Multi-tenant data leakage            |      L      |   XL   | RLS Postgres + tests anon role      | _à attribuer_ |
| Dépendance `better-auth` jeune       |      M      |   L    | ADR avec fallback Auth.js documenté | _à attribuer_ |
| Realtime Supabase coût/scale         |      M      |   M    | Mesure soak, fallback polling 5s    | _à attribuer_ |
| Microsoft Graph throttling           |      M      |   M    | Cache + delta queries               | _à attribuer_ |

---

## Journal d'avancement

| Date       | Phase | Étape   | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-27 | 0     | —       | Création du plan, analyse PRD + 14 mockups + design system. Aucune ligne de code écrite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-04-27 | 0     | 0.1–0.6 | 6 ADR créées (`docs/adr/0001`–`0006`). Décisions actées : Supabase Auth, Supabase DB, Supabase Realtime, Inngest, design tokens depuis mockups, 15 hypothèses PRD §10 tranchées.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-04-27 | 1     | 1.1–1.5 | **Bootstrap monorepo** : git init, pnpm workspaces + turbo, tsconfig.base strict, `apps/web` (Next 15 + RSC + middleware CSP/HSTS), `packages/{db,domain,integrations,ui}` squelettés. Logique métier Kanban/Checklist/Permissions/ClientFilter implémentée + tests Vitest. Outillage : ESLint flat (security rules), Prettier, Husky (pre-commit gitleaks + lint-staged, pre-push typecheck+test, commit-msg commitlint), Vitest + Playwright + MSW. Sécurité pipeline : `.gitleaks.toml`, GitHub Actions CI (install/lint/typecheck/test/build/e2e/security), CodeQL, Renovate, PR template, CODEOWNERS. Docs : README, `.env.example`, `docs/security.md`, `docs/api.md`, runbooks (secret-rotation, incident-response, secret-management). Commit `1eb54ba`. |
| 2026-04-27 | 1     | gates   | Gates verts : 5 typecheck, 5 lint, 23 tests passent. Fixes : suppression imports `.ts/.tsx` (Bundler resolution), accès `process.env['X']` (noPropertyAccessFromIndexSignature), `@vitejs/plugin-react` ajouté, ESLint deps mutualisées au root, override tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-04-27 | 2     | 2.1     | **Schéma Prisma complet** (~30 modèles, 8 enums) : Workspace/User/Membership/Invitation, Client/Contact/Channel mapping, Project/Column/Card/Checklist/Comment, Templates Email & Kanban, Integration/OAuthState, Notifications/Activity/AuditLog, EmailMessage/SlackMessage. RLS policies SQL (Admin-only sur invitations/intégrations/audit, member-CRUD sur le reste, encrypted_tokens column-revoked). Triggers : sync auth.users → public.users, last-Admin protection, garde colonne Bloqué unique, Card.short_ref auto. `prisma validate` + `prisma generate` OK.                                                                                                                                                                                         |
| 2026-04-27 | 2     | 2.2     | **Crypto utilities** dans `packages/domain/crypto` : AES-256-GCM avec key-versioning, HMAC-SHA-256, SHA-256, random tokens 256-bit, invitation token (random.hmac + sha256), constant-time compare. **25 tests** : round-trip, key rotation, GCM auth-tag tampering, HMAC forgery, token shape forgery. Argon2id délégué à Supabase Auth.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-04-27 | —     | docs    | Runbook `docs/runbooks/supabase-setup.md` (provisioning Supabase staging pas-à-pas) ajouté pour parallèle utilisateur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

> **Règle :** chaque session de travail ajoute une ligne ici (ou plusieurs si plusieurs étapes touchées).
