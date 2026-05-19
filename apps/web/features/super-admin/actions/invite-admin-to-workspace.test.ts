import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  workspaceFindUnique: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  issueInvitation: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    workspace: { findUnique: mocks.workspaceFindUnique },
  },
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

import { inviteAdminToWorkspace } from './invite-admin-to-workspace';

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
  mocks.workspaceFindUnique.mockResolvedValue({ id: WS_ID, name: 'Acme' });
  mocks.issueInvitation.mockResolvedValue({
    invitationId: 'inv-2',
    expiresAt: new Date(),
    sentToEmail: 'admin2@acme.io',
  });
});

describe('inviteAdminToWorkspace', () => {
  it('sends the invitation when the workspace exists', async () => {
    const result = await inviteAdminToWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, email: 'admin2@acme.io' }),
    );
    expect(result).toEqual({ status: 'success', workspaceId: WS_ID, email: 'admin2@acme.io' });
    expect(mocks.issueInvitation).toHaveBeenCalledOnce();
    const args = mocks.issueInvitation.mock.calls[0]![0];
    expect(args.workspaceId).toBe(WS_ID);
    expect(args.role).toBe('admin');
    expect(args.anonymousInviter).toBe(true);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invitation_created' }),
    );
  });

  it('refuses an unknown workspace id', async () => {
    mocks.workspaceFindUnique.mockResolvedValueOnce(null);
    const result = await inviteAdminToWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, email: 'admin2@acme.io' }),
    );
    expect(result).toEqual({ status: 'error', message: 'Workspace introuvable.' });
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('refuses bad email', async () => {
    const result = await inviteAdminToWorkspace(
      { status: 'idle' },
      fd({ workspaceId: WS_ID, email: 'nope' }),
    );
    expect(result.status).toBe('error');
    expect(mocks.workspaceFindUnique).not.toHaveBeenCalled();
  });
});
