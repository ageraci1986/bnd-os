# Plan 5a — Assistant V2 : fiabilité, résolution de noms, CRUD projets/colonnes/checklist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'agent ne peut plus affirmer une action non vérifiée (lecture-après-écriture + widget board frais), résout les noms de projets en langage naturel (`find_projects`), et couvre le CRUD projets/colonnes/checklist — avec un gate qui affiche l'état **réel** lu en DB.

**Architecture:** Même pattern que les Plans 2a/2b : cores purs dans `features/projects/lib/` (nouveaux : colonnes, update/delete projet), tools = couches de traduction dans `lib/assistant/tools/` via `defineTool` + `safeMutation`. Une extension de `packages/agent` : `describeForConfirm` devient async-compatible pour que les confirmations gated lisent la vérité en DB (anti-spoofing par le modèle). Dédup des widgets board côté client par `projectId`.

**Tech Stack:** TypeScript strict, Zod, Prisma, Vitest. Aucune nouvelle dépendance. Aucune migration DB.

**Spec :** `docs/superpowers/specs/2026-07-28-assistant-v2-widgets-crud-design.md` (§3, §4, §5 lignes projets/colonnes/checklist)

**Branche :** `feat/assistant-v2-reliability`, à créer depuis `main` **après merge de la PR #12** (si #12 n'est pas mergée au moment de l'exécution : stopper et demander à l'utilisateur).

**Conventions transverses (valables pour toutes les tâches) :**

- Chaque commit : Conventional Commits, scope `agent` ou `assistant`, sujet ≤ 100 caractères.
- Chaque tool : `ctx` lié à la construction, jamais fourni par le modèle ; seuls des textes user-safe s'échappent des handlers (`failure()` / `safeMutation`).
- Aucune PII dans les logs ; les tests suivent les patterns des fichiers de test voisins (mock `@nexushub/db` via `vi.mock`, cf. `card-core.test.ts`).
- Commandes de test depuis la racine du repo : `pnpm --filter <pkg> test -- <fichier>` (web = `@nexushub/web`, agent = `@nexushub/agent`).

---

### Task 1: `describeForConfirm` async dans `packages/agent`

Le gate doit pouvoir afficher des données lues en DB (vrai nom du projet, nb de cartes) au lieu de données fournies par le modèle (spoofables). On élargit le type à `string | Promise<string>` — 100 % rétro-compatible.

**Files:**

- Modify: `packages/agent/src/types.ts` (ligne ~81)
- Modify: `packages/agent/src/run-turn.ts` (fonction `buildConfirmDescription`)
- Test: `packages/agent/src/run-turn.test.ts`

- [ ] **Step 1: Test qui échoue** — dans `run-turn.test.ts`, ajouter au describe existant sur le gate :

```ts
it('accepte un describeForConfirm async et attend sa résolution avant le Confirmer', async () => {
  const confirmer = vi.fn().mockResolvedValue(true);
  const tool = defineTool({
    name: 'del_thing',
    description: 'd',
    inputSchema: z.object({ id: z.string() }),
    jsonSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    gated: true,
    describeForConfirm: async (input) => `Supprimer « Vrai Nom » (${input.id}) — 3 cartes`,
    handler: async () => 'ok',
  });
  const registry = new ToolRegistry();
  registry.register(tool);
  const provider = scriptedProvider([
    { toolCalls: [{ id: 't1', name: 'del_thing', input: { id: 'x' } }] },
    { text: 'fini' },
  ]);
  await runTurn({ provider, registry, messages: [user('vas-y')], confirmer, role: 'admin' });
  expect(confirmer).toHaveBeenCalledWith('Supprimer « Vrai Nom » (x) — 3 cartes', 'del_thing');
});

it('describeForConfirm async qui rejette → fallback générique, pas de fuite', async () => {
  const confirmer = vi.fn().mockResolvedValue(false);
  const tool = defineTool({
    name: 'del_thing2',
    description: 'd',
    inputSchema: z.object({}),
    jsonSchema: { type: 'object', properties: {} },
    gated: true,
    describeForConfirm: async () => {
      throw new Error('secret interne');
    },
    handler: async () => 'ok',
  });
  const registry = new ToolRegistry();
  registry.register(tool);
  const provider = scriptedProvider([
    { toolCalls: [{ id: 't1', name: 'del_thing2', input: {} }] },
    { text: 'fini' },
  ]);
  await runTurn({ provider, registry, messages: [user('vas-y')], confirmer, role: 'admin' });
  const description = confirmer.mock.calls[0]?.[0] as string;
  expect(description).not.toContain('secret interne');
  expect(description).toContain('del_thing2');
});
```

(Réutiliser les helpers `scriptedProvider`/`user` déjà présents dans ce fichier de test ; si le fallback sync existant a déjà un test équivalent, calquer le wording attendu dessus.)

- [ ] **Step 2:** `pnpm --filter @nexushub/agent test -- run-turn` → FAIL (type + comportement).

- [ ] **Step 3: Implémentation** — dans `types.ts`, élargir le retour :

```ts
readonly describeForConfirm?: (input: never) => string | Promise<string>;
```

