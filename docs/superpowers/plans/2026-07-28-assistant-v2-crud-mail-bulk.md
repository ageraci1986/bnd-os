# Plan 5b — Assistant V2 : CRUD clients/contacts, équipe, templates, mails en masse

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'agent couvre le reste du CRUD (clients/contacts, équipe admin-only, templates Kanban) et les opérations mail en masse (lu/non-lu, archiver, supprimer — boîtes de l'utilisateur uniquement), avec les mêmes garanties que le Plan 5a : lecture-après-écriture, confirmations gated véridiques (safeParse input brut + scope), audit.

**Architecture:** Cores extraits iso-comportement des Server Actions form-based (clients/contacts/équipe), réutilisation des cores templates existants, nouveaux cores mail-state (owner-only, bulk borné). Tools = couches de traduction dans `lib/assistant/tools/` (nouveaux fichiers `client-tools.ts`, `team-tools.ts`, `template-tools.ts` + extension `mail-tools.ts`). Première utilisation du flag `adminOnly` du registry (équipe). Une migration DB (enum AuditAction + `EmailMessage.archivedAt`).

**Tech Stack:** TypeScript strict, Zod, Prisma, Vitest. Aucune nouvelle dépendance. **Une migration** (à appliquer sur Supabase staging avant merge — convention repo).

**Spec :** `docs/superpowers/specs/2026-07-28-assistant-v2-widgets-crud-design.md` §5 (lignes clients/contacts, équipe, templates, mails)

**Branche :** `feat/assistant-v2-crud-bulk`, depuis `main` **après merge de la PR #13** (sinon : stopper et demander).

**Écarts spec assumés (à reporter dans la PR) :**

