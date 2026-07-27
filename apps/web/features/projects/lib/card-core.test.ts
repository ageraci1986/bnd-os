import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserScope } from '@nexushub/domain';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — see repo convention
// in apps/web/lib/assistant/tools/read-tools.test.ts.
const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  column: { findFirst: vi.fn() },
  cardTemplate: { findFirst: vi.fn() },
  card: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<UserScope>>(async () => ({ kind: 'workspace' as const })),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

const auditMocks = vi.hoisted(() => ({
  recordAudit: vi.fn(async () => undefined),
}));
vi.mock('@/lib/audit', () => auditMocks);

import { createCardCore, deleteCardCore } from './card-core';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from './scope-error';

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COLUMN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CARD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PROPOSED_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
  prismaMock.column.findFirst.mockResolvedValue({ id: COLUMN_ID, stepChecklist: [] });
  prismaMock.card.findMany.mockResolvedValue([]);
  prismaMock.cardTemplate.findFirst.mockResolvedValue(null);
  prismaMock.project.findFirst.mockResolvedValue({
    id: PROJECT_ID,
    clientId: 'client-1',
    defaultCardTemplateId: null,
  });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      card: {
        create: vi.fn().mockResolvedValue({ id: 'new-card', shortRef: 7, title: 'New card' }),
      },
      checklistItem: { createMany: vi.fn() },
    }),
  );
});

describe('createCardCore', () => {
  it('creates the card and returns ok with cardId/shortRef/title', async () => {
    const result = await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(result).toEqual({ ok: true, cardId: 'new-card', shortRef: 7, title: 'New card' });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('scopes every lookup to workspaceId', async () => {
    await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(prismaMock.project.findFirst.mock.calls[0]![0].where.workspaceId).toBe(WORKSPACE_ID);
    expect(prismaMock.column.findFirst.mock.calls[0]![0].where.project.workspaceId).toBe(
      WORKSPACE_ID,
    );
    expect(prismaMock.cardTemplate.findFirst.mock.calls[0]![0].where.workspaceId).toBe(
      WORKSPACE_ID,
    );
  });

  it('computes position via computeCardPosition (appended at bottom of siblings)', async () => {
    prismaMock.card.findMany.mockResolvedValueOnce([{ position: 1024 }, { position: 2048 }]);
    await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    let capturedData: { position: number } | undefined;
    const txArg = prismaMock.$transaction.mock.calls[0]![0] as (tx: unknown) => Promise<unknown>;
    await txArg({
      card: {
        create: vi.fn().mockImplementation((args: { data: { position: number } }) => {
          capturedData = args.data;
          return Promise.resolve({ id: 'new-card', shortRef: 7, title: 'New card' });
        }),
      },
      checklistItem: { createMany: vi.fn() },
    });
    expect(capturedData?.position).toBeGreaterThan(2048);
  });

  it('creates template default checklist + step checklist with the exact position math', async () => {
    prismaMock.cardTemplate.findFirst.mockResolvedValueOnce({
      id: 'tpl-1',
      body: '',
      defaultChecklist: [],
      items: [{ id: 'checklist', type: 'checklist', items: ['Step A', 'Step B'] }],
    });
    prismaMock.column.findFirst.mockResolvedValueOnce({
      id: COLUMN_ID,
      stepChecklist: ['Onboard', 'Kickoff'],
    });
    const createManyCalls: unknown[][] = [];
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        card: {
          create: vi.fn().mockResolvedValue({ id: 'new-card', shortRef: 7, title: 'New card' }),
        },
        checklistItem: {
          createMany: vi.fn().mockImplementation((args: { data: unknown[] }) => {
            createManyCalls.push(args.data);
            return Promise.resolve();
          }),
        },
      }),
    );
    await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(createManyCalls).toHaveLength(2);
    const defaults = createManyCalls[0] as { title: string; position: number }[];
    expect(defaults.map((d) => d.title)).toEqual(['Step A', 'Step B']);
    expect(defaults[0]!.position).toBe(1024);
    expect(defaults[1]!.position).toBe(2048);

    const step = createManyCalls[1] as {
      title: string;
      position: number;
      columnSourceId: string;
    }[];
    expect(step.map((s) => s.title)).toEqual(['Onboard', 'Kickoff']);
    // offset = (defaults.length + 1) * 1024 = 3072
    expect(step[0]!.position).toBe(3072 + 1024);
    expect(step[1]!.position).toBe(3072 + 2048);
    expect(step[0]!.columnSourceId).toBe(COLUMN_ID);
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await createCardCore(viewerCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it('returns "Projet introuvable." when the project lookup misses', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);
    const result = await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(result).toEqual({ ok: false, message: 'Projet introuvable.' });
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
  });

  it('allows restricted scope that includes the project client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['client-1'],
      projectIds: [],
    });
    const result = await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
    });
    expect(result.ok).toBe(true);
  });

  it('throws NotFoundError("Column") when the column lookup misses', async () => {
    prismaMock.column.findFirst.mockResolvedValueOnce(null);
    await expect(
      createCardCore(adminCtx, { projectId: PROJECT_ID, columnId: COLUMN_ID, title: 'New card' }),
    ).rejects.toThrow(/Column/);
  });

  it('ignores an invalid proposedId (not treated as an error, id omitted from create)', async () => {
    let capturedData: { id?: string } | undefined;
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        card: {
          create: vi.fn().mockImplementation((args: { data: { id?: string } }) => {
            capturedData = args.data;
            return Promise.resolve({ id: 'new-card', shortRef: 7, title: 'New card' });
          }),
        },
        checklistItem: { createMany: vi.fn() },
      }),
    );
    const result = await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
      proposedId: 'not-a-uuid',
    });
    expect(result.ok).toBe(true);
    expect(capturedData?.id).toBeUndefined();
  });

  it('uses a valid proposedId as the card id', async () => {
    let capturedData: { id?: string } | undefined;
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        card: {
          create: vi.fn().mockImplementation((args: { data: { id?: string } }) => {
            capturedData = args.data;
            return Promise.resolve({ id: PROPOSED_ID, shortRef: 7, title: 'New card' });
          }),
        },
        checklistItem: { createMany: vi.fn() },
      }),
    );
    await createCardCore(adminCtx, {
      projectId: PROJECT_ID,
      columnId: COLUMN_ID,
      title: 'New card',
      proposedId: PROPOSED_ID,
    });
    expect(capturedData?.id).toBe(PROPOSED_ID);
  });
});