Dans `run-turn.ts`, `buildConfirmDescription` devient async et son appel est `await`é. Conserver le try/catch fallback existant (description générique « Confirmer l'action <tool> ? » ou wording actuel) — il couvre maintenant aussi le rejet de la promesse :

```ts
async function buildConfirmDescription(spec: ToolSpec, input: unknown): Promise<string> {
  if (spec.describeForConfirm === undefined) return `Confirmer l'action ${spec.name} ?`;
  try {
    return await (spec.describeForConfirm as (i: unknown) => string | Promise<string>)(input);
  } catch {
    return `Confirmer l'action ${spec.name} ?`;
  }
}
```

(Adapter le wording du fallback au wording actuellement en place dans le fichier — ne pas le changer.)

- [ ] **Step 4:** `pnpm --filter @nexushub/agent test` → tout passe, **couverture 100 % maintenue** (le package l'exige).

- [ ] **Step 5: Commit** — `feat(agent): describeForConfirm peut être async (gate lit la vérité en DB)`

---

### Task 2: Lecture-après-écriture sur `move_card` et `update_card`

Le bug d'origine : l'agent affirme « déplacé dans Fait » sans preuve. Désormais le résultat du tool contient l'état relu en DB après la transaction.

**Files:**

- Modify: `apps/web/lib/assistant/tools/kanban-tools.ts` (handlers `move_card` ~l.250 et `update_card` ~l.176)
- Test: `apps/web/lib/assistant/tools/kanban-tools.test.ts` (fichier existant — étendre)

- [ ] **Step 1: Tests qui échouent** — dans le describe `move_card` existant :

```ts
it('relit la carte après déplacement et renvoie nowInColumn/position depuis la DB', async () => {
  vi.mocked(moveCard).mockResolvedValue({ ok: true, position: 2048 });
  prismaMock.card.findFirst.mockResolvedValue({
    id: CARD_ID,
    columnId: COL_ID,
    column: { name: 'Fait' },
  } as never);
  const result = await run('move_card', {
    cardId: CARD_ID,
    targetColumnId: COL_ID,
    targetIndex: 1,
  });
  expect(prismaMock.card.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ id: CARD_ID, workspaceId: WORKSPACE_ID }),
    }),
  );
  expect(JSON.parse(result)).toEqual({
    moved: true,
    nowInColumn: 'Fait',
    position: 2048,
  });
});

it('si la relecture ne trouve plus la carte, le résultat le dit au lieu de confirmer', async () => {
  vi.mocked(moveCard).mockResolvedValue({ ok: true, position: 1 });
  prismaMock.card.findFirst.mockResolvedValue(null);
  const result = await run('move_card', {
    cardId: CARD_ID,
    targetColumnId: COL_ID,
    targetIndex: 0,
  });
  expect(result).toContain('vérification impossible');
});
```

Et dans le describe `update_card` : mocker la relecture `prismaMock.card.findFirst` → `{ title: 'Titre final', description: null, categoryTag: 'design' }` et pinner `JSON.parse(result)` = `{ updated: true, title: 'Titre final', categoryTag: 'design' }`. (Utiliser les constantes `CARD_ID`/`WORKSPACE_ID`/`run`/`prismaMock` déjà définies dans ce fichier de test ; si `prisma` n'y est pas encore mocké, ajouter le `vi.mock('@nexushub/db', …)` sur le modèle de `card-core.test.ts`.)

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- kanban-tools` → FAIL.

- [ ] **Step 3: Implémentation** — `kanban-tools.ts` importe `prisma` :

```ts
import { prisma } from '@nexushub/db';
```

Handler `move_card` :

```ts
handler: async (input) =>
  safeMutation('move_card', async () => {
    const result = await moveCard(input);
    if (!result.ok) return failure(result.message);
    // Lecture-après-écriture (spec V2 §3.1) : l'état renvoyé est RELU en DB,
    // jamais déduit de l'input — le modèle ne peut plus affirmer un état
    // qu'aucun tool n'a constaté.
    const after = await prisma.card.findFirst({
      where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { columnId: true, column: { select: { name: true } } },
    });
    if (after === null) {
      return 'Déplacement enregistré mais vérification impossible (carte introuvable à la relecture).';
    }
    return JSON.stringify({ moved: true, nowInColumn: after.column.name, position: result.position });
  }),
```

Handler `update_card` — après le `updateCard(...)` ok, relire :

