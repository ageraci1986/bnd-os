import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserScope } from '@nexushub/domain';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — see repo convention
// in apps/web/features/projects/lib/card-core.test.ts.
const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  column: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  card: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<UserScope>>(async () => ({ kind: 'workspace' as const })),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

import {
  addColumnCore,
  deleteColumnCore,
  reorderColumnsCore,
  renameColumnCore,
} from './column-core';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from './scope-error';

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COLUMN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BLOCKED_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TARGET_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const BLOCKED_LOCKED_MESSAGE =
  'La colonne « Bloqué » est gérée par le système et ne peut pas être modifiée.';
const REORDER_MISMATCH_MESSAGE =
  'La liste doit contenir exactement toutes les colonnes du projet (hors « Bloqué »), sans doublon.';
const DELETE_LAST_COLUMN_MESSAGE = 'Impossible de supprimer la dernière colonne du projet.';

const adminCtx = {
  userId: 'u-1',
  email: 'admin@test',
  workspaceId: WORKSPACE_ID,
  role: 'admin' as const,
  isSuperAdmin: false,
};

const viewerCtx = { ...adminCtx, role: 'viewer' as const };

beforeEach(() => {
  vi.clearAllMocks();
  scopeMocks.loadUserScope.mockResolvedValue({ kind: 'workspace' as const });
  prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID, clientId: 'client-1' });
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe('addColumnCore', () => {
  it('positions the new column just before Bloqué (max non-system + 1000) and returns the post-state', async () => {
    prismaMock.column.findMany
      .mockResolvedValueOnce([{ position: 3000 }]) // max non-system position lookup
      .mockResolvedValueOnce([
        { id: 'c1', name: 'To do', position: 1000 },
        { id: 'new-col', name: 'Nouvelle colonne', position: 4000 },
        { id: BLOCKED_ID, name: 'Bloqué', position: 9999 },
      ]); // readColumns post-state
    prismaMock.column.create.mockResolvedValueOnce({ id: 'new-col' });

    const result = await addColumnCore(adminCtx, {
      projectId: PROJECT_ID,
      name: 'Nouvelle colonne',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.columnId).toBe('new-col');
    expect(result.columns).toHaveLength(3);

    expect(prismaMock.column.findMany.mock.calls[0]![0]).toMatchObject({
      where: { projectId: PROJECT_ID, isBlockedSystem: false },
      orderBy: { position: 'desc' },
      take: 1,
    });
    expect(prismaMock.column.create).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        name: 'Nouvelle colonne',
        position: 4000,
        isBlockedSystem: false,
      },
      select: { id: true },
    });
  });

  it('uses position 1000 when the project has no non-system columns yet', async () => {
    prismaMock.column.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'new-col', name: 'Nouvelle colonne', position: 1000 }]);
    prismaMock.column.create.mockResolvedValueOnce({ id: 'new-col' });

    await addColumnCore(adminCtx, { projectId: PROJECT_ID, name: 'Nouvelle colonne' });

    expect(prismaMock.column.create).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        name: 'Nouvelle colonne',
        position: 1000,
        isBlockedSystem: false,
      },
      select: { id: true },
    });
  });

  it('renumbers all non-system columns in one transaction when the candidate position would reach Bloqué (9999)', async () => {
    // top at 9000 → candidate 10000 ≥ BLOCKED_COLUMN_POSITION → compaction path.
    prismaMock.column.findMany
      .mockResolvedValueOnce([{ position: 9000 }]) // max non-system position lookup
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]) // non-system columns, ordered
      .mockResolvedValueOnce([
        { id: 'c1', name: 'A', position: 1999 },
        { id: 'c2', name: 'B', position: 3998 },
        { id: 'c3', name: 'C', position: 5997 },
        { id: 'new-col', name: 'Nouvelle colonne', position: 7996 },
        { id: BLOCKED_ID, name: 'Bloqué', position: 9999 },
      ]); // readColumns post-state
    prismaMock.column.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: { position: number } }) =>
        Promise.resolve({ id: where.id, ...data }),
    );
    prismaMock.column.create.mockResolvedValueOnce({ id: 'new-col' });

    const result = await addColumnCore(adminCtx, {
      projectId: PROJECT_ID,
      name: 'Nouvelle colonne',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.columnId).toBe('new-col');

    // The renumbering only ever reads/updates NON-system columns — Bloqué is
    // untouched by construction.
    expect(prismaMock.column.findMany.mock.calls[1]![0]).toMatchObject({
      where: { projectId: PROJECT_ID, isBlockedSystem: false },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    // step = max(1, floor(9999 / (3 + 2))) = 1999
    expect(prismaMock.column.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'c1' },
      data: { position: 1999 },
    });
    expect(prismaMock.column.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'c2' },
      data: { position: 3998 },
    });
    expect(prismaMock.column.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'c3' },
      data: { position: 5997 },
    });
    expect(prismaMock.column.update).toHaveBeenCalledTimes(3);
    const updatedIds = prismaMock.column.update.mock.calls.map(
      (call) => (call[0] as { where: { id: string } }).where.id,
    );
    expect(updatedIds).toEqual(['c1', 'c2', 'c3']);
    expect(updatedIds).not.toContain(BLOCKED_ID);

    // New column lands at (count + 1) * step = 7996 — strictly below Bloqué.
    expect(prismaMock.column.create).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        name: 'Nouvelle colonne',
        position: 7996,
        isBlockedSystem: false,
      },
      select: { id: true },
    });

    // Single transaction: 3 renumberings + 1 create.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(4);
  });

  it('does not open a transaction nor renumber in the nominal (non-overflow) case', async () => {
    prismaMock.column.findMany
      .mockResolvedValueOnce([{ position: 3000 }])
      .mockResolvedValueOnce([]);
    prismaMock.column.create.mockResolvedValueOnce({ id: 'new-col' });

    await addColumnCore(adminCtx, { projectId: PROJECT_ID, name: 'Nouvelle colonne' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await addColumnCore(viewerCtx, { projectId: PROJECT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Project") when the project is outside the workspace', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);
    await expect(addColumnCore(adminCtx, { projectId: PROJECT_ID, name: 'X' })).rejects.toThrow(
      /Project/,
    );
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await addColumnCore(adminCtx, { projectId: PROJECT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.column.create).not.toHaveBeenCalled();
  });

  it('rejects a blank name without querying anything else', async () => {
    const result = await addColumnCore(adminCtx, { projectId: PROJECT_ID, name: '   ' });
    expect(result).toEqual({ ok: false, message: 'Nom de colonne requis.' });
    expect(prismaMock.column.create).not.toHaveBeenCalled();
  });
});

describe('renameColumnCore', () => {
  beforeEach(() => {
    prismaMock.column.findFirst.mockResolvedValue({
      id: COLUMN_ID,
      projectId: PROJECT_ID,
      isBlockedSystem: false,
    });
    prismaMock.column.update.mockResolvedValue({ name: 'Nouveau nom' });
  });

  it('renames the column and returns the name re-read from the update', async () => {
    const result = await renameColumnCore(adminCtx, { columnId: COLUMN_ID, name: 'Nouveau nom' });
    expect(result).toEqual({ ok: true, name: 'Nouveau nom' });
    expect(prismaMock.column.update).toHaveBeenCalledWith({
      where: { id: COLUMN_ID },
      data: { name: 'Nouveau nom' },
      select: { name: true },
    });
  });

  it('scopes the lookup to the workspace via the project join', async () => {
    await renameColumnCore(adminCtx, { columnId: COLUMN_ID, name: 'Nouveau nom' });
    expect(prismaMock.column.findFirst).toHaveBeenCalledWith({
      where: { id: COLUMN_ID, project: { workspaceId: WORKSPACE_ID, deletedAt: null } },
      select: { id: true, projectId: true, isBlockedSystem: true },
    });
  });

  it('refuses to rename the Bloqué column', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce({
      id: BLOCKED_ID,
      projectId: PROJECT_ID,
      isBlockedSystem: true,
    });
    const result = await renameColumnCore(adminCtx, { columnId: BLOCKED_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: BLOCKED_LOCKED_MESSAGE });
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Column") when the column lookup misses', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce(null);
    await expect(renameColumnCore(adminCtx, { columnId: COLUMN_ID, name: 'X' })).rejects.toThrow(
      /Column/,
    );
  });

  it('rejects Viewer after the column lookup, without querying project scope', async () => {
    const result = await renameColumnCore(viewerCtx, { columnId: COLUMN_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.column.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await renameColumnCore(adminCtx, { columnId: COLUMN_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });

  it('rejects a blank name', async () => {
    const result = await renameColumnCore(adminCtx, { columnId: COLUMN_ID, name: '  ' });
    expect(result).toEqual({ ok: false, message: 'Nom de colonne requis.' });
    expect(prismaMock.column.update).not.toHaveBeenCalled();
  });
});

describe('reorderColumnsCore', () => {
  const idA = 'aaaaaaaa-0000-0000-0000-000000000001';
  const idB = 'aaaaaaaa-0000-0000-0000-000000000002';
  const idC = 'aaaaaaaa-0000-0000-0000-000000000003';

  beforeEach(() => {
    prismaMock.column.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: { position: number } }) =>
        Promise.resolve({ id: where.id, ...data }),
    );
  });

  it('reorders via a single array transaction with positions (index+1)*1000, returns the post-state', async () => {
    prismaMock.column.findMany
      .mockResolvedValueOnce([
        { id: idA, isBlockedSystem: false },
        { id: idB, isBlockedSystem: false },
        { id: idC, isBlockedSystem: false },
        { id: BLOCKED_ID, isBlockedSystem: true },
      ])
      .mockResolvedValueOnce([
        { id: idB, name: 'B', position: 1000 },
        { id: idC, name: 'C', position: 2000 },
        { id: idA, name: 'A', position: 3000 },
        { id: BLOCKED_ID, name: 'Bloqué', position: 9999 },
      ]);

    const result = await reorderColumnsCore(adminCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [idB, idC, idA],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.columns).toHaveLength(4);

    expect(prismaMock.column.update).toHaveBeenNthCalledWith(1, {
      where: { id: idB },
      data: { position: 1000 },
    });
    expect(prismaMock.column.update).toHaveBeenNthCalledWith(2, {
      where: { id: idC },
      data: { position: 2000 },
    });
    expect(prismaMock.column.update).toHaveBeenNthCalledWith(3, {
      where: { id: idA },
      data: { position: 3000 },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(3);
  });

  it('refuses a list missing a column, without touching the DB', async () => {
    prismaMock.column.findMany.mockResolvedValueOnce([
      { id: idA, isBlockedSystem: false },
      { id: idB, isBlockedSystem: false },
      { id: idC, isBlockedSystem: false },
    ]);
    const result = await reorderColumnsCore(adminCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [idA, idB], // missing idC
    });
    expect(result).toEqual({ ok: false, message: REORDER_MISMATCH_MESSAGE });
    expect(prismaMock.column.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a list with a duplicate id', async () => {
    prismaMock.column.findMany.mockResolvedValueOnce([
      { id: idA, isBlockedSystem: false },
      { id: idB, isBlockedSystem: false },
    ]);
    const result = await reorderColumnsCore(adminCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [idA, idA],
    });
    expect(result).toEqual({ ok: false, message: REORDER_MISMATCH_MESSAGE });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a list that includes the Bloqué column', async () => {
    prismaMock.column.findMany.mockResolvedValueOnce([
      { id: idA, isBlockedSystem: false },
      { id: idB, isBlockedSystem: false },
      { id: BLOCKED_ID, isBlockedSystem: true },
    ]);
    const result = await reorderColumnsCore(adminCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [idA, BLOCKED_ID, idB],
    });
    expect(result).toEqual({ ok: false, message: BLOCKED_LOCKED_MESSAGE });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects Viewer without querying anything', async () => {
    const result = await reorderColumnsCore(viewerCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [],
    });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await reorderColumnsCore(adminCtx, {
      projectId: PROJECT_ID,
      orderedColumnIds: [],
    });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.column.findMany).not.toHaveBeenCalled();
  });
});

describe('deleteColumnCore', () => {
  it('deletes an empty column: re-routes previousColumnId, no card re-parking, movedTo null', async () => {
    prismaMock.column.findFirst
      .mockResolvedValueOnce({ id: COLUMN_ID, projectId: PROJECT_ID, isBlockedSystem: false }) // initial lookup
      .mockResolvedValueOnce({ id: TARGET_ID, name: 'Target' }); // target lookup
    prismaMock.card.findMany.mockResolvedValueOnce([]); // cards in the deleted column
    prismaMock.card.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.column.delete.mockResolvedValueOnce({ id: COLUMN_ID });
    prismaMock.column.findMany.mockResolvedValueOnce([
      { id: TARGET_ID, name: 'Target', position: 1000 },
      { id: BLOCKED_ID, name: 'Bloqué', position: 9999 },
    ]); // readColumns post-state

    const result = await deleteColumnCore(adminCtx, { columnId: COLUMN_ID });

    expect(result).toEqual({
      ok: true,
      movedCards: 0,
      movedTo: null,
      columns: [
        { id: TARGET_ID, name: 'Target', position: 1000 },
        { id: BLOCKED_ID, name: 'Bloqué', position: 9999 },
      ],
    });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, previousColumnId: COLUMN_ID },
      data: { previousColumnId: TARGET_ID },
    });
    expect(prismaMock.column.delete).toHaveBeenCalledWith({ where: { id: COLUMN_ID } });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(2); // updateMany + delete
  });

  it('re-parks cards to the end of the target column inside the same transaction', async () => {
    prismaMock.column.findFirst
      .mockResolvedValueOnce({ id: COLUMN_ID, projectId: PROJECT_ID, isBlockedSystem: false })
      .mockResolvedValueOnce({ id: TARGET_ID, name: 'Target' });
    prismaMock.card.findMany
      .mockResolvedValueOnce([{ id: 'card-1' }, { id: 'card-2' }]) // cards in the deleted column
      .mockResolvedValueOnce([{ position: 5000 }]); // target's current max position
    prismaMock.card.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: unknown }) =>
        Promise.resolve({ id: where.id, ...(data as object) }),
    );
    prismaMock.card.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.column.delete.mockResolvedValueOnce({ id: COLUMN_ID });
    prismaMock.column.findMany.mockResolvedValueOnce([]);

    const result = await deleteColumnCore(adminCtx, { columnId: COLUMN_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.movedCards).toBe(2);
    expect(result.movedTo).toBe('Target');

    // base = (max target position ?? 0) + 1000 = 6000
    expect(prismaMock.card.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'card-1' },
      data: { columnId: TARGET_ID, position: 6000 },
    });
    expect(prismaMock.card.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'card-2' },
      data: { columnId: TARGET_ID, position: 7000 },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(4); // 2 card updates + updateMany + delete
  });

  it('uses base position 1000 when the target column has no cards yet', async () => {
    prismaMock.column.findFirst
      .mockResolvedValueOnce({ id: COLUMN_ID, projectId: PROJECT_ID, isBlockedSystem: false })
      .mockResolvedValueOnce({ id: TARGET_ID, name: 'Target' });
    prismaMock.card.findMany.mockResolvedValueOnce([{ id: 'card-1' }]).mockResolvedValueOnce([]); // target has no cards
    prismaMock.card.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: unknown }) =>
        Promise.resolve({ id: where.id, ...(data as object) }),
    );
    prismaMock.card.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.column.delete.mockResolvedValueOnce({ id: COLUMN_ID });
    prismaMock.column.findMany.mockResolvedValueOnce([]);

    await deleteColumnCore(adminCtx, { columnId: COLUMN_ID });

    expect(prismaMock.card.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { columnId: TARGET_ID, position: 1000 },
    });
  });

  it('refuses to delete the Bloqué column', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce({
      id: BLOCKED_ID,
      projectId: PROJECT_ID,
      isBlockedSystem: true,
    });
    const result = await deleteColumnCore(adminCtx, { columnId: BLOCKED_ID });
    expect(result).toEqual({ ok: false, message: BLOCKED_LOCKED_MESSAGE });
    expect(prismaMock.column.delete).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to delete the last remaining (non-system) column', async () => {
    prismaMock.column.findFirst
      .mockResolvedValueOnce({ id: COLUMN_ID, projectId: PROJECT_ID, isBlockedSystem: false })
      .mockResolvedValueOnce(null); // no other non-system column found
    prismaMock.card.findMany.mockResolvedValueOnce([]);

    const result = await deleteColumnCore(adminCtx, { columnId: COLUMN_ID });
    expect(result).toEqual({ ok: false, message: DELETE_LAST_COLUMN_MESSAGE });
    expect(prismaMock.column.delete).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Column") when the column lookup misses', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce(null);
    await expect(deleteColumnCore(adminCtx, { columnId: COLUMN_ID })).rejects.toThrow(/Column/);
  });

  it('rejects Viewer after the column lookup, without querying project scope', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce({
      id: COLUMN_ID,
      projectId: PROJECT_ID,
      isBlockedSystem: false,
    });
    const result = await deleteColumnCore(viewerCtx, { columnId: COLUMN_ID });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.column.delete).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce({
      id: COLUMN_ID,
      projectId: PROJECT_ID,
      isBlockedSystem: false,
    });
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await deleteColumnCore(adminCtx, { columnId: COLUMN_ID });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.column.delete).not.toHaveBeenCalled();
  });
});
