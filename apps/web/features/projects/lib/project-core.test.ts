import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserScope } from '@nexushub/domain';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — see repo convention
// in card-core.test.ts.
const prismaMock = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    client: { findFirst: vi.fn() },
    kanbanTemplate: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    Prisma: { PrismaClientKnownRequestError },
  };
});
vi.mock('@nexushub/db', () => ({
  prisma: {
    client: prismaMock.client,
    kanbanTemplate: prismaMock.kanbanTemplate,
    project: prismaMock.project,
    $transaction: prismaMock.$transaction,
  },
  Prisma: prismaMock.Prisma,
}));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<UserScope>>(async () => ({ kind: 'workspace' as const })),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

import { createProjectCore, deleteProjectCore, updateProjectCore } from './project-core';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from './scope-error';
import type { CreateProjectInput } from './schemas';

const WORKSPACE_ID = 'ws-1';
const CLIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEMPLATE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const adminCtx = {
  userId: 'u-1',
  email: 'admin@test',
  workspaceId: WORKSPACE_ID,
  role: 'admin' as const,
  isSuperAdmin: false,
};

const viewerCtx = { ...adminCtx, role: 'viewer' as const };

function baseInput(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    name: 'New project',
    clientId: CLIENT_ID,
    description: null,
    startDate: null,
    endDate: null,
    typeId: null,
    templateId: 'creative',
    ...overrides,
  };
}

/** Minimal tx double covering every call made inside the transaction. */
function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectType: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'type-row-1' }),
    },
    project: {
      create: vi.fn().mockResolvedValue({ id: 'project-1' }),
    },
    column: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    projectMember: {
      create: vi.fn().mockResolvedValue({ id: 'member-1' }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeMocks.loadUserScope.mockResolvedValue({ kind: 'workspace' as const });
  prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_ID });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(makeTx()),
  );
});

