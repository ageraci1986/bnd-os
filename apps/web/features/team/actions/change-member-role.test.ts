import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  membershipFindUnique: vi.fn(),
  membershipUpdate: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  PrismaP0001: class extends Error {
    override readonly name = 'PrismaClientKnownRequestError';
    constructor() {
      super('LAST_ADMIN_PROTECTED: cannot remove or downgrade the last admin');
    }
  },
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: { findUnique: mocks.membershipFindUnique, update: mocks.membershipUpdate },
  },
  Prisma: { PrismaClientKnownRequestError: mocks.PrismaP0001 },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { changeMemberRole } from './change-member-role';

function fd(membershipId: string, role: string): FormData {
  const f = new FormData();
  f.set('membershipId', membershipId);
  f.set('role', role);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireAdmin.mockResolvedValue({
    userId: 'admin-user',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@ws-1.test',
  });
  mocks.membershipFindUnique.mockResolvedValue({
    workspaceId: 'ws-1',
    role: 'user',
    userId: 'other-user',
  });
});

describe('changeMemberRole', () => {
  it('rejects role=viewer in Phase A', async () => {
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer'),
    );
    expect(res).toEqual({
      status: 'error',
      message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
    });
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
  });

  it('updates role=admin for a member in the same workspace', async () => {
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
    );
    expect(res.status).toBe('success');
    expect(mocks.membershipUpdate).toHaveBeenCalledOnce();
  });

  it('refuses to operate on a membership belonging to a different workspace', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-other',
      role: 'admin',
      userId: 'x',
    });
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
    );
    expect(res).toMatchObject({ status: 'error' });
    expect(mocks.membershipUpdate).not.toHaveBeenCalled();
  });

  it('surfaces LAST_ADMIN_PROTECTED as a friendly message', async () => {
    // Membership currently has role=admin; we try to downgrade to user.
    // That triggers the LAST_ADMIN_PROTECTED constraint in the DB.
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'admin',
      userId: 'other-user',
    });
    mocks.membershipUpdate.mockRejectedValueOnce(new mocks.PrismaP0001());
    const res = await changeMemberRole(
      { status: 'idle' },
      fd('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user'),
    );
    expect(res).toEqual({
      status: 'error',
      message: "Impossible : ce membre est le dernier Admin de l'espace.",
    });
  });
});
