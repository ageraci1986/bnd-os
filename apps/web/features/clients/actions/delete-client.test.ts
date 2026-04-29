import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  clientFindFirst,
  clientUpdate,
  contactUpdateMany,
  prismaTransaction,
  requireUserMock,
  assertCsrfMock,
  recordAuditMock,
  redirectMock,
  headersMock,
  clientIpMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  clientUpdate: vi.fn(),
  contactUpdateMany: vi.fn(),
  prismaTransaction: vi.fn(),
  requireUserMock: vi.fn(),
  assertCsrfMock: vi.fn(),
  recordAuditMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  headersMock: vi.fn(),
  clientIpMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    client: { findFirst: clientFindFirst, update: clientUpdate },
    contact: { updateMany: contactUpdateMany },
    $transaction: prismaTransaction,
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: assertCsrfMock }));
vi.mock('@/lib/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: clientIpMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { deleteClient } from './delete-client';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  clientFindFirst.mockReset();
  clientUpdate.mockReset();
  contactUpdateMany.mockReset();
  prismaTransaction.mockReset();
  requireUserMock.mockReset();
  assertCsrfMock.mockReset();
  recordAuditMock.mockReset();
  redirectMock.mockClear();
  headersMock.mockReset();
  clientIpMock.mockReset();
  revalidatePathMock.mockReset();

  requireUserMock.mockResolvedValue({
    userId: 'user-1',
    workspaceId: 'ws-1',
    role: 'admin',
  });
  headersMock.mockResolvedValue(new Headers());
  clientIpMock.mockReturnValue('203.0.113.1');
  prismaTransaction.mockResolvedValue([]);
});

function buildForm(clientId: string | null): FormData {
  const fd = new FormData();
  if (clientId) fd.set('clientId', clientId);
  return fd;
}

describe('deleteClient', () => {
  it('rejects an invalid (non-UUID) clientId before touching the DB', async () => {
    const result = await deleteClient({ status: 'idle' }, buildForm('not-a-uuid'));
    expect(result).toEqual({ status: 'error', message: 'Identifiant client invalide.' });
    expect(clientFindFirst).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the client is missing or already deleted', async () => {
    clientFindFirst.mockResolvedValue(null);
    const result = await deleteClient({ status: 'idle' }, buildForm(VALID_UUID));
    expect(result).toEqual({ status: 'error', message: 'Client introuvable.' });
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  it('refuses deletion (PRD §10 #14) when active projects remain — singular', async () => {
    clientFindFirst.mockResolvedValue({ id: VALID_UUID, _count: { projects: 1 } });
    const result = await deleteClient({ status: 'idle' }, buildForm(VALID_UUID));
    expect(result).toEqual({
      status: 'error',
      message: 'Suppression impossible : 1 projet actif est encore attaché à ce client.',
    });
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  it('refuses deletion when active projects remain — plural', async () => {
    clientFindFirst.mockResolvedValue({ id: VALID_UUID, _count: { projects: 4 } });
    const result = await deleteClient({ status: 'idle' }, buildForm(VALID_UUID));
    expect(result).toEqual({
      status: 'error',
      message: 'Suppression impossible : 4 projets actifs sont encore attachés à ce client.',
    });
  });

  it('soft-deletes contacts + client, audits, then redirects to /clients', async () => {
    clientFindFirst.mockResolvedValue({ id: VALID_UUID, _count: { projects: 0 } });

    await expect(deleteClient({ status: 'idle' }, buildForm(VALID_UUID))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(prismaTransaction).toHaveBeenCalledOnce();
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_deleted',
        workspaceId: 'ws-1',
        actorId: 'user-1',
        subjectType: 'client',
        subjectId: VALID_UUID,
        ip: '203.0.113.1',
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/clients');
    expect(redirectMock).toHaveBeenCalledWith('/clients');
  });
});
