# Assistant NexusHub — Plan 2a : Actions Kanban + gate de confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'agent exécute des séries d'actions Kanban (créer projet/carte, modifier, déplacer, assigner, échéances) avec un dialog Allow/Deny temps réel sur les actions gated, tracé dans l'audit log.

**Architecture:** Zéro changement dans `packages/agent` (le gate y est déjà) — tout se joue dans les adaptateurs : un store de confirmation Redis (SSE ↔ endpoint `POST /api/assistant/confirm`, nonce single-use, poll côté stream), des fonctions « core » extraites des Server Actions form-based (create-card, delete-card, create-project) réutilisées par les tools ET par les actions existantes, un module de tools mutants via `defineTool`, le dialog inline dans le chat. Migration Prisma : 3 valeurs d'enum `AuditAction`.

**Tech Stack:** existant uniquement (Zod, `@upstash/redis` déjà présent via rate-limit, Prisma, Vitest). Aucune nouvelle dépendance.

**Base:** branche `feat/assistant-actions` (depuis `main` post-merge PR #9). Plan 1 : `docs/superpowers/plans/2026-07-27-assistant-core.md`. Spec : `docs/superpowers/specs/2026-07-27-assistant-agent-design.md` §3.3-3.4, §6. Plan 2b (mail lazy-body + drafts + send + widgets structurés) suivra.

**Contraintes héritées (revues Plan 1 + exploration) :**

- Tools construits via `defineTool()` exclusivement ; handlers → messages montrables uniquement.
- La migration d'enum doit être **appliquée sur Supabase manuellement avant merge** (Vercel ne migre pas — règle mémoire projet). La tâche 1 s'arrête et le signale au contrôleur.
- Les cores extraits doivent être **iso-comportement** : mêmes messages, mêmes gardes (Viewer, scope, workspace), les tests existants des actions doivent rester verts sans modification de leurs assertions.
- `create-project` core : retourner `projectId` — le `redirect()` reste dans l'action form.
- `moveCard` fait un `revalidatePath` : inoffensif en route handler, ne pas y toucher.
- Deux styles de retour coexistent (`{status}` vs `{ok}`) : les cores adoptent `{ok, ...}`.
- Provider : ajouter la branche `APIUserAbortError` (report revue Task 8 Plan 1).
- Client : valider les événements SSE par Zod (report revue Task 9 — obligatoire maintenant que `confirm_request` arrive) ; sticky-scroll « seulement si déjà en bas ».

---

### Task 1: Migration enum `AuditAction`

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (enum lignes 127-153)
- Create: `packages/db/prisma/migrations/20260727170000_assistant_audit_actions/migration.sql`

- [ ] **Step 1: Ajouter les valeurs à l'enum dans `schema.prisma`**

À la fin du bloc `enum AuditAction` (après `attachment_rejected_upload`) :

```prisma
  assistant_turn
  assistant_gate
  assistant_tool_run
```

- [ ] **Step 2: Créer la migration SQL**

Vérifier d'abord le nom du type dans une migration existante (`grep -r "AuditAction" packages/db/prisma/migrations/ | head -3`) et copier la syntaxe exacte. Attendu :

```sql
-- Assistant (agent conversationnel) : traçage des tours, du gate et des tools.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_turn';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_gate';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_tool_run';
```

- [ ] **Step 3: Régénérer le client + vérifier**

Run: `pnpm --filter @nexushub/db exec prisma generate && pnpm --filter web typecheck`
Expected: OK, les nouvelles valeurs existent dans le type `AuditAction`.

- [ ] **Step 4: STOP — signaler au contrôleur**

Ne PAS appliquer sur la base distante. Rapporter : « migration créée, à appliquer sur Supabase avant merge (mcp supabase apply_migration ou dashboard) ». Le contrôleur gère l'application.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): assistant audit action enum values"
```

---

### Task 2: Store de confirmation Redis (TDD)

**Files:**

- Create: `apps/web/lib/assistant/confirm-store.ts`
- Create: `apps/web/lib/assistant/confirm-store.test.ts`

Contrat : `createPending(userId) → id` ; `answer(id, userId, allowed) → 'ok' | 'not_found' | 'forbidden' | 'already_answered'` ; `awaitAnswer(id, opts?) → Promise<boolean>` (poll ~1 s, timeout 120 s → `false`, nettoie la clé). Backend Upstash Redis (mêmes env vars que rate-limit), fallback en mémoire hors credentials (dev/test — même politique que `lib/rate-limit`).

- [ ] **Step 1: Tests — `apps/web/lib/assistant/confirm-store.test.ts`**

Le fallback mémoire est testé directement (pas de réseau) avec `vi.useFakeTimers()`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmStore, MemoryConfirmBackend } from './confirm-store';

describe('ConfirmStore (backend mémoire)', () => {
  let store: ConfirmStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ConfirmStore(new MemoryConfirmBackend());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createPending → answer(allowed) → awaitAnswer résout true', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 1000 });
    expect(await store.answer(id, 'u1', true)).toBe('ok');
    await vi.advanceTimersByTimeAsync(20);
    await expect(waiting).resolves.toBe(true);
  });

  it('refus → awaitAnswer résout false', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 1000 });
    expect(await store.answer(id, 'u1', false)).toBe('ok');
    await vi.advanceTimersByTimeAsync(20);
    await expect(waiting).resolves.toBe(false);
  });

  it('timeout sans réponse → false (refus par défaut)', async () => {
    const id = await store.createPending('u1');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(false);
  });

  it('answer par un autre utilisateur → forbidden, la demande reste pending', async () => {
    const id = await store.createPending('u1');
    expect(await store.answer(id, 'u2', true)).toBe('forbidden');
    const waiting = store.awaitAnswer(id, { pollMs: 10, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(false);
  });

  it('answer sur id inconnu → not_found ; double réponse → already_answered (single-use)', async () => {
    expect(await store.answer('inconnu', 'u1', true)).toBe('not_found');
    const id = await store.createPending('u1');
    expect(await store.answer(id, 'u1', true)).toBe('ok');
    expect(await store.answer(id, 'u1', false)).toBe('already_answered');
  });

  it('les ids sont uniques et non devinables (32 hex)', async () => {
    const a = await store.createPending('u1');
    const b = await store.createPending('u1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run lib/assistant/confirm-store.test.ts`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Implémenter `apps/web/lib/assistant/confirm-store.ts`**

```ts
import 'server-only';

import { randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';

const KEY_PREFIX = 'assistant:confirm:';
const TTL_SECONDS = 150; // > timeout de 120 s, marge de nettoyage
const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

interface PendingRecord {
  readonly userId: string;
  readonly status: 'pending' | 'allowed' | 'denied';
}

export interface ConfirmBackend {
  get(id: string): Promise<PendingRecord | null>;
  set(id: string, record: PendingRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Backend Upstash (prod). */
class RedisConfirmBackend implements ConfirmBackend {
  constructor(private readonly redis: Redis) {}
  async get(id: string): Promise<PendingRecord | null> {
    return (await this.redis.get<PendingRecord>(KEY_PREFIX + id)) ?? null;
  }
  async set(id: string, record: PendingRecord): Promise<void> {
    await this.redis.set(KEY_PREFIX + id, record, { ex: TTL_SECONDS });
  }
  async delete(id: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + id);
  }
}

/** Backend mémoire (dev/tests) — un seul process, comme le fallback rate-limit. */
export class MemoryConfirmBackend implements ConfirmBackend {
  private readonly map = new Map<string, PendingRecord>();
  async get(id: string): Promise<PendingRecord | null> {
    return this.map.get(id) ?? null;
  }
  async set(id: string, record: PendingRecord): Promise<void> {
    this.map.set(id, record);
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}

export type AnswerOutcome = 'ok' | 'not_found' | 'forbidden' | 'already_answered';

export class ConfirmStore {
  constructor(private readonly backend: ConfirmBackend) {}

  async createPending(userId: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    await this.backend.set(id, { userId, status: 'pending' });
    return id;
  }

  /** Un oui = une exécution : la première réponse gagne, les suivantes sont rejetées. */
  async answer(id: string, userId: string, allowed: boolean): Promise<AnswerOutcome> {
    const record = await this.backend.get(id);
    if (record === null) return 'not_found';
    if (record.userId !== userId) return 'forbidden';
    if (record.status !== 'pending') return 'already_answered';
    await this.backend.set(id, { userId, status: allowed ? 'allowed' : 'denied' });
    return 'ok';
  }

  /** Poll jusqu'à réponse ou timeout ; timeout = refus (fail closed). Nettoie la clé. */
  async awaitAnswer(
    id: string,
    opts?: { readonly pollMs?: number; readonly timeoutMs?: number },
  ): Promise<boolean> {
    const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        const record = await this.backend.get(id);
        if (record === null) return false;
        if (record.status === 'allowed') return true;
        if (record.status === 'denied') return false;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } finally {
      await this.backend.delete(id).catch(() => undefined);
    }
  }
}

let instance: ConfirmStore | null = null;

/** Store partagé du process. Upstash si configuré, mémoire sinon (dev/preview). */
export function getConfirmStore(): ConfirmStore {
  if (instance === null) {
    const url = process.env['UPSTASH_REDIS_REST_URL'];
    const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
    instance =
      url !== undefined && url !== '' && token !== undefined && token !== ''
        ? new ConfirmStore(new RedisConfirmBackend(new Redis({ url, token })))
        : new ConfirmStore(new MemoryConfirmBackend());
  }
  return instance;
}
```

- [ ] **Step 4: Vérifier le pass + commit**

Run: `pnpm --filter web exec vitest run lib/assistant/confirm-store.test.ts` — 6 tests PASS.

```bash
git add apps/web/lib/assistant/confirm-store.ts apps/web/lib/assistant/confirm-store.test.ts
git commit -m "feat(assistant): redis-backed confirm store with single-use answers"
```

---

### Task 3: Événements SSE typés + validation Zod côté client

**Files:**

- Modify: `apps/web/lib/assistant/chat-schema.ts`
- Modify: `apps/web/lib/assistant/chat-schema.test.ts`
- Modify: `apps/web/features/assistant/lib/sse.ts`
- Modify: `apps/web/features/assistant/lib/sse.test.ts`

- [ ] **Step 1: Étendre `ChatSseEvent` + schéma Zod dans `chat-schema.ts`**

Remplacer le type `ChatSseEvent` par une union dérivée d'un schéma (source de vérité unique) :

```ts
/** Événements SSE — validés côté client (confirm_request est sensible). */
export const ChatSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), text: z.string() }),
  z.object({ type: z.literal('tool_start'), name: z.string() }),
  z.object({ type: z.literal('tool_end'), name: z.string(), isError: z.boolean() }),
  z.object({
    type: z.literal('confirm_request'),
    id: z.string().regex(/^[0-9a-f]{32}$/),
    description: z.string().max(2000),
  }),
  z.object({
    type: z.literal('confirm_resolved'),
    id: z.string().regex(/^[0-9a-f]{32}$/),
    allowed: z.boolean(),
  }),
  z.object({ type: z.literal('done'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
```

- [ ] **Step 2: Le parser valide — `features/assistant/lib/sse.ts`**

Remplacer le `JSON.parse(...) as ChatSseEvent` par :

```ts
try {
  const parsed = ChatSseEventSchema.safeParse(JSON.parse(line.slice('data: '.length)));
  if (parsed.success) events.push(parsed.data);
  // événement inconnu/malformé : ignoré, la conversation continue
} catch {
  // ligne partielle ou corrompue : ignorée
}
```

(import : `import { ChatSseEventSchema, type ChatSseEvent } from '@/lib/assistant/chat-schema';`)

- [ ] **Step 3: Tests**

Dans `chat-schema.test.ts`, ajouter :

```ts
import { ChatSseEventSchema } from './chat-schema';

describe('ChatSseEventSchema', () => {
  it('accepte les 7 types et rejette un type inconnu ou un id malformé', () => {
    expect(ChatSseEventSchema.safeParse({ type: 'chunk', text: 'x' }).success).toBe(true);
    expect(
      ChatSseEventSchema.safeParse({
        type: 'confirm_request',
        id: 'a'.repeat(32),
        description: 'd',
      }).success,
    ).toBe(true);
    expect(
      ChatSseEventSchema.safeParse({ type: 'confirm_request', id: 'court', description: 'd' })
        .success,
    ).toBe(false);
    expect(ChatSseEventSchema.safeParse({ type: 'hack', foo: 1 }).success).toBe(false);
  });
});
```

Dans `sse.test.ts`, ajouter :

```ts
it('rejette un événement de type inconnu (validation Zod)', () => {
  const { events } = parseSseLines('data: {"type":"hack","payload":"x"}\n\n');
  expect(events).toEqual([]);
});
```

Run: `pnpm --filter web exec vitest run lib/assistant/chat-schema.test.ts features/assistant/lib/sse.test.ts`
Expected: tout PASS (les tests existants restent verts — les shapes n'ont pas changé).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/assistant/chat-schema.ts apps/web/lib/assistant/chat-schema.test.ts apps/web/features/assistant/lib
git commit -m "feat(assistant): confirm SSE events + zod-validated client parsing"
```

---

### Task 4: Endpoint `POST /api/assistant/confirm`

**Files:**

- Create: `apps/web/app/api/assistant/confirm/route.ts`
- Create: `apps/web/app/api/assistant/confirm/route.test.ts`

- [ ] **Step 1: Tests — `route.test.ts`** (node env ; mocks : auth, csrf, store)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  answer: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ assertCsrfHeader: mocks.assertCsrfHeader }));
vi.mock('@/lib/assistant/confirm-store', () => ({
  getConfirmStore: () => ({ answer: mocks.answer }),
}));
vi.mock('server-only', () => ({}));

import { POST } from './route';

const ctx = { userId: 'u1', email: 'a@b.c', workspaceId: 'w1', role: 'user', isSuperAdmin: false };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/assistant/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'tok' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(ctx);
  mocks.assertCsrfHeader.mockResolvedValue(undefined);
  mocks.answer.mockResolvedValue('ok');
});

describe('POST /api/assistant/confirm', () => {
  const valid = { id: 'a'.repeat(32), allowed: true };

  it('non authentifié → 401', async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(makeRequest(valid))).status).toBe(401);
  });

  it('CSRF invalide → 403', async () => {
    mocks.assertCsrfHeader.mockRejectedValue(new Error('CSRF'));
    expect((await POST(makeRequest(valid))).status).toBe(403);
  });

  it('body invalide → 400', async () => {
    expect((await POST(makeRequest({ id: 'court', allowed: true }))).status).toBe(400);
  });

  it("réponse acceptée → 200, answer appelé avec l'userId de la session", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(200);
    expect(mocks.answer).toHaveBeenCalledWith(valid.id, 'u1', true);
  });

  it('not_found → 404, forbidden → 403, already_answered → 409', async () => {
    mocks.answer.mockResolvedValueOnce('not_found');
    expect((await POST(makeRequest(valid))).status).toBe(404);
    mocks.answer.mockResolvedValueOnce('forbidden');
    expect((await POST(makeRequest(valid))).status).toBe(403);
    mocks.answer.mockResolvedValueOnce('already_answered');
    expect((await POST(makeRequest(valid))).status).toBe(409);
  });
});
```

- [ ] **Step 2: Vérifier l'échec, puis implémenter `route.ts`**

```ts
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getConfirmStore } from '@/lib/assistant/confirm-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  allowed: z.boolean(),
});

const OUTCOME_STATUS = { not_found: 404, forbidden: 403, already_answered: 409 } as const;

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return Response.json({ ok: false, message: 'Non authentifié.' }, { status: 401 });
  }
  try {
    await assertCsrfHeader(req.headers.get('x-csrf-token'));
  } catch {
    return Response.json({ ok: false, message: 'CSRF invalide.' }, { status: 403 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Requête invalide.' }, { status: 400 });
  }
  const outcome = await getConfirmStore().answer(parsed.data.id, ctx.userId, parsed.data.allowed);
  if (outcome !== 'ok') {
    return Response.json({ ok: false }, { status: OUTCOME_STATUS[outcome] });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Pass + commit**

Run: `pnpm --filter web exec vitest run app/api/assistant/confirm && pnpm --filter web typecheck`

```bash
git add apps/web/app/api/assistant/confirm
git commit -m "feat(assistant): confirm endpoint (single-use, session-bound)"
```

---

### Task 5: Extraction core — `createCardCore` / `deleteCardCore`

**Files:**

- Create: `apps/web/features/projects/lib/card-core.ts`
- Create: `apps/web/features/projects/lib/card-core.test.ts`
- Modify: `apps/web/features/projects/actions/create-card.ts`
- Modify: `apps/web/features/projects/actions/delete-card.ts`

Extraction **iso-comportement**. Signatures cibles :

```ts
export async function createCardCore(
  ctx: AuthContext,
  input: {
    readonly projectId: string;
    readonly columnId: string;
    readonly title: string;
    readonly templateId?: string | null;
    readonly proposedId?: string | null;
  },
): Promise<
  { ok: true; cardId: string; shortRef: number; title: string } | { ok: false; message: string }
>;

export async function deleteCardCore(
  ctx: AuthContext,
  input: { readonly cardId: string },
): Promise<{ ok: true } | { ok: false; message: string }>;
```

- [ ] **Step 1: Créer `card-core.ts`** en déplaçant le corps métier de `create-card.ts` (lignes après le parse FormData : lookup projet → scope → résolution template → lookups parallèles → `computeCardPosition` → transaction carte + checklists) et de `delete-card.ts` (lookup → scope → soft delete). Règles :
  - Garde Viewer **dans le core** (`if (ctx.role === Roles.Viewer) return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };`).
  - Validation Zod des inputs dans le core (`CreateCardSchema` pour projectId/columnId/title ; UUID_RE pour proposedId comme dans l'action).
  - Mêmes messages d'erreur exactement (`'Projet introuvable.'`, `SCOPE_ERROR_MESSAGE`, `'Carte introuvable.'`, `NotFoundError('Column')`).
  - `deleteCardCore` ajoute (nouveau, cohérent avec l'enum existant) : `await recordAudit({ action: 'card_deleted', workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectType: 'card', subjectId: card.id });` — c'était un trou d'audit connu.

- [ ] **Step 2: Refactorer les deux actions** pour ne garder que : CSRF → `requireUser()` → parse FormData → appel core → mapping `{ok}` → `{status}` (`ok:true` → `status:'success'` avec les mêmes champs / `status:'idle'` pour delete ; `ok:false` → `status:'error'`).

- [ ] **Step 3: Tests — `card-core.test.ts`** (mocks Prisma via `vi.hoisted`, comme `read-tools.test.ts`) :

Cas minimum : création OK (transaction appelée, position calculée, workspaceId dans les where) ; garde Viewer ; projet introuvable ; scope restricted refusé ; delete OK (soft delete + audit `card_deleted` appelé) ; delete carte introuvable.

- [ ] **Step 4: Non-régression**

Run: `pnpm --filter web exec vitest run features/projects` — TOUS les tests existants des actions restent verts sans modification de leurs assertions. Puis `pnpm --filter web typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/projects
git commit -m "refactor(kanban): extract createCardCore/deleteCardCore for reuse"
```

---

### Task 6: Extraction core — `createProjectCore`

**Files:**

- Create: `apps/web/features/projects/lib/project-core.ts`
- Create: `apps/web/features/projects/lib/project-core.test.ts`
- Modify: `apps/web/features/projects/actions/create-project.ts`

- [ ] **Step 1: Créer `project-core.ts`**

```ts
export async function createProjectCore(
  ctx: AuthContext,
  input: CreateProjectInput, // z.infer de CreateProjectSchema — déjà parsé
): Promise<{ ok: true; projectId: string } | { ok: false; message: string }>;
```

Déplacer : scope check client → lookup client (défense en profondeur) → construction `columnSeeds` (template DB avec snapshot `defaultCardTemplateId` + colonne Bloqué, OU built-in via `findTemplate`/`buildProjectColumns`) → transaction 4 étapes (ProjectType upsert, Project, Columns, ProjectMember lead) → catch P2002 → `'Un projet porte déjà ce nom.'`. **Ni `revalidatePath` ni `redirect` dans le core.**

- [ ] **Step 2: Refactorer l'action** : CSRF → `requireUser()` → parse FormData avec `CreateProjectSchema` → `createProjectCore` → si ok : `revalidatePath('/projects')` + `revalidatePath('/(app)/layout','layout')` + `redirect(...)` (identique) ; sinon `{status:'error'}`.

- [ ] **Step 3: Tests — `project-core.test.ts`** : création via template built-in (colonnes seedées + Bloqué à `BLOCKED_COLUMN_POSITION`, lead ajouté) ; template DB introuvable → message ; client hors workspace → NotFoundError ; P2002 → message doublon ; scope restricted sur client non autorisé → refus.

- [ ] **Step 4: Non-régression + commit**

Run: `pnpm --filter web exec vitest run features/projects && pnpm --filter web typecheck`

```bash
git add apps/web/features/projects
git commit -m "refactor(projects): extract createProjectCore (no redirect/revalidate)"
```

---

### Task 7: Tools de lecture complémentaires (`get_team_members`, `get_card`)

**Files:**

- Modify: `apps/web/lib/assistant/tools/read-tools.ts`
- Modify: `apps/web/lib/assistant/tools/read-tools.test.ts`

L'assignation par l'agent nécessite les userId des membres ; la modification d'une carte nécessite son état courant.

- [ ] **Step 1: Ajouter 2 tools ⚡ via `defineTool`** dans `buildReadTools` :

```ts
    defineTool({
      name: 'get_team_members',
      description: "Membres du workspace (id, email, rôle) — nécessaire pour assigner une carte.",
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb('get_team_members', async () => {
          const members = await prisma.membership.findMany({
            where: { workspaceId },
            select: { role: true, user: { select: { id: true, email: true, firstName: true, lastName: true } } },
            take: 50,
          });
          return JSON.stringify(
            members.map((m) => ({
              userId: m.user.id,
              email: m.user.email,
              name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || null,
              role: m.role,
            })),
          );
        }),
    }),
    defineTool({
      name: 'get_card',
      description: "Détail d'une carte : titre, description, colonne, échéance, assignés, checklist.",
      inputSchema: z.object({ cardId: uuid }),
      jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
      handler: async (input) =>
        safeDb('get_card', async () => {
          const card = await prisma.card.findFirst({
            where: { id: input.cardId, workspaceId, deletedAt: null, ...scopedCardWhere(scope) },
            select: {
              id: true, title: true, description: true, dueDate: true, shortRef: true,
              column: { select: { id: true, name: true, isBlockedSystem: true } },
              project: { select: { id: true, name: true } },
              assignees: { select: { userId: true, raci: true } },
              checklistItems: { select: { title: true, isChecked: true }, orderBy: { position: 'asc' }, take: 50 },
            },
          });
          if (card === null) return 'Erreur : carte introuvable ou hors de votre périmètre.';
          return JSON.stringify(card);
        }),
    }),
```

(Vérifier les noms de relations exacts dans `schema.prisma` — `assignees`/`checklistItems` — et adapter sans affaiblir les gardes.)

- [ ] **Step 2: Tests** : liste attendue passe à 9 tools (mettre à jour l'assertion du catalogue) ; `get_team_members` scoped workspace ; `get_card` scoped + introuvable.

- [ ] **Step 3: Pass + commit**

```bash
git add apps/web/lib/assistant/tools
git commit -m "feat(assistant): get_team_members and get_card read tools"
```

---

### Task 8: Tools mutants Kanban (`kanban-tools.ts`)

**Files:**

- Create: `apps/web/lib/assistant/tools/kanban-tools.ts`
- Create: `apps/web/lib/assistant/tools/kanban-tools.test.ts`
- Modify: `apps/web/lib/assistant/tools/index.ts`

8 tools via `defineTool`. ⚡ = direct, 🛑 = `gated: true`. Handlers : appeler l'action JSON / le core, mapper `{ok:false}` → message montrable, `{ok:true}` → confirmation courte JSON. Le contexte (`ctx`) est lié à la construction — jamais fourni par le modèle.

| Tool                   | Gate | Wrappe                                                                                                      |
| ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `create_card`          | ⚡   | `createCardCore(ctx, …)`                                                                                    |
| `create_project`       | ⚡   | `CreateProjectSchema.safeParse` puis `createProjectCore(ctx, …)`                                            |
| `update_card`          | ⚡   | `updateCard` (action JSON)                                                                                  |
| `set_card_due_date`    | ⚡   | `updateCardDueDate` — la sortie mentionne `autoBlocked`/`autoUnblocked` (« la carte est sortie de Bloqué ») |
| `move_card`            | ⚡   | `moveCard`                                                                                                  |
| `add_card_assignee`    | ⚡   | `addCardAssignee` (raci enum)                                                                               |
| `remove_card_assignee` | ⚡   | `removeCardAssignee`                                                                                        |
| `delete_card`          | 🛑   | `deleteCardCore(ctx, …)`                                                                                    |

- [ ] **Step 1: Tests — `kanban-tools.test.ts`** (mocker les modules d'actions et de cores via `vi.mock`, style `read-tools.test.ts`) :

Cas minimum : catalogue exact (8 noms, seul `delete_card` gated, aucun adminOnly) ; `create_card` transmet `ctx` + input parsé au core et renvoie un JSON contenant `cardId` ; `set_card_due_date` avec `autoUnblocked: true` → sortie contient « Bloqué » ; `move_card` erreur `{ok:false,message}` → message renvoyé tel quel (montrable) ; `create_project` avec dates invalides → message Zod du schéma ; `delete_card` a `gated: true`.

Squelette d'implémentation (Step 2) — exemple pour deux tools, généraliser :

```ts
import 'server-only';

import { z } from 'zod';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { createCardCore, deleteCardCore } from '@/features/projects/lib/card-core';
import { createProjectCore } from '@/features/projects/lib/project-core';
import { CreateProjectSchema } from '@/features/projects/lib/schemas';
import { moveCard } from '@/features/projects/actions/move-card';
import { updateCard } from '@/features/projects/actions/update-card';
import { updateCardDueDate } from '@/features/projects/actions/update-card-due-date';
import { addCardAssignee, removeCardAssignee } from '@/features/projects/actions/card-assignees';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;

export function buildKanbanTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'create_card',
      description:
        "Crée une carte dans une colonne d'un projet. Utiliser get_project_board pour trouver projectId et columnId.",
      inputSchema: z.object({
        projectId: uuid,
        columnId: uuid,
        title: z.string().trim().min(1).max(160),
      }),
      jsonSchema: {
        type: 'object',
        properties: {
          projectId: UUID_JSON,
          columnId: UUID_JSON,
          title: { type: 'string', maxLength: 160 },
        },
        required: ['projectId', 'columnId', 'title'],
      },
      handler: async (input) => {
        const result = await createCardCore(ctx, input);
        if (!result.ok) return `Échec : ${result.message}`;
        return JSON.stringify({
          created: true,
          cardId: result.cardId,
          ref: result.shortRef,
          title: result.title,
        });
      },
    }),
    defineTool({
      name: 'delete_card',
      description:
        'Supprime une carte (corbeille). Action sensible : confirmation utilisateur requise.',
      inputSchema: z.object({ cardId: uuid }),
      jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
      gated: true,
      handler: async (input) => {
        const result = await deleteCardCore(ctx, input);
        return result.ok ? 'Carte supprimée (restaurable 30 jours).' : `Échec : ${result.message}`;
      },
    }),
    // … set_card_due_date, move_card, update_card, add/remove_card_assignee, create_project
    // sur le même modèle : schéma Zod + jsonSchema mirroir, handler → action/core, messages FR.
  ];
}
```

Détails imposés pour les tools restants :

- `set_card_due_date` : input `{ cardId: uuid, dueDate: z.string().nullable() }` (null = effacer). Sortie ok : `JSON.stringify({ updated: true, autoBlocked, autoUnblocked, newDueDate })` — la description du tool explique que repousser une échéance débloque automatiquement.
- `move_card` : input `{ cardId, targetColumnId, targetIndex: z.number().int().min(0) }` — description : « refusé vers la colonne Bloqué (gérée automatiquement par les échéances) ».
- `update_card` : input `{ cardId, title?, description?, categoryTag? (nullable) }`.
- `add_card_assignee` : input `{ cardId, userId, raci: z.enum(['responsible','approver','consulted','informed']) }` — description : « un seul responsible et un seul approver par carte ; utiliser get_team_members pour les userId ».
- `create_project` : input `{ name, clientId, description?, startDate?, endDate?, typeId?, templateId }` — parser via `CreateProjectSchema.safeParse` (réutilisé tel quel) ; sortie `JSON.stringify({ created: true, projectId })` + mention que l'utilisateur peut ouvrir `/projects/{id}`.

- [ ] **Step 2: Implémenter** (le squelette ci-dessus, complété).

- [ ] **Step 3: Brancher dans `tools/index.ts`**

```ts
import { buildKanbanTools } from './kanban-tools';
// dans buildRegistry, après les read tools :
for (const tool of buildKanbanTools(ctx)) {
  registry.register(tool);
}
```

- [ ] **Step 4: Pass + commit**

Run: `pnpm --filter web exec vitest run lib/assistant && pnpm --filter web typecheck`

```bash
git add apps/web/lib/assistant/tools
git commit -m "feat(assistant): kanban mutation tools with gated delete"
```

---

### Task 9: Route chat — confirmer temps réel + audit + APIUserAbortError

**Files:**

- Modify: `apps/web/app/api/assistant/chat/route.ts`
- Modify: `apps/web/lib/assistant/provider.ts`
- Modify: `apps/web/lib/assistant/provider.test.ts`

- [ ] **Step 1: Provider — branche abort**

Dans `toProviderError`, AVANT la branche `APIError` :

```ts
if (error instanceof Anthropic.APIUserAbortError) {
  return new ProviderError('Génération interrompue.');
}
```

Test (provider.test.ts) : `Object.create(Anthropic.APIUserAbortError.prototype)` → message contient 'interrompue' (et pas 'undefined').

- [ ] **Step 2: Route — remplacer le confirmer hard-codé**

Dans `route.ts`, remplacer `confirmer: async () => false` par :

```ts
          confirmer: async (description) => {
            const store = getConfirmStore();
            const id = await store.createPending(ctx.userId);
            send({ type: 'confirm_request', id, description: description.slice(0, 2000) });
            const allowed = await store.awaitAnswer(id);
            send({ type: 'confirm_resolved', id, allowed });
            await recordAudit({
              action: 'assistant_gate',
              workspaceId: ctx.workspaceId,
              actorId: ctx.userId,
              // nom du tool uniquement — pas les arguments (PII possible)
              data: { tool: description.split(' ')[0] ?? '', allowed },
            });
            return allowed;
          },