describe('deleteCardCore', () => {
  beforeEach(() => {
    prismaMock.card.findFirst.mockResolvedValue({
      id: CARD_ID,
      projectId: PROJECT_ID,
      project: { clientId: 'client-1' },
    });
    prismaMock.card.update.mockResolvedValue({ id: CARD_ID });
  });

  it('soft-deletes the card and records a card_deleted audit entry', async () => {
    const result = await deleteCardCore(adminCtx, { cardId: CARD_ID });
    expect(result).toEqual({ ok: true });
    expect(prismaMock.card.update).toHaveBeenCalledWith({
      where: { id: CARD_ID },
      data: { deletedAt: expect.any(Date) },
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith({
      action: 'card_deleted',
      workspaceId: WORKSPACE_ID,
      actorId: adminCtx.userId,
      subjectType: 'card',
      subjectId: CARD_ID,
    });
  });

  it('scopes the card lookup to workspaceId and excludes soft-deleted rows', async () => {
    await deleteCardCore(adminCtx, { cardId: CARD_ID });
    const where = prismaMock.card.findFirst.mock.calls[0]![0].where;
    expect(where.workspaceId).toBe(WORKSPACE_ID);
    expect(where.deletedAt).toBeNull();
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await deleteCardCore(viewerCtx, { cardId: CARD_ID });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.card.findFirst).not.toHaveBeenCalled();
  });

  it('returns "Carte introuvable." when the card lookup misses, no audit recorded', async () => {
    prismaMock.card.findFirst.mockResolvedValueOnce(null);
    const result = await deleteCardCore(adminCtx, { cardId: CARD_ID });
    expect(result).toEqual({ ok: false, message: 'Carte introuvable.' });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the card project or client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await deleteCardCore(adminCtx, { cardId: CARD_ID });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
  });

  it('returns "Identifiant carte invalide." for a non-UUID cardId', async () => {
    const result = await deleteCardCore(adminCtx, { cardId: 'not-a-uuid' });
    expect(result).toEqual({ ok: false, message: 'Identifiant carte invalide.' });
    expect(prismaMock.card.findFirst).not.toHaveBeenCalled();
  });
});
