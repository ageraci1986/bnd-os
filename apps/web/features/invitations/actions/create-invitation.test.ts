import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  workspaceFindUniqueOrThrow: vi.fn(),
  invitationUpdateMany: vi.fn(),
  invitationCreate: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  rateLimitCheck: vi.fn(),
  emailSend: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findUniqueOrThrow: mocks.userFindUnique },
    workspace: { findUniqueOrThrow: mocks.workspaceFindUniqueOrThrow },
    invitation: { updateMany: mocks.invitationUpdateMany, create: mocks.invitationCreate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: mocks.rateLimitCheck }),
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/email', () => ({ getEmail: () => ({ send: mocks.emailSend }) }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ INVITATION_SECRET: 'test-secret-must-be-long-enough-for-hmac' }),
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }),
}));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('../email/templates', () => ({
  renderInvitationEmail: () => ({ subject: 's', text: 't', htmlSanitized: '<p>h</p>' }),
}));

import { createInvitation } from './create-invitation';

function fd(role: string, email = 'new@example.com'): FormData {
  const f = new FormData();
  f.set('email', email);
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
  mocks.rateLimitCheck.mockResolvedValue({ success: true });
  mocks.userFindUnique.mockResolvedValue({
    memberships: [],
    firstName: 'A',
    lastName: 'D',
    email: 'admin@ws-1.test',
  });
  mocks.workspaceFindUniqueOrThrow.mockResolvedValue({ name: 'WS 1' });
  mocks.invitationCreate.mockResolvedValue({ id: 'inv-1' });
});

describe('createInvitation', () => {
  it('rejects role=viewer with no scope', async () => {
    const f = fd('viewer');
    const res = await createInvitation({ status: 'idle' }, f);
    expect(res).toEqual({
      status: 'error',
      message: 'Un Viewer doit avoir au moins un client ou un projet dans son scope.',
    });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('accepts role=viewer with at least one client in scope', async () => {
    const f = fd('viewer');
    f.set('scopeClientIds', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const res = await createInvitation({ status: 'idle' }, f);
    expect(res.status).toBe('success');
    const args = mocks.invitationCreate.mock.calls[0]![0];
    expect(args.data.role).toBe('viewer');
    expect(args.data.scopeClientIds).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
    expect(args.data.scopeProjectIds).toEqual([]);
  });

  it('drops malformed scope UUIDs from the CSV silently', async () => {
    const f = fd('viewer');
    f.set('scopeClientIds', 'not-a-uuid,also-bad');
    f.set('scopeProjectIds', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    const res = await createInvitation({ status: 'idle' }, f);
    expect(res.status).toBe('success');
    const args = mocks.invitationCreate.mock.calls[0]![0];
    expect(args.data.scopeClientIds).toEqual([]);
    expect(args.data.scopeProjectIds).toEqual(['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  });

  it('accepts role=user and writes the invitation', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('user'));
    expect(res.status).toBe('success');
    expect(mocks.invitationCreate).toHaveBeenCalledOnce();
    const args = mocks.invitationCreate.mock.calls[0]![0];
    expect(args.data.role).toBe('user');
    expect(args.data.workspaceId).toBe('ws-1');
  });

  it('accepts role=admin', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('admin'));
    expect(res.status).toBe('success');
    const args = mocks.invitationCreate.mock.calls[0]![0];
    expect(args.data.role).toBe('admin');
  });

  it('rejects unknown roles via Zod', async () => {
    const res = await createInvitation({ status: 'idle' }, fd('owner'));
    expect(res.status).toBe('error');
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('rejects duplicate workspace membership', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ memberships: [{ id: 'm-existing' }] });
    const res = await createInvitation({ status: 'idle' }, fd('user'));
    expect(res).toMatchObject({ status: 'error' });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });
});