describe('createProjectCore', () => {
  it('creates a project from a built-in template: type upsert, columns incl. Bloqué, lead member', async () => {
    let capturedColumns: { name: string; position: number; isBlockedSystem: boolean }[] = [];
    let capturedMember: { userId: string; role: string } | undefined;
    const tx = makeTx({
      column: {
        createMany: vi.fn().mockImplementation((args: { data: typeof capturedColumns }) => {
          capturedColumns = args.data;
          return Promise.resolve({ count: args.data.length });
        }),
      },
      projectMember: {
        create: vi.fn().mockImplementation((args: { data: typeof capturedMember }) => {
          capturedMember = args.data;
          return Promise.resolve({ id: 'member-1' });
        }),
      },
    });
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await createProjectCore(adminCtx, baseInput({ templateId: 'creative' }));

    expect(result).toEqual({ ok: true, projectId: 'project-1' });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    const names = capturedColumns.map((c) => c.name);
    expect(names).toEqual(['Brief', 'Créa', 'Validation', 'Production', 'Done', 'Bloqué']);
    const blocked = capturedColumns.find((c) => c.name === 'Bloqué');
    expect(blocked).toEqual({
      projectId: 'project-1',
      name: 'Bloqué',
      position: 9999,
      isBlockedSystem: true,
      stepChecklist: [],
    });

    expect(capturedMember).toEqual({
      projectId: 'project-1',
      userId: adminCtx.userId,
      role: 'lead',
    });
  });

  it('resolves a built-in typeId via ProjectType upsert-by-find (existing row reused)', async () => {
    const tx = makeTx({
      projectType: {
        findUnique: vi.fn().mockResolvedValue({ id: 'existing-type' }),
        create: vi.fn(),
      },
      project: {
        create: vi
          .fn()
          .mockImplementation((args: { data: { typeId?: string } }) =>
            Promise.resolve({ id: 'project-1', typeId: args.data.typeId }),
          ),
      },
    });
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await createProjectCore(adminCtx, baseInput({ typeId: 'campagne' }));

    expect(result.ok).toBe(true);
    expect(tx.projectType.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_name: { workspaceId: WORKSPACE_ID, name: 'Campagne' } },
      select: { id: true },
    });
    expect(tx.projectType.create).not.toHaveBeenCalled();
  });

  it('uses a DB Kanban template: snapshots defaultCardTemplateId + user columns + Bloqué appended', async () => {
    prismaMock.kanbanTemplate.findFirst.mockResolvedValueOnce({
      id: TEMPLATE_ID,
      defaultCardTemplateId: 'card-tpl-1',
      columns: [
        { name: 'Idea', stepChecklist: ['a'] },
        { name: 'Done', stepChecklist: [] },
      ],
    });
    let capturedColumns: { name: string; position: number; stepChecklist: string[] }[] = [];
    let capturedProjectData: { defaultCardTemplateId?: string } | undefined;
    const tx = makeTx({
      project: {
        create: vi.fn().mockImplementation((args: { data: typeof capturedProjectData }) => {
          capturedProjectData = args.data;
          return Promise.resolve({ id: 'project-1' });
        }),
      },
      column: {
        createMany: vi.fn().mockImplementation((args: { data: typeof capturedColumns }) => {
          capturedColumns = args.data;
          return Promise.resolve({ count: args.data.length });
        }),
      },
    });
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await createProjectCore(adminCtx, baseInput({ templateId: TEMPLATE_ID }));

    expect(result).toEqual({ ok: true, projectId: 'project-1' });
    expect(capturedProjectData?.defaultCardTemplateId).toBe('card-tpl-1');
    expect(capturedColumns.map((c) => c.name)).toEqual(['Idea', 'Done', 'Bloqué']);
    expect(capturedColumns[0]).toEqual({
      projectId: 'project-1',
      name: 'Idea',
      position: 1024,
      isBlockedSystem: false,
      stepChecklist: ['a'],
    });
    const blocked = capturedColumns.find((c) => c.name === 'Bloqué');
    expect(blocked).toEqual({
      projectId: 'project-1',
      name: 'Bloqué',
      position: 9999,
      isBlockedSystem: true,
      stepChecklist: [],
    });
  });

  it('returns "Template Kanban introuvable." when the DB template lookup misses', async () => {
    prismaMock.kanbanTemplate.findFirst.mockResolvedValueOnce(null);
    const result = await createProjectCore(adminCtx, baseInput({ templateId: TEMPLATE_ID }));
    expect(result).toEqual({ ok: false, message: 'Template Kanban introuvable.' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns "Template Kanban inconnu." for an unknown built-in template id', async () => {
    const result = await createProjectCore(adminCtx, baseInput({ templateId: 'not-a-template' }));
    expect(result).toEqual({ ok: false, message: 'Template Kanban inconnu.' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Client") when the client does not belong to the workspace', async () => {
    prismaMock.client.findFirst.mockResolvedValueOnce(null);
    await expect(createProjectCore(adminCtx, baseInput())).rejects.toThrow(/Client/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await createProjectCore(adminCtx, baseInput());
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.client.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('allows restricted scope that includes the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [CLIENT_ID],
      projectIds: [],
    });
    const result = await createProjectCore(adminCtx, baseInput());
    expect(result.ok).toBe(true);
  });

  it('returns "Un projet porte déjà ce nom." on a P2002 unique-constraint error', async () => {
    prismaMock.$transaction.mockImplementationOnce(async () => {
      throw new prismaMock.Prisma.PrismaClientKnownRequestError('duplicate', 'P2002');
    });
    const result = await createProjectCore(adminCtx, baseInput());
    expect(result).toEqual({ ok: false, message: 'Un projet porte déjà ce nom.' });
  });

  it('rethrows non-P2002 errors from the transaction', async () => {
    prismaMock.$transaction.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(createProjectCore(adminCtx, baseInput())).rejects.toThrow('boom');
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await createProjectCore(viewerCtx, baseInput());
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(scopeMocks.loadUserScope).not.toHaveBeenCalled();
    expect(prismaMock.client.findFirst).not.toHaveBeenCalled();
  });
});

describe('updateProjectCore', () => {
  const PROJECT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: PROJECT_ID,
      clientId: CLIENT_ID,
      startDate: null,
      endDate: null,
    });
    prismaMock.project.update.mockResolvedValue({});
  });

  it('writes only the fields provided and returns the RELU post-state', async () => {
    let capturedData: Record<string, unknown> | undefined;
    prismaMock.project.update.mockImplementationOnce((args: { data: Record<string, unknown> }) => {
      capturedData = args.data;
      return Promise.resolve({});
    });
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: null,
        endDate: null,
      }) // lookup
      .mockResolvedValueOnce({
        name: 'New name',
        description: null,
        startDate: null,
        endDate: null,
      }); // post-write reread

    const result = await updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'New name' });

    expect(capturedData).toEqual({ name: 'New name' });
    expect(result).toEqual({
      ok: true,
      name: 'New name',
      description: null,
      startDate: null,
      endDate: null,
    });
  });

  it('converts a startDate string to a Date and passes null through untouched', async () => {
    let capturedData: Record<string, unknown> | undefined;
    prismaMock.project.update.mockImplementationOnce((args: { data: Record<string, unknown> }) => {
      capturedData = args.data;
      return Promise.resolve({});
    });
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: null,
        endDate: null,
      })
      .mockResolvedValueOnce({
        name: 'Unchanged',
        description: null,
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: null,
      });

    const result = await updateProjectCore(adminCtx, {
      projectId: PROJECT_ID,
      startDate: '2026-05-01',
      endDate: null,
    });

    expect(capturedData?.['startDate']).toBeInstanceOf(Date);
    expect((capturedData?.['startDate'] as Date).toISOString().slice(0, 10)).toBe('2026-05-01');
    expect(capturedData).toHaveProperty('endDate', null);
    expect(result).toEqual({
      ok: true,
      name: 'Unchanged',
      description: null,
      startDate: '2026-05-01',
      endDate: null,
    });
  });

  it('refuses a provided startDate that lands after the CURRENT (unrelated-write) endDate', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: PROJECT_ID,
      clientId: CLIENT_ID,
      startDate: null,
      endDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    const result = await updateProjectCore(adminCtx, {
      projectId: PROJECT_ID,
      startDate: '2026-07-01',
    });

    expect(result).toEqual({
      ok: false,
      message: 'La date de fin doit être après la date de début',
    });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('refuses a provided endDate that lands before the CURRENT (unrelated-write) startDate', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: PROJECT_ID,
      clientId: CLIENT_ID,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: null,
    });

    const result = await updateProjectCore(adminCtx, {
      projectId: PROJECT_ID,
      endDate: '2026-06-01',
    });

    expect(result).toEqual({
      ok: false,
      message: 'La date de fin doit être après la date de début',
    });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('never refuses clearing (null) a bound, even against an inverted-looking remaining bound', async () => {
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-06-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        name: 'X',
        description: null,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: null,
      });

    const result = await updateProjectCore(adminCtx, { projectId: PROJECT_ID, endDate: null });

    expect(result.ok).toBe(true);
    expect(prismaMock.project.update).toHaveBeenCalled();
  });

  it('accepts consistent startDate + endDate both provided together', async () => {
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: null,
        endDate: null,
      })
      .mockResolvedValueOnce({
        name: 'X',
        description: null,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-08-01T00:00:00.000Z'),
      });

    const result = await updateProjectCore(adminCtx, {
      projectId: PROJECT_ID,
      startDate: '2026-07-01',
      endDate: '2026-08-01',
    });

    expect(result.ok).toBe(true);
  });

  it('returns "Un projet porte déjà ce nom." on a P2002 unique-constraint error', async () => {
    prismaMock.project.update.mockImplementationOnce(() => {
      throw new prismaMock.Prisma.PrismaClientKnownRequestError('duplicate', 'P2002');
    });
    const result = await updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'Dup' });
    expect(result).toEqual({ ok: false, message: 'Un projet porte déjà ce nom.' });
  });

  it('rethrows non-P2002 errors from the update', async () => {
    prismaMock.project.update.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'X' })).rejects.toThrow(
      'boom',
    );
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await updateProjectCore(viewerCtx, { projectId: PROJECT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('allows restricted scope that includes the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [CLIENT_ID],
      projectIds: [],
    });
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: null,
        endDate: null,
      })
      .mockResolvedValueOnce({ name: 'X', description: null, startDate: null, endDate: null });
    const result = await updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'X' });
    expect(result.ok).toBe(true);
  });

  it('throws NotFoundError("Project") when the project is outside the workspace', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);
    await expect(updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'X' })).rejects.toThrow(
      /Project/,
    );
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Project") if the post-write reread comes back empty', async () => {
    prismaMock.project.findFirst
      .mockResolvedValueOnce({
        id: PROJECT_ID,
        clientId: CLIENT_ID,
        startDate: null,
        endDate: null,
      })
      .mockResolvedValueOnce(null);
    await expect(updateProjectCore(adminCtx, { projectId: PROJECT_ID, name: 'X' })).rejects.toThrow(
      /Project/,
    );
  });
});

describe('deleteProjectCore', () => {
  const PROJECT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  beforeEach(() => {
    prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID, clientId: CLIENT_ID });
    prismaMock.project.update.mockResolvedValue({});
  });

  it('soft-deletes the project by flipping deletedAt', async () => {
    let capturedData: Record<string, unknown> | undefined;
    prismaMock.project.update.mockImplementationOnce(
      (args: { where: { id: string }; data: Record<string, unknown> }) => {
        capturedData = args.data;
        return Promise.resolve({});
      },
    );
    const result = await deleteProjectCore(adminCtx, { projectId: PROJECT_ID });
    expect(result).toEqual({ ok: true });
    expect(capturedData?.['deletedAt']).toBeInstanceOf(Date);
  });

  it("rejects Viewer with 'Action réservée aux Admins et Users.' and performs no lookup", async () => {
    const result = await deleteProjectCore(viewerCtx, { projectId: PROJECT_ID });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux Admins et Users.' });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the project or its client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: ['other-project'],
    });
    const result = await deleteProjectCore(adminCtx, { projectId: PROJECT_ID });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Project") when the project is outside the workspace', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);
    await expect(deleteProjectCore(adminCtx, { projectId: PROJECT_ID })).rejects.toThrow(/Project/);
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});