```ts
const after = await prisma.card.findFirst({
  where: { id: input.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
  select: { title: true, description: true, categoryTag: true },
});
if (after === null) {
  return 'Mise à jour enregistrée mais vérification impossible (carte introuvable à la relecture).';
}
return JSON.stringify({
  updated: true,
  title: after.title,
  ...(after.categoryTag !== null ? { categoryTag: after.categoryTag } : {}),
});
```

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- kanban-tools` → PASS.

- [ ] **Step 5: Commit** — `feat(assistant): lecture-après-écriture sur move_card et update_card`

---

### Task 3: Tool `find_projects` (résolution de noms, insensible aux accents)

**Files:**

- Modify: `apps/web/lib/assistant/tools/read-tools.ts` (ajouter après `list_projects`, ~l.122)
- Test: `apps/web/lib/assistant/tools/read-tools.test.ts` (existant — étendre)

- [ ] **Step 1: Tests qui échouent** :

```ts
describe('find_projects', () => {
  it('cherche via unaccent et ne renvoie que les projets du workspace visibles par le scope', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: PROJECT_ID }]);
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: PROJECT_ID,
        name: 'Liste de course',
        client: { name: 'Perso' },
        _count: { cards: 3 },
      },
    ] as never);
    const result = await run('find_projects', { query: 'liste de course' });
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          deletedAt: null,
          id: { in: [PROJECT_ID] },
        }),
      }),
    );
    expect(JSON.parse(result)).toEqual([
      { id: PROJECT_ID, name: 'Liste de course', client: 'Perso', cards: 3 },
    ]);
  });

  it('zéro candidat → tableau vide (le prompt gère le message)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const result = await run('find_projects', { query: 'introuvable' });
    expect(JSON.parse(result)).toEqual([]);
    expect(prismaMock.project.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- read-tools` → FAIL.

- [ ] **Step 3: Implémentation** — deux temps : candidats par SQL brut paramétré (`$queryRaw` tagged template, **jamais** `$queryRawUnsafe`), puis re-filtrage Prisma qui porte workspace + scope (la logique de scope reste à un seul endroit) :

```ts
defineTool({
  name: 'find_projects',
  description:
    "Recherche un projet par nom approximatif (partiel, insensible aux accents et à la casse). À utiliser dès que l'utilisateur désigne un projet par son nom (« ma liste de courses ») au lieu d'un id. Renvoie jusqu'à 10 candidats.",
  inputSchema: z.object({ query: z.string().trim().min(1).max(120) }),
  jsonSchema: {
    type: 'object',
    properties: { query: { type: 'string', maxLength: 120 } },
    required: ['query'],
  },
  handler: async (input) =>
    safeDb('find_projects', async () => {
      // Même pattern unaccent que search-recipients.ts (migration
      // 20260724150000_enable_unaccent). Le SQL ne fait QUE présélectionner
      // des ids dans le workspace ; visibilité (scope) re-vérifiée en Prisma.
      const candidates = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects
        WHERE workspace_id = ${workspaceId}::uuid
          AND deleted_at IS NULL
          AND lower(unaccent(name)) LIKE '%' || lower(unaccent(${input.query})) || '%'
        ORDER BY name ASC
        LIMIT 10`;
      if (candidates.length === 0) return JSON.stringify([]);
      const projects = await prisma.project.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          id: { in: candidates.map((c) => c.id) },
          ...scopedProjectWhere(scope),
        },
        select: {
          id: true,
          name: true,
          client: { select: { name: true } },
          _count: { select: { cards: true } },
        },
        orderBy: { name: 'asc' },
      });
      return JSON.stringify(
        projects.map((p) => ({ id: p.id, name: p.name, client: p.client.name, cards: p._count.cards })),
      );
    }),
}),
```

(`workspaceId`, `scope`, `scopedProjectWhere`, `safeDb` sont déjà en closure dans `buildReadTools` — mêmes symboles que `list_projects`.)

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- read-tools` → PASS.

- [ ] **Step 5: Commit** — `feat(assistant): tool find_projects — résolution de noms unaccent`

---

### Task 4: Cores colonnes (`column-core.ts`)

Le CRUD colonnes n'existe nulle part dans l'app (les colonnes naissent du copy-on-create des templates) — on crée les cores, réutilisables plus tard par l'UI.

**Files:**

- Create: `apps/web/features/projects/lib/column-core.ts`
- Test: `apps/web/features/projects/lib/column-core.test.ts`

Règles métier (spec V2 §5 + CLAUDE.md §6.3) :

- La colonne **Bloqué** (`isBlockedSystem`) : ni renommable, ni supprimable, ni déplaçable, ni ciblable par `addColumnCore` (position toujours dernière, 9999).
- `deleteColumnCore` : si la colonne contient des cartes, elles sont déplacées **en fin de première colonne restante non-Bloqué** (transaction) ; impossible de supprimer la dernière colonne non-Bloqué.
- `reorderColumnsCore` : reçoit la liste ordonnée **complète** des ids non-Bloqué du projet — refus explicite si un id manque, est en trop, ou est la colonne Bloqué.
- Tous les cores : `ctx.role === Viewer` → refus ; lookup workspace-scoped via le join projet ; scope restricted vérifié comme dans `createProjectCore` ; retour `{ok:true, …post-état}` ou `{ok:false, message}`.

- [ ] **Step 1: Tests qui échouent** — `column-core.test.ts`, mock `@nexushub/db` sur le modèle de `card-core.test.ts`. Couvrir au minimum :

```ts
describe('addColumnCore', () => {
  it('ajoute la colonne avant Bloqué et renvoie le post-état des colonnes');
  it('refuse pour un Viewer');
  it('jette NotFoundError si le projet est hors workspace');
});
describe('renameColumnCore', () => {
  it('renomme et renvoie {ok:true, name} relu');
  it('refuse la colonne Bloqué avec un message explicite');
});
describe('reorderColumnsCore', () => {
  it('applique les positions dans l’ordre fourni (positions espacées de 1000)');
  it('refuse si la liste ne couvre pas exactement les colonnes non-Bloqué');
  it('refuse si la liste contient la colonne Bloqué');
});
describe('deleteColumnCore', () => {
  it('supprime une colonne vide');
  it('déplace les cartes vers la première colonne restante puis supprime (transaction)');
  it('refuse la colonne Bloqué');
  it('refuse la dernière colonne non-Bloqué');
  it('renvoie movedCards et le post-état colonnes');
});
```

Chaque `it` écrit en entier (mocks + asserts) par l'implémenteur en suivant le style de `card-core.test.ts` — les comportements attendus sont ceux du Step 3, qui fait foi.

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- column-core` → FAIL (module inexistant).

- [ ] **Step 3: Implémentation** — `column-core.ts` :

```ts
import 'server-only';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from './scope-error';

const BLOCKED_LOCKED_MESSAGE =
  'La colonne « Bloqué » est gérée par le système et ne peut pas être modifiée.';
const POSITION_STEP = 1000;

export type ColumnSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly position: number;
};
type Ok<T> = { readonly ok: true } & T;
type Err = { readonly ok: false; readonly message: string };

/** Post-état : colonnes non supprimées du projet, ordonnées, Bloqué incluse. */
async function readColumns(projectId: string): Promise<ColumnSnapshot[]> {
  return prisma.column.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, position: true },
  });
}

/** Charge projet + garde rôle/scope communs à tous les cores colonnes. */
async function guardProject(ctx: AuthContext, projectId: string): Promise<{ ok: true } | Err> {
  if (ctx.role === Roles.Viewer) return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) throw new NotFoundError('Project');
  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
  return { ok: true };
}

export async function addColumnCore(
  ctx: AuthContext,
  input: { projectId: string; name: string },
): Promise<Ok<{ columnId: string; columns: ColumnSnapshot[] }> | Err> {
  const guard = await guardProject(ctx, input.projectId);
  if (!guard.ok) return guard;
  // Insérée avant Bloqué : position = max des non-système + step.
  const last = await prisma.column.findFirst({
    where: { projectId: input.projectId, isBlockedSystem: false },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const created = await prisma.column.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      position: (last?.position ?? 0) + POSITION_STEP,
    },
    select: { id: true },
  });
  return { ok: true, columnId: created.id, columns: await readColumns(input.projectId) };
}

export async function renameColumnCore(
  ctx: AuthContext,
  input: { columnId: string; name: string },
): Promise<Ok<{ name: string }> | Err> {
  const column = await prisma.column.findFirst({
    where: { id: input.columnId, project: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: { id: true, projectId: true, isBlockedSystem: true },
  });
  if (!column) throw new NotFoundError('Column');
  const guard = await guardProject(ctx, column.projectId);
  if (!guard.ok) return guard;
  if (column.isBlockedSystem) return { ok: false, message: BLOCKED_LOCKED_MESSAGE };
  const updated = await prisma.column.update({
    where: { id: column.id },
    data: { name: input.name },
    select: { name: true },
  });
  return { ok: true, name: updated.name };
}

export async function reorderColumnsCore(
  ctx: AuthContext,
  input: { projectId: string; orderedColumnIds: string[] },
): Promise<Ok<{ columns: ColumnSnapshot[] }> | Err> {
  const guard = await guardProject(ctx, input.projectId);
  if (!guard.ok) return guard;
  const existing = await prisma.column.findMany({
    where: { projectId: input.projectId },
    select: { id: true, isBlockedSystem: true },
  });
  const blocked = existing.filter((c) => c.isBlockedSystem).map((c) => c.id);
  const movable = existing.filter((c) => !c.isBlockedSystem).map((c) => c.id);
  if (input.orderedColumnIds.some((id) => blocked.includes(id))) {
    return { ok: false, message: BLOCKED_LOCKED_MESSAGE };
  }
  const sameSet =
    input.orderedColumnIds.length === movable.length &&
    input.orderedColumnIds.every((id) => movable.includes(id)) &&
    new Set(input.orderedColumnIds).size === input.orderedColumnIds.length;
  if (!sameSet) {
    return {
      ok: false,
      message:
        'La liste doit contenir exactement toutes les colonnes du projet (hors « Bloqué »), sans doublon.',
    };
  }
  await prisma.$transaction(
    input.orderedColumnIds.map((id, index) =>
      prisma.column.update({ where: { id }, data: { position: (index + 1) * POSITION_STEP } }),
    ),
  );
  return { ok: true, columns: await readColumns(input.projectId) };
}

export async function deleteColumnCore(
  ctx: AuthContext,
  input: { columnId: string },
): Promise<Ok<{ movedCards: number; movedTo: string | null; columns: ColumnSnapshot[] }> | Err> {
  const column = await prisma.column.findFirst({
    where: { id: input.columnId, project: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: { id: true, projectId: true, isBlockedSystem: true },
  });
  if (!column) throw new NotFoundError('Column');
  const guard = await guardProject(ctx, column.projectId);
  if (!guard.ok) return guard;
  if (column.isBlockedSystem) return { ok: false, message: BLOCKED_LOCKED_MESSAGE };

  const target = await prisma.column.findFirst({
    where: { projectId: column.projectId, isBlockedSystem: false, NOT: { id: column.id } },
    orderBy: { position: 'asc' },
    select: { id: true, name: true },
  });
  if (!target) {
    return { ok: false, message: 'Impossible de supprimer la dernière colonne du projet.' };
  }

  const lastCard = await prisma.card.findFirst({
    where: { columnId: target.id, deletedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const base = (lastCard?.position ?? 0) + POSITION_STEP;
  const cards = await prisma.card.findMany({
    where: { columnId: column.id, deletedAt: null },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  await prisma.$transaction([
    ...cards.map((card, index) =>
      prisma.card.update({
        where: { id: card.id },
        data: { columnId: target.id, position: base + index * POSITION_STEP },
      }),
    ),
    prisma.column.delete({ where: { id: column.id } }),
  ]);
  return {
    ok: true,
    movedCards: cards.length,
    movedTo: cards.length > 0 ? target.name : null,
    columns: await readColumns(column.projectId),
  };
}
```

**Point d'attention implémenteur :** vérifier dans `packages/domain` comment `previousColumnId` (auto-blocked, CLAUDE.md §6.3) référence les colonnes — si des cartes en Bloqué ont `previousColumnId` = colonne supprimée, les re-router vers `target.id` dans la même transaction (ajouter le `updateMany` correspondant + un test).

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- column-core` → PASS.

- [ ] **Step 5: Commit** — `feat(projects): cores colonnes (add/rename/reorder/delete, Bloqué protégée)`

---

### Task 5: Cores projet — `updateProjectCore` + `deleteProjectCore` (extraction iso-comportement)

**Files:**

- Modify: `apps/web/features/projects/lib/project-core.ts`
- Modify: `apps/web/features/projects/actions/delete-project.ts` (délègue au core, garde redirect)
- Test: `apps/web/features/projects/lib/project-core.test.ts` (étendre)

- [ ] **Step 1: Tests qui échouent** :

```ts
describe('updateProjectCore', () => {
  it('met à jour les champs fournis seulement et renvoie le post-état relu', async () => {
    // arrange : project.findFirst → {id, clientId}, scope full,
    // project.update → …, relecture findFirst → {name:'Nouveau', description:null, startDate:null, endDate:null}
    // assert : update appelé avec data ne contenant QUE name ;
    // résultat {ok:true, name:'Nouveau', description:null, startDate:null, endDate:null}
  });
  it('conflit de nom (P2002) → message user-safe « Un projet porte déjà ce nom. »');
  it('refuse pour un Viewer');
});
describe('deleteProjectCore', () => {
  it('soft-delete (deletedAt) et renvoie {ok:true}');
  it('scope restricted non autorisé → SCOPE_ERROR_MESSAGE');
});
```

(Écrire les mocks/asserts complets sur le modèle des tests `createProjectCore` du même fichier. Pour P2002 : `prismaMock.project.update.mockRejectedValue(Object.assign(new Error('e'), { code: 'P2002' }))` — vérifier le type exact utilisé ailleurs, `Prisma.PrismaClientKnownRequestError` est déjà manipulé dans `memory.ts`.)

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- project-core` → FAIL.

- [ ] **Step 3: Implémentation** — dans `project-core.ts` :

```ts
export type UpdateProjectCoreInput = {
  projectId: string;
  name?: string;
  description?: string | null;
  startDate?: string | null; // YYYY-MM-DD, déjà validée par le tool
  endDate?: string | null;
};

export async function updateProjectCore(
  ctx: AuthContext,
  input: UpdateProjectCoreInput,
): Promise<
  | {
      ok: true;
      name: string;
      description: string | null;
      startDate: string | null;
      endDate: string | null;
    }
  | { ok: false; message: string }
> {
  if (ctx.role === Roles.Viewer) return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) throw new NotFoundError('Project');
  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
  try {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate === null ? null : new Date(input.startDate) }
          : {}),
        ...(input.endDate !== undefined
          ? { endDate: input.endDate === null ? null : new Date(input.endDate) }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'Un projet porte déjà ce nom.' };
    }
    throw error;
  }
  // Lecture-après-écriture (spec V2 §3.1).
  const after = await prisma.project.findFirst({
    where: { id: project.id, workspaceId: ctx.workspaceId },
    select: { name: true, description: true, startDate: true, endDate: true },
  });
  if (after === null) throw new NotFoundError('Project');
  const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));
  return {
    ok: true,
    name: after.name,
    description: after.description,
    startDate: iso(after.startDate),
    endDate: iso(after.endDate),
  };
}

/**
 * Iso-comportement extrait de l'action deleteProject (ADR 0001 #15 : soft
 * delete, corbeille 30 j). L'action garde revalidatePath + redirect.
 */
export async function deleteProjectCore(
  ctx: AuthContext,
  input: { projectId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: 'Action réservée aux Admins et Users.' };
  }
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) throw new NotFoundError('Project');
  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
  await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
```

Refactor `delete-project.ts` : le corps devient `requireUserVerified()` + Zod + `deleteProjectCore(ctx, parsed.data)` puis, si ok, `revalidatePath('/projects'); redirect('/projects');`. **Iso-comportement strict** : mêmes messages, même ordre de vérifications (l'action utilisait `requireUserVerified` — le core prend le `ctx` en paramètre, la différence de loader reste dans l'action ; le tool passera son propre ctx déjà vérifié). `delete-project.test.ts` existant doit rester vert sans modification autre que les éventuels mocks du core.

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- project-core delete-project` → PASS.

- [ ] **Step 5: Commit** — `feat(projects): updateProjectCore + deleteProjectCore (iso-extraction)`

---

### Task 6: Tools projets + colonnes (dont `delete_project` gated avec vérité DB)

**Files:**

- Modify: `apps/web/lib/assistant/tools/kanban-tools.ts`
- Test: `apps/web/lib/assistant/tools/kanban-tools.test.ts`

- [ ] **Step 1: Tests qui échouent** — nouveaux describes :

```ts
describe('update_project', () => {
  it('délègue à updateProjectCore et renvoie le post-état JSON');
  it('date invalide (2026-02-30) → refus Zod avant le core');
});
describe('delete_project', () => {
  it('est gated');
  it('describeForConfirm lit nom + nb de cartes en DB (pas depuis l’input)', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      name: 'Liste de course',
      _count: { cards: 3 },
    } as never);
    const spec = getSpec('delete_project'); // helper existant du fichier de test, sinon registry lookup
    const description = await spec.describeForConfirm?.({ projectId: PROJECT_ID } as never);
    expect(description).toContain('Liste de course');
    expect(description).toContain('3 carte');
  });
  it('describeForConfirm avec projet introuvable → description prudente sans nom');
});
describe('add_column / rename_column / reorder_columns', () => {
  it('délèguent aux cores et renvoient le post-état');
});
describe('delete_column', () => {
  it('est gated');
  it('describeForConfirm annonce le déplacement des cartes (nb + colonne cible) lu en DB');
});
```

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- kanban-tools` → FAIL.

- [ ] **Step 3: Implémentation** — dans `buildKanbanTools`, ajouter (imports : `updateProjectCore`, `deleteProjectCore`, cores colonnes) :

```ts
defineTool({
  name: 'update_project',
  description:
    "Met à jour un projet : nom, description, dates de début/fin (YYYY-MM-DD, null pour effacer). Les champs non fournis restent inchangés.",
  inputSchema: z.object({
    projectId: uuid,
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(2000).nullable().optional(),
    startDate: z.string().regex(DATE_RE, DATE_FORMAT_MESSAGE).refine(isValidCalendarDate, DATE_INVALID_MESSAGE).nullable().optional(),
    endDate: z.string().regex(DATE_RE, DATE_FORMAT_MESSAGE).refine(isValidCalendarDate, DATE_INVALID_MESSAGE).nullable().optional(),
  }),
  jsonSchema: {
    type: 'object',
    properties: {
      projectId: UUID_JSON,
      name: { type: 'string', maxLength: 160 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      startDate: { type: ['string', 'null'], pattern: DATE_RE.source },
      endDate: { type: ['string', 'null'], pattern: DATE_RE.source },
    },
    required: ['projectId'],
  },
  handler: async (input) =>
    safeMutation('update_project', async () => {
      const result = await updateProjectCore(ctx, {
        projectId: input.projectId,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      });
      if (!result.ok) return failure(result.message);
      const { ok: _ok, ...state } = result;
      return JSON.stringify({ updated: true, ...state });
    }),
}),

defineTool({
  name: 'delete_project',
  description:
    'Supprime un projet (corbeille, restaurable 30 jours par un Admin). Action sensible : confirmation utilisateur requise.',
  inputSchema: z.object({ projectId: uuid }),
  jsonSchema: { type: 'object', properties: { projectId: UUID_JSON }, required: ['projectId'] },
  gated: true,
  // Vérité lue en DB (Task 1) : le modèle ne peut pas faire confirmer un
  // autre projet que celui réellement visé par l'id.
  describeForConfirm: async (input: { projectId: string }) => {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { name: true, _count: { select: { cards: true } } },
    });
    if (project === null) return 'Supprimer un projet introuvable dans ce workspace ?';
    const n = project._count.cards;
    return `Supprimer le projet « ${project.name} » (${n} carte${n > 1 ? 's' : ''}) — restaurable 30 jours ?`;
  },
  handler: async (input) =>
    safeMutation('delete_project', async () => {
      const result = await deleteProjectCore(ctx, input);
      return result.ok ? 'Projet supprimé (corbeille 30 jours).' : failure(result.message);
    }),
}),
```

Colonnes — mêmes patterns :

```ts
defineTool({
  name: 'add_column',
  description: "Ajoute une colonne au Kanban d'un projet (insérée avant « Bloqué »).",
  inputSchema: z.object({ projectId: uuid, name: z.string().trim().min(1).max(60) }),
  jsonSchema: {
    type: 'object',
    properties: { projectId: UUID_JSON, name: { type: 'string', maxLength: 60 } },
    required: ['projectId', 'name'],
  },
  handler: async (input) =>
    safeMutation('add_column', async () => {
      const result = await addColumnCore(ctx, input);
      if (!result.ok) return failure(result.message);
      return JSON.stringify({ created: true, columnId: result.columnId, columns: result.columns });
    }),
}),

defineTool({
  name: 'rename_column',
  description: 'Renomme une colonne (« Bloqué » est intouchable).',
  inputSchema: z.object({ columnId: uuid, name: z.string().trim().min(1).max(60) }),
  jsonSchema: {
    type: 'object',
    properties: { columnId: UUID_JSON, name: { type: 'string', maxLength: 60 } },
    required: ['columnId', 'name'],
  },
  handler: async (input) =>
    safeMutation('rename_column', async () => {
      const result = await renameColumnCore(ctx, input);
      if (!result.ok) return failure(result.message);
      return JSON.stringify({ renamed: true, name: result.name });
    }),
}),

defineTool({
  name: 'reorder_columns',
  description:
    "Réordonne les colonnes d'un projet. Fournir la liste complète et ordonnée des ids de colonnes, hors « Bloqué » (qui reste en dernier).",
  inputSchema: z.object({ projectId: uuid, orderedColumnIds: z.array(uuid).min(1).max(30) }),
  jsonSchema: {
    type: 'object',
    properties: {
      projectId: UUID_JSON,
      orderedColumnIds: { type: 'array', items: UUID_JSON, minItems: 1, maxItems: 30 },
    },
    required: ['projectId', 'orderedColumnIds'],
  },
  handler: async (input) =>
    safeMutation('reorder_columns', async () => {
      const result = await reorderColumnsCore(ctx, input);
      if (!result.ok) return failure(result.message);
      return JSON.stringify({ reordered: true, columns: result.columns });
    }),
}),

defineTool({
  name: 'delete_column',
  description:
    "Supprime une colonne. Si elle contient des cartes, elles sont déplacées vers la première colonne du projet. Action sensible : confirmation requise.",
  inputSchema: z.object({ columnId: uuid }),
  jsonSchema: { type: 'object', properties: { columnId: UUID_JSON }, required: ['columnId'] },
  gated: true,
  describeForConfirm: async (input: { columnId: string }) => {
    const column = await prisma.column.findFirst({
      where: { id: input.columnId, project: { workspaceId: ctx.workspaceId, deletedAt: null } },
      select: { name: true, isBlockedSystem: true, _count: { select: { cards: { where: { deletedAt: null } } } } },
    });
    if (column === null) return 'Supprimer une colonne introuvable dans ce workspace ?';
    const n = column._count.cards;
    return n === 0
      ? `Supprimer la colonne vide « ${column.name} » ?`
      : `Supprimer la colonne « ${column.name} » et déplacer ses ${n} carte${n > 1 ? 's' : ''} vers la première colonne du projet ?`;
  },
  handler: async (input) =>
    safeMutation('delete_column', async () => {
      const result = await deleteColumnCore(ctx, input);
      if (!result.ok) return failure(result.message);
      return JSON.stringify({
        deleted: true,
        movedCards: result.movedCards,
        movedTo: result.movedTo,
        columns: result.columns,
      });
    }),
}),
```

**Note spec §5 :** le gate de `delete_column` est inconditionnel ici (la spec disait « ⚡ si elle contient des cartes ») : `gated` est statique dans `ToolSpec`. Le describeForConfirm distingue les deux cas — pour une colonne vide la confirmation est triviale. Déviation assumée, à mentionner dans la PR.
_(Si `_count.cards.where` n'est pas supporté par la version Prisma en place, remplacer par un `prisma.card.count({ where: { columnId, deletedAt: null } })` séparé.)_

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- kanban-tools` → PASS.

- [ ] **Step 5: Commit** — `feat(assistant): tools projets et colonnes (delete gated, confirm véridique)`

---

### Task 7: Checklist — `get_card_details` (lecture) + `set_checklist_item` (mutation + auto-avancement)

L'agent ne voit pas les items de checklist (get_project_board ne renvoie que id/titre/due) — il lui faut un tool de détail avant de pouvoir cocher.

**Files:**

- Modify: `apps/web/lib/assistant/tools/read-tools.ts` (`get_card_details`)
- Modify: `apps/web/lib/assistant/tools/kanban-tools.ts` (`set_checklist_item`)
- Test: les deux fichiers de test correspondants

- [ ] **Step 1: Tests qui échouent** :

```ts
describe('get_card_details', () => {
  it('renvoie titre, description, échéance, colonne, assignés (prénoms) et checklist avec ids', async () => {
    // mock prisma.card.findFirst (workspace + deletedAt null + scope) →
    // { id, title, description, dueDate, column: {name}, assignees: [{user:{firstName}, raci}],
    //   checklistItems: [{id, title, isChecked, position}] }
    // assert JSON : { id, title, description, due, column, assignees:[{name, raci}],
    //   checklist:[{id, title, checked}] } — checklist ordonnée par position
  });
  it('carte hors workspace → message « Carte introuvable. »');
});
describe('set_checklist_item', () => {
  it('délègue à toggleChecklistItem et renvoie le décompte post-état', async () => {
    vi.mocked(toggleChecklistItem).mockResolvedValue({
      ok: true,
      items: [
        { id: 'i1', title: 'A', isChecked: true },
        { id: 'i2', title: 'B', isChecked: false },
      ],
    } as never);
    const result = await run('set_checklist_item', { itemId: ITEM_ID, isChecked: true });
    expect(JSON.parse(result)).toEqual({
      updated: true,
      checked: 1,
      total: 2,
      autoAdvanced: false,
    });
  });
  it('dernier item coché → appelle advanceCard et renvoie autoAdvanced + nowInColumn', async () => {
    vi.mocked(toggleChecklistItem).mockResolvedValue({
      ok: true,
      items: [{ id: 'i1', title: 'A', isChecked: true }],
    } as never);
    vi.mocked(advanceCard).mockResolvedValue({
      ok: true,
      moved: true,
      toColumnName: 'Fait',
    } as never);
    const result = await run('set_checklist_item', {
      itemId: ITEM_ID,
      isChecked: true,
      cardId: CARD_ID,
    });
    expect(advanceCard).toHaveBeenCalledWith({ cardId: CARD_ID });
    expect(JSON.parse(result)).toMatchObject({
      updated: true,
      autoAdvanced: true,
      nowInColumn: 'Fait',
    });
  });
  it('décocher ne déclenche jamais advanceCard');
});
```

**Avant d'écrire ces tests**, lire `apps/web/features/projects/actions/checklist.ts` (`ChecklistMutationResult` exact) et `advance-card.ts` (`AdvanceCardResult` exact — champ portant le nom de la colonne d'arrivée) et ajuster les mocks/asserts à la forme réelle. Le comportement cible, lui, ne bouge pas : décompte relu, auto-avancement **immédiat** côté agent (le délai de 1800 ms est une fenêtre d'annulation UI, sans objet dans un tool).

- [ ] **Step 2:** Tests → FAIL.

- [ ] **Step 3: Implémentation** :

`get_card_details` (read-tools.ts) :

```ts
defineTool({
  name: 'get_card_details',
  description:
    "Détails d'une carte : description, échéance, colonne, assignés RACI, et items de checklist (avec leur id, pour set_checklist_item).",
  inputSchema: z.object({ cardId: uuid }),
  jsonSchema: { type: 'object', properties: { cardId: UUID_JSON }, required: ['cardId'] },
  handler: async (input) =>
    safeDb('get_card_details', async () => {
      const card = await prisma.card.findFirst({
        where: {
          id: input.cardId,
          workspaceId,
          deletedAt: null,
          project: scopedProjectWhere(scope).project ?? {},
        },
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
          column: { select: { name: true } },
          assignees: { select: { raci: true, user: { select: { firstName: true } } } },
          checklistItems: {
            orderBy: { position: 'asc' },
            select: { id: true, title: true, isChecked: true },
          },
        },
      });
      if (card === null) return 'Carte introuvable.';
      return JSON.stringify({
        id: card.id,
        title: card.title,
        description: card.description,
        due: card.dueDate === null ? null : card.dueDate.toISOString().slice(0, 10),
        column: card.column.name,
        assignees: card.assignees.map((a) => ({ name: a.user.firstName, raci: a.raci })),
        checklist: card.checklistItems.map((i) => ({ id: i.id, title: i.title, checked: i.isChecked })),
      });
    }),
}),
```

_(Adapter la clause `project:` à la forme réelle de `scopedProjectWhere` — reprendre exactement la construction du `where` de `get_project_board` qui résout déjà ce point pour un lookup par projet ; pour une carte, transposer sur la relation `project`. Vérifier aussi les noms exacts des relations dans `schema.prisma` : `assignees`/`checklistItems` — corriger si la relation s'appelle autrement.)_

`set_checklist_item` (kanban-tools.ts) — imports `toggleChecklistItem`, `advanceCard` :

```ts
defineTool({
  name: 'set_checklist_item',
  description:
    "Coche ou décoche un item de checklist d'une carte (ids via get_card_details). Fournir cardId : si le dernier item vient d'être coché, la carte avance automatiquement de colonne (règle métier NexusHub) et le résultat l'indique.",
  inputSchema: z.object({ itemId: uuid, cardId: uuid, isChecked: z.boolean() }),
  jsonSchema: {
    type: 'object',
    properties: { itemId: UUID_JSON, cardId: UUID_JSON, isChecked: { type: 'boolean' } },
    required: ['itemId', 'cardId', 'isChecked'],
  },
  handler: async (input) =>
    safeMutation('set_checklist_item', async () => {
      const result = await toggleChecklistItem({ itemId: input.itemId, isChecked: input.isChecked });
      if (!result.ok) return failure(result.message);
      const items = result.items;
      const checked = items.filter((i) => i.isChecked).length;
      const allChecked = items.length > 0 && checked === items.length;
      if (input.isChecked && allChecked) {
        const advanced = await advanceCard({ cardId: input.cardId });
        if (advanced.ok && advanced.moved) {
          return JSON.stringify({
            updated: true, checked, total: items.length,
            autoAdvanced: true, nowInColumn: advanced.toColumnName,
          });
        }
      }
      return JSON.stringify({ updated: true, checked, total: items.length, autoAdvanced: false });
    }),
}),
```

_(Champs `items`/`toColumnName` : ajuster aux types réels relevés au Step 1.)_

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- read-tools kanban-tools` → PASS.

- [ ] **Step 5: Commit** — `feat(assistant): get_card_details + set_checklist_item (auto-avancement)`

---

### Task 8: Dédup du widget board côté client

**Files:**

- Create: `apps/web/features/assistant/components/widgets/dedupe-widgets.ts`
- Modify: `apps/web/features/assistant/components/assistant-chat.tsx` (handler `tool_result`, ~l.207)
- Test: `apps/web/features/assistant/components/widgets/dedupe-widgets.test.ts`

- [ ] **Step 1: Test qui échoue** :

```ts
import { describe, expect, it } from 'vitest';
import { appendWidget } from './dedupe-widgets';

const board = (projectId: string, name: string) => ({
  tool: 'get_project_board' as const,
  data: { id: projectId, name, columns: [] },
});

describe('appendWidget', () => {
  it('remplace un board existant du même projet (le plus récent gagne, à sa nouvelle position)', () => {
    const widgets = [board('p1', 'avant'), { tool: 'list_projects' as const, data: [] }];
    const next = appendWidget(widgets, board('p1', 'après'));
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ tool: 'list_projects', data: [] });
    expect(next[1]).toMatchObject({ data: { name: 'après' } });
  });
  it('conserve deux boards de projets différents', () => {
    const next = appendWidget([board('p1', 'a')], board('p2', 'b'));
    expect(next).toHaveLength(2);
  });
  it('les autres tools sont simplement ajoutés', () => {
    const next = appendWidget([board('p1', 'a')], { tool: 'search_mails' as const, data: [] });
    expect(next).toHaveLength(2);
  });
  it('board sans id exploitable → ajout simple, pas de crash', () => {
    const next = appendWidget([board('p1', 'a')], {
      tool: 'get_project_board' as const,
      data: 'junk',
    });
    expect(next).toHaveLength(2);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- dedupe-widgets` → FAIL.

- [ ] **Step 3: Implémentation** — `dedupe-widgets.ts` (module pur, sans React) :

```ts
import type { StreamWidget } from '../lib/sse';

/** projectId d'un widget board, ou null si la donnée n'a pas la forme attendue. */
function boardProjectId(widget: StreamWidget): string | null {
  if (widget.tool !== 'get_project_board') return null;
  const data: unknown = widget.data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Ajoute un widget au fil en garantissant qu'un seul board par projet est
 * affiché : l'état le plus récent remplace l'ancien (spec V2 §3.2 — un board
 * périmé ne peut plus contredire le texte de l'agent). Les autres widgets
 * sont ajoutés tels quels.
 */
export function appendWidget(
  widgets: readonly StreamWidget[],
  incoming: StreamWidget,
): StreamWidget[] {
  const incomingProject = boardProjectId(incoming);
  if (incomingProject === null) return [...widgets, incoming];
  return [...widgets.filter((w) => boardProjectId(w) !== incomingProject), incoming];
}
```

Dans `assistant-chat.tsx`, remplacer l'accumulation du handler `tool_result` (`widgets = [...widgets, …]`) par :

```ts
widgets = appendWidget(widgets, { tool: event.tool, data: trimWidgetData(event.tool, event.data) });
```

_(Reprendre exactement l'expression actuellement poussée dans le tableau — y compris `trimWidgetData` si déjà présent — en ne changeant que l'append en `appendWidget`. Vérifier le type exact `StreamWidget` dans `features/assistant/lib/sse.ts` et importer depuis le bon chemin.)_

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- dedupe-widgets assistant-chat` → PASS (les tests existants d'assistant-chat restent verts).

- [ ] **Step 5: Commit** — `feat(assistant): dédup du widget board par projet (état frais uniquement)`

---

### Task 9: Règles system prompt (fiabilité + résolution de noms)

**Files:**

- Modify: `apps/web/lib/assistant/system-prompt.ts` (bloc « Utilise tes tools… », l.49)
- Test: `apps/web/lib/assistant/system-prompt.test.ts`

- [ ] **Step 1: Tests qui échouent** :

```ts
it('contient les règles de fiabilité (post-état, relire le board, jamais affirmer sans résultat)', () => {
  const prompt = buildSystemPrompt(base);
  expect(prompt).toContain('résultat du tool');
  expect(prompt).toContain('get_project_board');
  expect(prompt).toContain('relis le board');
});

it('contient la règle de résolution de noms via find_projects', () => {
  const prompt = buildSystemPrompt(base);
  expect(prompt).toContain('find_projects');
  expect(prompt).toContain('cherche d');
});
```

- [ ] **Step 2:** `pnpm --filter @nexushub/web test -- system-prompt` → FAIL.

- [ ] **Step 3: Implémentation** — remplacer la ligne l.49 (« Utilise tes tools quand ils aident… ») par :

```ts
"Utilise tes tools quand ils aident ; si un tool échoue, explique le problème simplement au lieu de deviner. Fiabilité absolue : ne dis jamais qu'une action est faite sans le résultat du tool qui le prouve dans ce tour — tes résultats de tools contiennent l'état relu en base (nowInColumn, position…), appuie-toi dessus, et après avoir modifié des cartes ou des colonnes, relis le board avec get_project_board pour montrer l'état à jour. Quand l'utilisateur désigne quelque chose par son nom (« ma liste de courses », « le projet Acme ») sans id, cherche d'abord — find_projects pour les projets, list_clients pour les clients — au lieu de refuser ; plusieurs candidats : demande lequel ; aucun : dis-le et propose de le créer.",
```

- [ ] **Step 4:** `pnpm --filter @nexushub/web test -- system-prompt` → PASS.

- [ ] **Step 5: Commit** — `feat(assistant): règles prompt fiabilité + résolution de noms`

---

### Task 10: Suites complètes + docs + revue finale

**Files:**

- Modify: `progress.md` (section Assistant : ligne Plan 5a)
- Modify: `CLAUDE.md` (§11 journal : une ligne)

- [ ] **Step 1:** `pnpm turbo run test typecheck lint` (racine) → tout vert, y compris couverture (`@nexushub/agent` 100 %).
- [ ] **Step 2:** Vérifier qu'aucun nouveau tool ne manque à l'appel : `grep -c "defineTool" apps/web/lib/assistant/tools/kanban-tools.ts` → 16 (8 existants + 8 nouveaux : update_project, delete_project, add_column, rename_column, reorder_columns, delete_column, set_checklist_item — soit 15 — plus find_projects et get_card_details côté read-tools). Ajuster le compte au réel et vérifier l'enregistrement via le test de registry existant s'il y en a un.
- [ ] **Step 3:** `progress.md` : ajouter la ligne Plan 5a (fiabilité + find_projects + CRUD projets/colonnes/checklist, date, statut). `CLAUDE.md` §11 : une ligne datée 2026-07-28.
- [ ] **Step 4: Commit** — `docs: progress et journal pour assistant plan 5a`
- [ ] **Step 5:** Revue finale holistique de la branche (superpowers:code-reviewer) : tracer un flux de bout en bout (« déplace X dans Fait » → move_card → lecture-après-écriture → get_project_board → dédup widget) et vérifier les describeForConfirm async (aucune PII au-delà de ce que l'utilisateur voit déjà, lecture DB workspace-scopée). Verdict ready-for-PR requis avant la PR.

---

## Self-review (fait à l'écriture)

- **Couverture spec** : §3.1 (Tasks 2, 5, 6, 7 — post-état partout), §3.2 (Tasks 8, 9), §3.3 (Task 9), §4 (Tasks 3, 9), §5 lignes projets/colonnes/checklist (Tasks 4-7). Le reste du §5 = Plan 5b ; §6-7 = Plan 5c.
- **Écarts assumés** (à reporter dans la PR) : gate `delete_column` inconditionnel (spec disait « si cartes ») ; `update_project` sans champ `statut` (le modèle Project n'a pas de statut — champs réels : name/description/startDate/endDate) ; `set_checklist_item` exige `cardId` en plus d'`itemId` (évite une relecture pour l'auto-avancement).
- **Types inter-tâches** : `describeForConfirm` async (Task 1) consommé Tasks 6 ; cores (Tasks 4-5) consommés Tasks 6-7 ; `appendWidget` (Task 8) consomme `StreamWidget` existant.
- **Placeholders** : les steps de test des Tasks 4-5 listent les `it` et renvoient au style du fichier voisin + comportement du Step 3 qui fait foi — voulu pour rester DRY, le comportement attendu est intégralement spécifié dans le code du Step 3.
