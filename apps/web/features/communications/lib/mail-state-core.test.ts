import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — repo convention, see
// `apps/web/features/clients/lib/client-core.test.ts`.
const prismaMock = vi.hoisted(() => ({
  emailMessage: { updateMany: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({
  prisma: { emailMessage: prismaMock.emailMessage },
}));

const auditMocks = vi.hoisted(() => ({
  recordAudit: vi.fn(async (_entry: unknown) => undefined),
}));
vi.mock('@/lib/audit', () => auditMocks);

import { MAIL_BULK_MAX, setMailStateCore } from './mail-state-core';
import { VIEWER_READ_ONLY_MESSAGE } from '@/features/projects/lib/scope-error';

const WORKSPACE_ID = 'ws-1';
const USER_ID = 'u-1';
const MAIL_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MAIL_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const adminCtx = {
  userId: USER_ID,
  email: 'admin@test',
  workspaceId: WORKSPACE_ID,
  role: 'admin' as const,
  isSuperAdmin: false,
};

const viewerCtx = { ...adminCtx, role: 'viewer' as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setMailStateCore — Viewer refusal', () => {
  it('refuses a Viewer without touching the DB', async () => {
    const result = await setMailStateCore(viewerCtx, { mailIds: [MAIL_A], op: 'read' });

    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.emailMessage.updateMany).not.toHaveBeenCalled();
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe('setMailStateCore — input validation', () => {
  it('refuses an empty mailIds list without touching the DB', async () => {
    const result = await setMailStateCore(adminCtx, { mailIds: [], op: 'read' });

    expect(result).toEqual({ ok: false, message: 'Aucun mail fourni.' });
    expect(prismaMock.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('refuses more than MAIL_BULK_MAX (100) unique ids without touching the DB', async () => {
    const ids = Array.from({ length: MAIL_BULK_MAX + 1 }, (_, i) => `id-${i}`);

    const result = await setMailStateCore(adminCtx, { mailIds: ids, op: 'read' });

    expect(result).toEqual({
      ok: false,
      message: `Maximum ${MAIL_BULK_MAX} mails par opération.`,
    });
    expect(prismaMock.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('deduplicates mailIds before counting: 2 identical ids count as 1 in `fournis`', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    const result = await setMailStateCore(adminCtx, {
      mailIds: [MAIL_A, MAIL_A],
      op: 'read',
    });

    expect(prismaMock.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [MAIL_A] } }),
      }),
    );
    expect(result).toEqual({ ok: true, affected: 1, skipped: 0 });
  });
});

describe('setMailStateCore — where clause (owner-only)', () => {
  it('scopes to workspace, non-deleted, and the caller-owned integration', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 2 });

    await setMailStateCore(adminCtx, { mailIds: [MAIL_A, MAIL_B], op: 'read' });

    expect(prismaMock.emailMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [MAIL_A, MAIL_B] },
        workspaceId: WORKSPACE_ID,
        deletedAt: null,
        integration: { ownerUserId: USER_ID },
      },
      data: { isRead: true },
    });
  });

  it('does NOT filter on archivedAt — read/unread must work on archived mails too', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    await setMailStateCore(adminCtx, { mailIds: [MAIL_A], op: 'unread' });

    const call = prismaMock.emailMessage.updateMany.mock.calls[0]?.[0];
    expect(call.where).not.toHaveProperty('archivedAt');
  });
});

describe('setMailStateCore — data per op', () => {
  it.each([
    ['read', { isRead: true }],
    ['unread', { isRead: false }],
  ] as const)('op=%s writes exactly %o', async (op, expectedData) => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    await setMailStateCore(adminCtx, { mailIds: [MAIL_A], op });

    expect(prismaMock.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expectedData }),
    );
  });

  it('op=archive writes { archivedAt: <Date> }', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    await setMailStateCore(adminCtx, { mailIds: [MAIL_A], op: 'archive' });

    const call = prismaMock.emailMessage.updateMany.mock.calls[0]?.[0];
    expect(call.data).toEqual({ archivedAt: expect.any(Date) });
  });

  it('op=delete writes { deletedAt: <Date> }', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    await setMailStateCore(adminCtx, { mailIds: [MAIL_A], op: 'delete' });

    const call = prismaMock.emailMessage.updateMany.mock.calls[0]?.[0];
    expect(call.data).toEqual({ deletedAt: expect.any(Date) });
  });
});

describe('setMailStateCore — skipped count', () => {
  it('reports skipped = fournis - count when some mails are not owned/found', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 1 });

    const result = await setMailStateCore(adminCtx, {
      mailIds: [MAIL_A, MAIL_B],
      op: 'read',
    });

    expect(result).toEqual({ ok: true, affected: 1, skipped: 1 });
  });

  it('reports skipped = 0 when every mail was affected', async () => {
    prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 2 });

    const result = await setMailStateCore(adminCtx, {
      mailIds: [MAIL_A, MAIL_B],
      op: 'read',
    });

    expect(result).toEqual({ ok: true, affected: 2, skipped: 0 });
  });
});

describe('setMailStateCore — audit', () => {
  it.each([
    ['read', 'mail_marked_read'],
    ['unread', 'mail_marked_unread'],
    ['archive', 'mail_archived'],
    ['delete', 'mail_deleted'],
  ] as const)(
    'op=%s records a single counted audit entry with action=%s, no ids/PII',
    async (op, action) => {
      prismaMock.emailMessage.updateMany.mockResolvedValue({ count: 2 });

      await setMailStateCore(adminCtx, { mailIds: [MAIL_A, MAIL_B], op });

      expect(auditMocks.recordAudit).toHaveBeenCalledTimes(1);
      expect(auditMocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          workspaceId: WORKSPACE_ID,
          actorId: USER_ID,
          data: { count: 2 },
        }),
      );
      const entry = auditMocks.recordAudit.mock.calls[0]?.[0];
      expect(JSON.stringify(entry)).not.toContain(MAIL_A);
      expect(JSON.stringify(entry)).not.toContain(MAIL_B);
    },
  );
});

describe('setMailStateCore — DB failure propagation', () => {
  it('rejects when updateMany fails, without recording an audit entry', async () => {
    prismaMock.emailMessage.updateMany.mockRejectedValue(new Error('db down'));

    await expect(setMailStateCore(adminCtx, { mailIds: [MAIL_A], op: 'read' })).rejects.toThrow(
      'db down',
    );
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });
});