```

(imports : `getConfirmStore` de `@/lib/assistant/confirm-store`, `recordAudit` de `@/lib/audit`.)

- [ ] **Step 3: Route — audit du tour + des tools**

Après `runTurn` réussi (avant `send({type:'done'…})`) :

```ts
await recordAudit({
  action: 'assistant_turn',
  workspaceId: ctx.workspaceId,
  actorId: ctx.userId,
  data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
});
```

Dans `onEvent`, sur `tool_end` uniquement :

```ts
if (event.type === 'tool_end') {
  send({ type: 'tool_end', name: event.name, isError: event.isError });
  void recordAudit({
    action: 'assistant_tool_run',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    data: { tool: event.name, isError: event.isError },
  });
}
```

- [ ] **Step 4: Vérifications**

Run: `pnpm --filter web exec vitest run lib/assistant app/api/assistant && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: tout vert (`recordAudit` est fail-safe — aucun test existant ne casse ; si un test de route existe déjà, mocker `@/lib/audit`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/assistant apps/web/lib/assistant
git commit -m "feat(assistant): realtime confirm flow with audit trail"
```

---

### Task 10: UI — dialog de confirmation inline + sticky-scroll

**Files:**

- Modify: `apps/web/features/assistant/components/assistant-chat.tsx`
- Modify: `apps/web/features/assistant/components/assistant-chat.test.tsx`

- [ ] **Step 1: Tests d'abord** (ajouter à `assistant-chat.test.tsx`) :

```tsx
it('confirm_request → dialog visible ; Autoriser → POST /confirm puis confirm_resolved le ferme', async () => {
  const confirmId = 'a'.repeat(32);
  // Stream contrôlé : confirm_request, puis (après le clic) confirm_resolved + done.
  let pushSecondHalf: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(
          `data: ${JSON.stringify({ type: 'confirm_request', id: confirmId, description: 'delete_card (cardId="c1")' })}\n\n`,
        ),
      );
      pushSecondHalf = () => {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ type: 'confirm_resolved', id: confirmId, allowed: true })}\n\n` +
              `data: ${JSON.stringify({ type: 'done', text: 'Carte supprimée.' })}\n\n`,
          ),
        );
        controller.close();
      };
    },
  });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/api/assistant/confirm')) {
      return Response.json({ ok: true });
    }
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });

  render(<AssistantChat csrfToken="tok" firstName="Angelo" />);
  await userEvent.type(screen.getByRole('textbox'), 'supprime la carte c1');
  await userEvent.click(screen.getByRole('button', { name: /envoyer/i }));

  // Le dialog apparaît avec la description et les deux boutons
  const allowButton = await screen.findByRole('button', { name: /autoriser/i });
  expect(screen.getByText(/delete_card/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refuser/i })).toBeInTheDocument();

  await userEvent.click(allowButton);
  await waitFor(() => {
    const confirmCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/api/assistant/confirm'),
    );
    expect(confirmCall).toBeDefined();
    const [, init] = confirmCall ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ id: confirmId, allowed: true });
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
  });

  pushSecondHalf();
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /autoriser/i })).not.toBeInTheDocument();
    expect(screen.getByText('Carte supprimée.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implémenter dans `assistant-chat.tsx`**

État : `const [pendingConfirm, setPendingConfirm] = useState<{ id: string; description: string } | null>(null);`

Gestion des événements dans la boucle de lecture :

```ts
if (event.type === 'confirm_request')
  setPendingConfirm({ id: event.id, description: event.description });
