# RACI des cartes multi-personnes — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** autoriser plusieurs Responsables (R) et Approbateurs (A) par carte. Spec : `docs/superpowers/specs/2026-11-13-raci-multi-roles-design.md`.

**Architecture :**

- Supprimer les deux index uniques partiels de `card_assignees`. La clé primaire `(card_id, user_id)` est conservée : une personne a un seul rôle par carte.
- Supprimer le message d'unicité dans les Server Actions.
- Mettre à jour la description du tool assistant et les docs.

**Tech Stack :** Prisma 6 / PostgreSQL (Supabase), Next.js Server Actions, Vitest.

---

### Task 1 : tests des Server Actions (TDD)

**Files :**

- Create : `apps/web/features/projects/actions/card-assignees.test.ts`

- [ ] **Step 1 : écrire les tests.** Ils couvrent trois cas :
  - un 2e `responsible` passe par `upsert` et renvoie `{ ok: true }` ;
  - une erreur P2002 n'est plus traduite en message d'unicité : elle est relancée ;
  - `updateCardAssigneeRaci` gère P2025 (« Assignation introuvable. ») et relance P2002.

  Les mocks suivent le schéma de `create-comment.test.ts` : `@nexushub/db`, `@/lib/auth`, `@/lib/auth/scope`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadUserScope: vi.fn(),
  cardFindFirst: vi.fn(),
  membershipFindFirst: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst },
    membership: { findFirst: mocks.membershipFindFirst },
    cardAssignee: { upsert: mocks.upsert, update: mocks.update },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/auth/scope', () => ({ loadUserScope: mocks.loadUserScope }));

import { addCardAssignee, updateCardAssigneeRaci } from './card-assignees';

const CARD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireUser.mockResolvedValue({ userId: 'me', workspaceId: WS, role: 'user' });
  mocks.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  mocks.cardFindFirst.mockResolvedValue({ id: CARD, projectId: 'p', project: { clientId: 'c' } });
  mocks.membershipFindFirst.mockResolvedValue({ id: 'm' });
});

describe('addCardAssignee — plusieurs personnes par rôle', () => {
  it.each(['responsible', 'approver'] as const)('accepte un 2e %s', async (raci) => {
    mocks.upsert.mockResolvedValue({});
    await expect(addCardAssignee({ cardId: CARD, userId: USER, raci })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { cardId: CARD, userId: USER, raci } }),
    );
  });

  it('ne traduit plus P2002 en message d’unicité R/A', async () => {
    mocks.upsert.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(
      addCardAssignee({ cardId: CARD, userId: USER, raci: 'responsible' }),
    ).rejects.toThrow('unique');
  });
});

describe('updateCardAssigneeRaci', () => {
  it('P2025 → assignation introuvable', async () => {
    mocks.update.mockRejectedValue(Object.assign(new Error('nf'), { code: 'P2025' }));
    await expect(
      updateCardAssigneeRaci({ cardId: CARD, userId: USER, raci: 'approver' }),
    ).resolves.toEqual({ ok: false, message: 'Assignation introuvable.' });
  });

  it('passe un 2e approver sans message d’unicité', async () => {
    mocks.update.mockResolvedValue({});
    await expect(
      updateCardAssigneeRaci({ cardId: CARD, userId: USER, raci: 'approver' }),
    ).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2 : lancer les tests.**
  - Commande : `cd apps/web && pnpm exec vitest run features/projects/actions/card-assignees.test.ts`
  - Résultat attendu : **FAIL** sur « ne traduit plus P2002 », parce qu'un message d'unicité est encore renvoyé.

### Task 2 : Server Actions

**Files :**

- Modify : `apps/web/features/projects/actions/card-assignees.ts`

- [ ] **Step 1 :** supprimer `raciUniqueMessage`.
- [ ] **Step 2 :** dans `addCardAssignee`, supprimer le `try/catch` P2002. L'`upsert` est appelé directement.
- [ ] **Step 3 :** dans `updateCardAssigneeRaci`, supprimer la branche P2002 et garder P2025.
- [ ] **Step 4 :** remplacer le JSDoc de `addCardAssignee` :

  ```ts
  /**
   * Assign a workspace member to a card with a RACI role. Several people may
   * share the same role (R/A/C/I) since 2026-11-13; the PK (card_id, user_id)
   * still gives each person a single role per card.
   */
  ```

- [ ] **Step 5 :** relancer les tests de la Task 1. Résultat attendu : **PASS**.

### Task 3 : tool assistant

**Files :**

- Modify : `apps/web/lib/assistant/tools/kanban-tools.ts` (description de `add_card_assignee`)
- Modify : `apps/web/lib/assistant/tools/kanban-tools.test.ts` (test « échec (ex. déjà un responsible) »)

- [ ] **Step 1 : nouvelle description du tool.**

  > « Assigne un membre du workspace à une carte avec un rôle RACI (responsible/approver/consulted/informed). Plusieurs personnes peuvent avoir le même rôle ; une personne n'a qu'un rôle par carte (réassigner = changer son rôle). Utiliser get_team_members pour trouver les userId. »

- [ ] **Step 2 : test.**
  - Remplacer le message mocké par `'Cet utilisateur n’appartient pas à l’espace.'`.
  - L'assertion devient `toContain('appartient')`.
  - Renommer le test en « échec (ex. non-membre) ».
- [ ] **Step 3 : ajouter un test** qui vérifie que la description ne contient plus « Un seul ».

### Task 4 : migration

**Files :**

- Create : `packages/db/prisma/migrations/20261113120000_card_assignees_multi_raci/migration.sql`
- Modify : `packages/db/prisma/schema.prisma` (commentaire de `CardAssignee`)

```sql
DROP INDEX IF EXISTS "public"."card_assignees_one_responsible_per_card";
DROP INDEX IF EXISTS "public"."card_assignees_one_accountable_per_card";
```

- [ ] **Step 1 : dry-run** dans une transaction annulée. Insérer 2 `responsible` sur une même carte : refus attendu avant la migration, acceptation après.
- [ ] **Step 2 : appliquer** : `prisma db execute --file …` puis `prisma migrate resolve --applied 20261113120000_card_assignees_multi_raci`.
- [ ] **Step 3 : vérifier** dans `pg_indexes` que les deux index ont disparu.

### Task 5 : docs, CI et PR

- [ ] **Step 1 :** CLAUDE.md §6.6. Ajouter : « Cartes : plusieurs membres peuvent partager un même rôle (R/A/C/I) ; un membre a un seul rôle par carte. » Ajouter aussi une ligne au journal.
- [ ] **Step 2 :** PRD, règles RACI. Ajouter la même phrase.
- [ ] **Step 3 :** progress.md. Ajouter une ligne au journal.
- [ ] **Step 4 :** commit, push (le hook pre-push lance `pnpm ci:local`), puis PR.
