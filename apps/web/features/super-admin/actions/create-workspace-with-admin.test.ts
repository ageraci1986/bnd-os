import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  workspaceCreate: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  issueInvitation: vi.fn(),
  // Mock Prisma error class so the action's catch branch can detect P2002.
  PrismaP2002: class extends Error {
    override readonly name = 'PrismaClientKnownRequestError';
    readonly code = 'P2002';
    constructor() {
      super('Unique constraint failed');
    }
  },
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    workspace: { create: mocks.workspaceCreate },
  },
  Prisma: { PrismaClientKnownRequestError: mocks.PrismaP2002 },
}));
vi.mock('@/lib/auth', () => ({ requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/features/invitations/lib/issue-invitation', () => ({
  issueInvitation: mocks.issueInvitation,
}));

import { createWorkspaceWithAdmin } from './create-workspace-with-admin';

const WS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fd(input: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireSuperAdmin.mockResolvedValue({
    userId: 'sa-1',
    workspaceId: 'ws-anywhere',
    role: 'admin',
    isSuperAdmin: true,
    email: 'sa@platform',
  });
  mocks.workspaceCreate.mockResolvedValue({ id: WS_ID });
  mocks.issueInvitation.mockResolvedValue({
    invitationId: 'inv-1',
    expiresAt: new Date(),
    sentToEmail: 'admin@new.io',
  });
});

describe('createWorkspaceWithAdmin', () => {
  it('creates the workspace, fires the invitation, and audits', async () => {
    const result = await createWorkspaceWithAdmin(
      { status: 'idle' },
      fd({ name: 'Acme Agency', slug: 'acme-agency', adminEmail: 'admin@acme.io' }),
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.workspaceId).toBe(WS_ID);
      expect(result.workspaceName).toBe('Acme Agency');
      expect(result.adminEmail).toBe('admin@acme.io');
    }
    expect(mocks.workspaceCreate).toHaveBeenCalledOnce();
    expect(mocks.issueInvitation).toHaveBeenCalledOnce();
    const inviteArgs = mocks.issueInvitation.mock.calls[0]![0];
    expect(inviteArgs.workspaceId).toBe(WS_ID);
    expect(inviteArgs.role).toBe('admin');
    expect(inviteArgs.anonymousInviter).toBe(true);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace_created', workspaceId: WS_ID }),
    );
  });

  it('rejects an invalid slug format', async () => {
    const result = await createWorkspaceWithAdmin(
      { status: 'idle' },
      fd({ name: 'Acme', slug: 'AC ME', adminEmail: 'a@a.io' }),
    );
    expect(result.status).toBe('error');
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('rejects a duplicate slug (P2002) with a friendly message', async () => {
    mocks.workspaceCreate.mockRejectedValueOnce(new mocks.PrismaP2002());
    const result = await createWorkspaceWithAdmin(
      { status: 'idle' },
      fd({ name: 'Acme', slug: 'acme', adminEmail: 'a@a.io' }),
    );
    expect(result).toEqual({
      status: 'error',
      message: 'Ce slug est déjà utilisé par un autre workspace.',
    });
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects malformed admin email', async () => {
    const result = await createWorkspaceWithAdmin(
      { status: 'idle' },
      fd({ name: 'Acme', slug: 'acme', adminEmail: 'not-an-email' }),
    );
    expect(result.status).toBe('error');
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
  });
});