if (event.type === 'confirm_resolved') setPendingConfirm(null);
```

Handler de réponse :

```ts
const answerConfirm = useCallback(
  async (id: string, allowed: boolean) => {
    try {
      await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ id, allowed }),
      });
      // Le dialog se ferme à la réception de confirm_resolved (source de vérité serveur).
    } catch {
      setError('Impossible de transmettre la réponse — réessayez.');
    }
  },
  [csrfToken],
);
```

Rendu (dans le conteneur streaming, hors aria-live, style tokens — bordure accent, comme la maquette) :

```tsx
{
  pendingConfirm !== null && (
    <div
      role="alertdialog"
      aria-label="Confirmation requise"
      className="w-full self-start rounded-2xl border-2 px-4 py-3 text-sm"
      style={{ borderColor: 'var(--accent-primary)', background: 'var(--color-bg-card)' }}
    >
      <p
        className="text-xs font-bold uppercase tracking-wide"
        style={{ color: 'var(--accent-primary)' }}
      >
        ⚡ Confirmation requise
      </p>
      <p className="mt-1 break-words text-[color:var(--color-text-main)]">
        {pendingConfirm.description}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-full px-4 py-1.5 text-xs font-bold text-white"
          style={{ background: 'var(--accent-gradient)' }}
          onClick={() => void answerConfirm(pendingConfirm.id, true)}
        >
          Autoriser
        </button>
        <button
          type="button"
          className="rounded-full border border-[color:var(--color-border-light)] px-4 py-1.5 text-xs font-bold text-[color:var(--color-text-muted)]"
          onClick={() => void answerConfirm(pendingConfirm.id, false)}
        >
          Refuser
        </button>
        <span className="ml-auto self-center text-xs text-[color:var(--color-text-ghost)]">
          refus automatique dans 2 min
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sticky-scroll** — remplacer l'effet actuel par « coller en bas seulement si déjà proche du bas » :

```ts
const listRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  const list = listRef.current;
  if (list === null) return;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  if (nearBottom) bottomRef.current?.scrollIntoView?.({ block: 'end' });
}, [messages, streamText, pendingConfirm]);
```

(`listRef` posé sur le conteneur scrollable existant.)

- [ ] **Step 4: Pass + commit**

Run: `pnpm --filter web exec vitest run features/assistant && pnpm --filter web typecheck && pnpm --filter web lint`

```bash
git add apps/web/features/assistant
git commit -m "feat(assistant): inline allow/deny confirm dialog + sticky scroll"
```

---

### Task 11: Vérification de bout en bout

- [ ] **Step 1: Suites complètes**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tout vert (agent 100 %, web ≥ seuils).

- [ ] **Step 2: Rappel migration**

Confirmer avec le contrôleur que la migration `assistant_audit_actions` a été **appliquée sur Supabase** avant tout test réel (sinon les `recordAudit` échoueront silencieusement — fail-safe, mais l'audit serait vide).

- [ ] **Step 3: Vérification manuelle (`pnpm dev`, connecté, `ANTHROPIC_API_KEY` locale)**

1. « Crée une carte "Test agent" dans la colonne À faire du projet X » → carte créée, visible dans le Kanban (rafraîchir).
2. « Repousse son échéance à vendredi et assigne-moi dessus en responsible » → série exécutée, sortie mentionne l'état Bloqué le cas échéant.
3. « Supprime la carte Test agent » → **dialog Autoriser/Refuser** apparaît ; Refuser → l'agent confirme l'annulation, la carte existe toujours ; redemander → Autoriser → carte supprimée.
4. « Crée un projet "Test Assistant" pour le client Y avec le template Z » → projet créé avec colonnes + Bloqué + créateur lead.
5. Vérifier `audit_log` : lignes `assistant_turn`, `assistant_gate` (allowed true/false), `assistant_tool_run`, `card_deleted`.

- [ ] **Step 4: Commit final éventuel**

```bash
git add -A && git commit -m "chore(assistant): plan 2a verification fixes"
```

---

## Self-review (fait à l'écriture)

- **Couverture scope 2a** : confirm flow complet (Tasks 2-4, 9, 10), tools mutants Kanban + cores iso-comportement (Tasks 5-8), audit (Tasks 1, 9), reports Plan 1 (APIUserAbortError Task 9, Zod SSE Task 3, sticky-scroll Task 10). Hors scope 2a → 2b : mail (lazy body, brouillons, envoi gated, `list_my_mailboxes`), widgets `tool_result`, tests d'intégration route chat complets, clients/contacts/team tools.
- **Placeholders** : les Tasks 5-6 décrivent une extraction de code existant fourni intégralement dans le rapport d'exploration (référencé) — le code source EST le contenu à déplacer ; les squelettes de la Task 8 listent le contrat exact de chaque tool restant.
- **Cohérence types** : `ChatSseEvent` étendu (Task 3) consommé par route (Task 9), parser (Task 3) et UI (Task 10) ; `ConfirmStore.answer` outcomes (Task 2) mappés aux statuts HTTP (Task 4) ; cores `{ok}` (Tasks 5-6) consommés par tools (Task 8) et re-mappés `{status}` dans les actions form.