- `set_project_raci` (spec) → **`set_contact_raci`** : le modèle de données réel porte le RACI **globalement sur le Contact** (`Contact.raci`, pas de table RACI-par-projet). Créer un RACI par projet serait une feature produit séparée, hors périmètre.
- `archive_mail` / `delete_mail` sont **locaux à NexusHub** (champ `archivedAt` nouveau / `deletedAt` existant) — pas de synchronisation retour IMAP/Graph (le mail reste sur le serveur d'origine). Les descriptions des tools le disent explicitement.
- Templates : CRUD ouvert aux Membres (CLAUDE.md §6.7) — pas d'`adminOnly`, mais `delete_template` gated ⚡.

**Conventions transverses (identiques au Plan 5a) :** commits conventionnels (scopes `assistant`/`projects`/`db`) ; `ctx` en closure ; textes user-safe uniquement (`failure()`/`safeMutation`/`safeDb`) ; pas de PII dans les logs (étiquette de tool seule) ; tests style fichiers voisins (mocks `vi.hoisted`) ; describes gated = **safeParse de l'input brut + lookup scope-scopé + libellé « introuvable » identique pour inexistant/hors-scope** (pattern kanban-tools 7762612) ; lecture-après-écriture avec relecture isolée (pattern 53d82fd).

---

### Task 1: Migration — enum AuditAction + `EmailMessage.archivedAt`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260728170000_assistant_crud_audit_mail_archive/migration.sql`

- [ ] **Step 1:** Dans `schema.prisma` :
  - enum `AuditAction` : ajouter `client_created`, `client_updated`, `contact_created`, `contact_updated`, `contact_deleted`, `template_created`, `template_updated`, `template_deleted`, `mail_archived`, `mail_deleted`, `mail_marked_read`, `mail_marked_unread` (à la suite des valeurs existantes, ordre alphabétique par groupe comme le fichier le pratique).
  - modèle `EmailMessage` : ajouter `archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)` près de `deletedAt`, + index `@@index([workspaceId, archivedAt])`.

- [ ] **Step 2:** Écrire la migration SQL manuellement (pattern des migrations du repo — le CI/staging l'applique, pas `db push`) :

```sql
-- Plan 5b: audit du CRUD assistant (clients/contacts/templates/mail) +
-- archivage local des mails (archivedAt — PAS de sync retour IMAP/Graph).
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'client_created';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'client_updated';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'contact_created';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'contact_updated';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'contact_deleted';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'template_created';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'template_updated';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'template_deleted';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_archived';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_deleted';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_marked_read';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_marked_unread';

ALTER TABLE "public"."email_messages"
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "email_messages_workspace_id_archived_at_idx"
  ON "public"."email_messages" ("workspace_id", "archived_at");
```

- [ ] **Step 3:** `pnpm --filter @nexushub/db exec prisma generate` → types à jour ; `pnpm turbo run typecheck` → vert.
- [ ] **Step 4:** Commit — `feat(db): audit CRUD assistant + archivage local des mails (plan 5b)`
- [ ] **Step 5 (contrôleur, hors subagent):** appliquer la migration sur Supabase staging (`bnd-os-staging`) via MCP avant merge.

---

### Task 2: Cores clients & contacts (extraction iso-comportement)

**Files:**

- Create: `apps/web/features/clients/lib/client-core.ts`
- Test: `apps/web/features/clients/lib/client-core.test.ts`
- Modify: `apps/web/features/clients/actions/delete-client.ts` (délègue au core, garde redirect — même approche que delete-project au 5a, `delete-client.test.ts` s'il existe doit rester vert)

Extraire depuis les actions form-based (`create-client.ts`, `update-client.ts`, `delete-client.ts`, `create-contact.ts`, `update-contact.ts`, `delete-contact.ts`) des cores `(ctx, input) => {ok…}` :

- `createClientCore(ctx, {name, colorToken?, initials?, domains?, notes?})` → `{ok:true, clientId, slug}` ; P2002 → « Un client porte déjà ce nom. » ; scope restricted → SCOPE_ERROR_MESSAGE ; audit `client_created` (nouveau).
- `updateClientCore(ctx, {clientId, name?, notes?, domains?…})` → lecture-après-écriture `{ok:true, name, …}` ; P2002 idem ; audit `client_updated`.
- `deleteClientCore(ctx, {clientId})` → **iso-comportement strict** de l'action : garde `canDeleteClient` domaine (messages exacts « Suppression impossible : N projet(s) actif(s)… », singulier/pluriel préservés), soft-delete transactionnel contacts→client, audit `client_deleted` conservé. Le redirect reste dans l'action.
- `createContactCore` / `updateContactCore` / `deleteContactCore` : mêmes extractions ; `updateContactCore` accepte `raci` (enum RACI nullable) — c'est lui que `set_contact_raci` réutilisera ; audits `contact_created`/`contact_updated`/`contact_deleted` (nouveaux) via `recordAudit` fail-safe existant.

Chaque core : Viewer refusé, workspace-scopé, scope restricted vérifié, lecture-après-écriture sur les updates. Tests : chaque core (happy, P2002, Viewer, scope, NotFoundError, messages ADR #14 exacts au singulier ET pluriel, audit appelé avec la bonne action et sans PII dans data). Les actions form refactorées délèguent (leurs tests existants restent verts = preuve iso).

Commit : `feat(clients): cores clients et contacts (iso-extraction + audit)`

---

### Task 3: Tools clients & contacts

**Files:**

- Create: `apps/web/lib/assistant/tools/client-tools.ts`
- Test: `apps/web/lib/assistant/tools/client-tools.test.ts`
- Modify: `apps/web/lib/assistant/tools/index.ts` (enregistrer `buildClientTools(ctx)`)

7 tools via `defineTool` (pattern kanban-tools, `safeMutation`, `failure()`) :

| Tool               | Gate | Notes                                                                                                                                                                                                                                                                                            |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `create_client`    | —    | name 1-120, retour JSON `{created, clientId, slug}`                                                                                                                                                                                                                                              |
| `update_client`    | —    | lecture-après-écriture                                                                                                                                                                                                                                                                           |
| `delete_client`    | ⚡   | describeForConfirm **async véridique** : safeParse `{clientId: uuid}` de l'input brut → scope → lookup nom + compte de projets actifs ; si projets actifs, la description l'annonce (« … a N projets actifs — la suppression sera refusée ») ; hors-scope/inexistant → libellé identique prudent |
| `create_contact`   | —    | clientId + prénom/nom, email optionnel                                                                                                                                                                                                                                                           |
| `update_contact`   | —    | lecture-après-écriture                                                                                                                                                                                                                                                                           |
| `delete_contact`   | ⚡   | describe véridique : prénom/nom réels lus en DB (safeParse + scope)                                                                                                                                                                                                                              |
| `set_contact_raci` | —    | `{contactId, raci: enum                                                                                                                                                                                                                                                                          | null}`→`updateContactCore`; retour post-état`{updated, raci}` |

Tests : délégation + JSON exacts, gated===true, describes (input brut `{}`/`{clientId:{"not":null}}` → prudent sans appel DB ; scope restricted → nom jamais présent ; cas « projets actifs » annoncé), date… n/a. Registry : test d'inventaire mis à jour.

Commit : `feat(assistant): tools clients et contacts (deletes gated, confirm véridique)`

---

### Task 4: Cores équipe (extraction + LAST_ADMIN_PROTECTED surfacé)

**Files:**

- Create: `apps/web/features/team/lib/team-core.ts`
- Test: `apps/web/features/team/lib/team-core.test.ts`

- `changeMemberRoleCore(ctx, {userId, role})` : iso-extraction de `changeMemberRole` (refus auto-modification si l'action le fait, refus Viewer-sans-scope avec message exact, détection `err.message.includes('LAST_ADMIN_PROTECTED')` → « Impossible : ce membre est le dernier Admin de l'espace. », audit `member_role_changed` avec `{from, to}`). Vérification **Admin dans le core** (`ctx.role === 'admin'` sinon refus) — défense en profondeur en plus de l'`adminOnly` du registry.
- `removeMemberCore(ctx, {userId})` : idem (auto-retrait refusé, LAST_ADMIN, audit `member_removed`).
- `inviteMemberCore(ctx, {email, role})` : Admin only ; **réutilise `issueInvitation` (core pur existant)** + le rate limiter `invitation` existant (20/24h — MÊME limiteur que l'UI, pas un nouveau) + refus si déjà membre + audit `invitation_created`. Retour `{ok:true, email, role}` (jamais le token).

Tests : chaque core (Admin refusé si role!=admin, LAST_ADMIN détecté, rate limit dépassé → message exact de l'action, audit pinné, le token n'apparaît dans AUCUN retour). Les actions form existantes ne sont **pas** refactorées dans cette tâche si l'extraction risque de casser leurs tests — dans ce cas les cores dupliquent la logique minimale avec un commentaire de renvoi, et un suivi de consolidation est noté (décision laissée à l'implémenteur, à justifier dans le rapport).

Commit : `feat(team): cores équipe (invite/remove/changeRole, dernier Admin surfacé)`

---

### Task 5: Tools équipe — premiers tools `adminOnly`

**Files:**

- Create: `apps/web/lib/assistant/tools/team-tools.ts`
- Test: `apps/web/lib/assistant/tools/team-tools.test.ts`
- Modify: `apps/web/lib/assistant/tools/index.ts`

3 tools, **tous `adminOnly: true`** (premier usage réel du flag — le refus registry est déjà testé dans packages/agent) :

| Tool                 | Gate | describeForConfirm (async véridique, pattern 5a)                                                                                                                   |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invite_member`      | ⚡   | « Inviter <email> comme <rôle> ? Un email d'invitation (valide 72 h) lui sera envoyé. » — email/role depuis l'input safeParsé (c'est l'action même, pas un lookup) |
| `remove_member`      | ⚡   | lookup DB : prénom + rôle réels du membre (safeParse + workspace) ; introuvable → prudent                                                                          |
| `change_member_role` | —    | non gated (réversible, admin-only, auditée)                                                                                                                        |

Tests : `adminOnly === true` pinné pour les 3 ; délégation ; describes (input brut, membre introuvable) ; **test d'intégration route** (chat/route.test.ts) : un user role 'user' qui déclenche `invite_member` reçoit le refus admin du registry (« réservée aux administrateurs ») — vérifie le câblage de bout en bout du flag.

Commit : `feat(assistant): tools équipe admin-only (invite/remove gated)`

---

### Task 6: Tools templates Kanban

**Files:**

- Create: `apps/web/lib/assistant/tools/template-tools.ts`
- Test: `apps/web/lib/assistant/tools/template-tools.test.ts`
- Modify: `apps/web/lib/assistant/tools/index.ts` ; `apps/web/features/templates/kanban/actions.ts` (ajouter les audits `template_*` aux cores existants — additif)

Les cores existent déjà (`createKanbanTemplate`/`updateKanbanTemplate`/`deleteKanbanTemplate`, signature `{ok…}`) — wrapper direct. Ajouter l'audit manquant dans les cores (`template_created`/`updated`/`deleted`, fail-safe).

| Tool              | Gate | Notes                                                                                                                                                                            |
| ----------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_template` | —    | name + columns `[{name, stepChecklist?}]` (max 20 colonnes) ; description rappelle : « modifier un template n'impacte pas les projets existants (copy-on-create) »               |
| `update_template` | —    | idem + lecture-après-écriture (relire name + colonnes)                                                                                                                           |
| `delete_template` | ⚡   | describe véridique : nom réel + « les projets existants ne sont pas affectés » ; template builtin → describe annonce directement le refus système (pattern delete_column/Bloqué) |

Membres autorisés (pas d'adminOnly — §6.7). Tests : délégation, JSON, describes (builtin, introuvable, input brut), audit pinné.

Commit : `feat(assistant): tools templates Kanban (delete gated)`

---

### Task 7: Cores mail-state (owner-only, bulk borné)

**Files:**

- Create: `apps/web/features/communications/lib/mail-state-core.ts`
- Test: `apps/web/features/communications/lib/mail-state-core.test.ts`

Un seul core paramétré + helpers :

```ts
export type MailStateOp = 'read' | 'unread' | 'archive' | 'delete';
export const MAIL_BULK_MAX = 100;

export async function setMailStateCore(
  ctx: AuthContext,
  input: { mailIds: string[]; op: MailStateOp },
): Promise<{ ok: true; affected: number; skipped: number } | { ok: false; message: string }>;
```

Comportement :

- Viewer refusé ; `mailIds` 1..100 (au-delà → refus « Maximum 100 mails par opération. »).
- **Ownership strict** : le `updateMany` porte `where: { id: { in: mailIds }, workspaceId: ctx.workspaceId, deletedAt: null, integration: { ownerUserId: ctx.userId } }` — un mail d'une boîte d'un autre membre est silencieusement non-affecté et compté dans `skipped` (= `mailIds.length - affected`). Data : `read` → `{isRead: true}`, `unread` → `{isRead: false}`, `archive` → `{archivedAt: new Date()}`, `delete` → `{deletedAt: new Date()}`.
- Audit (une entrée par opération, PAS par mail) : action `mail_marked_read`/`mail_marked_unread`/`mail_archived`/`mail_deleted`, `data: { count: affected }` — jamais d'ids ni de sujets.
- Retour : `affected` = count réel du `updateMany` (lecture-après-écriture native de Prisma).

Note : `search_mails` (read) reste workspace-scopé pour les métadonnées — seules les **mutations** exigent l'ownership. L'action UI `markEmailRead` existante (workspace-scopé, mono-mail) n'est PAS modifiée (comportement UI inchangé ; noter l'asymétrie en commentaire).

Tests : chaque op (data exact), ownership dans le where pinné, plafond 100, skipped calculé, audit sans PII, Viewer.

Commit : `feat(communications): core mail-state (bulk owner-only, audit compté)`

---

### Task 8: Tools mail-state

**Files:**

- Modify: `apps/web/lib/assistant/tools/mail-tools.ts` (+ test)

4 tools (bornes et descriptions honnêtes sur le caractère local d'archive/delete) :

| Tool               | Gate | describeForConfirm                                                                                                                                                                                                                                                                                     |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mark_mail_read`   | —    | n/a — `{mailIds: uuid[] 1..100}` (unitaire = tableau à 1)                                                                                                                                                                                                                                              |
| `mark_mail_unread` | —    | n/a                                                                                                                                                                                                                                                                                                    |
| `archive_mail`     | ⚡   | « Archiver N mail(s) de vos boîtes dans NexusHub ? (ils restent sur le serveur mail d'origine) » — N = compte VÉRIFIÉ en DB avec le même where owner-only que le core (safeParse input brut → count) ; si count < demandé, l'annoncer (« X sur N vous appartiennent — seuls ceux-là seront archivés ») |
| `delete_mail`      | ⚡   | idem avec « Masquer/supprimer N mail(s) dans NexusHub ? … »                                                                                                                                                                                                                                            |

Résultats JSON : `{done: true, affected, skipped}` — le prompt sait dire « 12 marquées lues, 2 ignorées (boîte d'un autre membre) ». Le scénario cible d'Angelo (« marque toutes les notifs d'applis comme lues ») = `search_mails` → ids → `mark_mail_read` en un tour, sans gate.

Tests : délégation, plafond, describes (compte DB, mismatch annoncé, input brut, scope owner), aucun sujet/expéditeur dans les describes (PII : compte uniquement).

Commit : `feat(assistant): tools mail en masse (archive/delete gated, owner-only)`

---

### Task 9: Suites + docs + revue finale

- [ ] `pnpm turbo run test typecheck lint` → tout vert (couverture agent 100 % intacte).
- [ ] Inventaires registry à jour (client-tools 7, team-tools 3, template-tools 3, mail-tools +4).
- [ ] `progress.md` ligne Plan 5b + `CLAUDE.md` §11 une ligne.
- [ ] Commit `docs: progress et journal pour assistant plan 5b`.
- [ ] Revue holistique finale (superpowers:code-reviewer) : flux tracés (delete_client avec projets actifs de bout en bout ; invite_member par un non-admin ; bulk mark_read avec mails d'autrui dans la liste), migration vérifiée, dette listée pour la PR. Verdict ready-for-PR requis.
- [ ] Contrôleur : migration appliquée sur staging AVANT la PR ; PR template FR habituel.

---

## Self-review (fait à l'écriture)

- **Couverture spec §5 restant** : clients/contacts (T2-T3), équipe (T4-T5), templates (T6), mails en masse (T7-T8). RACI → `set_contact_raci` (écart documenté en tête). ✅
- **Placeholders** : les tâches 2 et 4 délèguent le détail des signatures aux actions sources qu'elles extraient iso-comportement (fichiers cités, messages exacts cités) — voulu, l'inventaire factuel du 2026-07-28 (exploration) fait foi ; T4 laisse une décision encadrée (extraction vs duplication minimale) avec obligation de justification.
- **Types inter-tâches** : `setMailStateCore` (T7) consommé T8 ; cores T2 consommés T3 ; `issueInvitation` existant consommé T4 ; enum AuditAction (T1) consommée T2/T4/T6/T7.
- **Migration first** : T1 en tête, staging appliqué par le contrôleur avant merge (convention repo).
