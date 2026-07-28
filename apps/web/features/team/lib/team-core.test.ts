import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@/lib/auth';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — repo convention, see
// `apps/web/features/clients/lib/client-core.test.ts`.
const prismaMock = vi.hoisted(() => ({
  membership: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  workspaceAccess: { count: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: prismaMock.membership,
    workspaceAccess: prismaMock.workspaceAccess,
    user: prismaMock.user,
  },
}));

const auditMocks = vi.hoisted(() => ({
  recordAudit: vi.fn(async (_entry: unknown) => undefined),
}));
vi.mock('@/lib/audit', () => auditMocks);

const rateLimitMocks = vi.hoisted(() => ({
  check: vi.fn(async () => ({ success: true, remaining: 19, reset: 0 })),
}));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: rateLimitMocks.check }),
}));

const TEST_TOKEN_CLEAR = 'this-token-must-never-leak-into-a-core-result';
const invitationMocks = vi.hoisted(() => ({
  issueInvitation: vi.fn(),
}));
vi.mock('@/features/invitations/lib/issue-invitation', () => invitationMocks);

import { changeMemberRoleCore, inviteMemberCore, removeMemberCore } from './team-core';

const WORKSPACE_ID = 'ws-1';
const ADMIN_USER_ID = 'admin-user';
const TARGET_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const adminCtx: AuthContext = {
  userId: ADMIN_USER_ID,
  email: 'admin@ws-1.test',
  workspaceId: WORKSPACE_ID,
  role: 'admin',
  isSuperAdmin: false,
};
const userCtx: AuthContext = { ...adminCtx, role: 'user' };
const viewerCtx: AuthContext = { ...adminCtx, role: 'viewer' };

class LastAdminProtectedError extends Error {
  constructor() {
    super('LAST_ADMIN_PROTECTED: cannot remove or downgrade the last admin');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMocks.check.mockResolvedValue({ success: true, remaining: 19, reset: 0 });
  prismaMock.membership.findUnique.mockResolvedValue({
    id: MEMBERSHIP_ID,
    role: 'user',
  });
  prismaMock.workspaceAccess.count.mockResolvedValue(0);
  prismaMock.user.findUnique.mockResolvedValue({ memberships: [] });
  invitationMocks.issueInvitation.mockResolvedValue({
    invitationId: 'inv-1',
    expiresAt: new Date('2026-08-01T00:00:00Z'),
    sentToEmail: 'new@example.com',
    // The real helper never returns the clear token — assert this core
    // never even looks for one on the result it receives.
  });
});

// =====================================================================
// changeMemberRoleCore
// =====================================================================

describe('changeMemberRoleCore', () => {
  it('updates the role, audits member_role_changed with {from,to}, returns the re-read role', async () => {
    prismaMock.membership.findUnique
      .mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'user' }) // lookup
      .mockResolvedValueOnce({ role: 'admin' }); // post-write re-read
    prismaMock.membership.update.mockResolvedValue({ id: MEMBERSHIP_ID });

    const result = await changeMemberRoleCore(adminCtx, {
      userId: TARGET_USER_ID,
      role: 'admin',
    });

    expect(result).toEqual({ ok: true, role: 'admin' });
    expect(prismaMock.membership.update).toHaveBeenCalledWith({
      where: { id: MEMBERSHIP_ID },
      data: { role: 'admin' },
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member_role_changed',
        workspaceId: WORKSPACE_ID,
        actorId: ADMIN_USER_ID,
        subjectType: 'membership',
        subjectId: MEMBERSHIP_ID,
        data: { from: 'user', to: 'admin' },
      }),
    );
  });

  it('refuses non-Admin callers (user role)', async () => {
    const result = await changeMemberRoleCore(userCtx, { userId: TARGET_USER_ID, role: 'admin' });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
  });

  it('refuses non-Admin callers (viewer role)', async () => {
    const result = await changeMemberRoleCore(viewerCtx, {
      userId: TARGET_USER_ID,
      role: 'admin',
    });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
  });

  it('refuses promotion to Viewer when the member has no scope rows', async () => {
    prismaMock.workspaceAccess.count.mockResolvedValueOnce(0);
    const result = await changeMemberRoleCore(adminCtx, {
      userId: TARGET_USER_ID,
      role: 'viewer',
    });
    expect(result).toEqual({
      ok: false,
      message: "Définis d'abord un scope pour ce membre avant de le passer en Viewer.",
    });
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
  });

  it('promotes to Viewer when scope rows already exist', async () => {
    prismaMock.workspaceAccess.count.mockResolvedValueOnce(2);
    prismaMock.membership.findUnique
      .mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'user' })
      .mockResolvedValueOnce({ role: 'viewer' });
    const result = await changeMemberRoleCore(adminCtx, {
      userId: TARGET_USER_ID,
      role: 'viewer',
    });
    expect(result).toEqual({ ok: true, role: 'viewer' });
  });

  it('surfaces LAST_ADMIN_PROTECTED as a friendly message', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'admin' });
    prismaMock.membership.update.mockRejectedValueOnce(new LastAdminProtectedError());
    const result = await changeMemberRoleCore(adminCtx, { userId: TARGET_USER_ID, role: 'user' });
    expect(result).toEqual({
      ok: false,
      message: "Impossible : ce membre est le dernier Admin de l'espace.",
    });
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('returns "Membre introuvable." when no membership matches in this workspace', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(null);
    const result = await changeMemberRoleCore(adminCtx, { userId: TARGET_USER_ID, role: 'admin' });
    expect(result).toEqual({ ok: false, message: 'Membre introuvable.' });
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
  });

  it('no-ops without a write or audit call when the role is unchanged', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'user' });
    const result = await changeMemberRoleCore(adminCtx, { userId: TARGET_USER_ID, role: 'user' });
    expect(result).toEqual({ ok: true, role: 'user' });
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });
});

// =====================================================================
// removeMemberCore
// =====================================================================

describe('removeMemberCore', () => {
  it('deletes the membership and audits member_removed with {removedRole}', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'user' });
    prismaMock.membership.delete.mockResolvedValue({ id: MEMBERSHIP_ID });

    const result = await removeMemberCore(adminCtx, { userId: TARGET_USER_ID });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.membership.delete).toHaveBeenCalledWith({ where: { id: MEMBERSHIP_ID } });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member_removed',
        workspaceId: WORKSPACE_ID,
        actorId: ADMIN_USER_ID,
        subjectType: 'membership',
        subjectId: MEMBERSHIP_ID,
        data: { removedRole: 'user' },
      }),
    );
  });

  it('refuses non-Admin callers (user role)', async () => {
    const result = await removeMemberCore(userCtx, { userId: TARGET_USER_ID });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
  });

  it('refuses non-Admin callers (viewer role)', async () => {
    const result = await removeMemberCore(viewerCtx, { userId: TARGET_USER_ID });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
  });

  it('refuses self-removal with the exact action message', async () => {
    const result = await removeMemberCore(adminCtx, { userId: ADMIN_USER_ID });
    expect(result).toEqual({
      ok: false,
      message: "Vous ne pouvez pas vous retirer vous-même. Promouvez d'abord un autre Admin.",
    });
    expect(prismaMock.membership.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.membership.delete).not.toHaveBeenCalled();
  });

  it('surfaces LAST_ADMIN_PROTECTED as a friendly message', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce({ id: MEMBERSHIP_ID, role: 'admin' });
    prismaMock.membership.delete.mockRejectedValueOnce(new LastAdminProtectedError());
    const result = await removeMemberCore(adminCtx, { userId: TARGET_USER_ID });
    expect(result).toEqual({
      ok: false,
      message: "Impossible : ce membre est le dernier Admin de l'espace.",
    });
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('returns "Membre introuvable." when no membership matches in this workspace', async () => {
    prismaMock.membership.findUnique.mockResolvedValueOnce(null);
    const result = await removeMemberCore(adminCtx, { userId: TARGET_USER_ID });
    expect(result).toEqual({ ok: false, message: 'Membre introuvable.' });
    expect(prismaMock.membership.delete).not.toHaveBeenCalled();
  });
});

// =====================================================================
// inviteMemberCore
// =====================================================================

describe('inviteMemberCore', () => {
  it('invites a User, audits invitation_created with {role} only, never returns a token', async () => {
    const result = await inviteMemberCore(adminCtx, { email: 'new@example.com', role: 'user' });

    expect(result).toEqual({ ok: true, email: 'new@example.com', role: 'user' });
    expect(invitationMocks.issueInvitation).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      email: 'new@example.com',
      role: 'user',
      scopeClientIds: [],
      scopeProjectIds: [],
      actorUserId: ADMIN_USER_ID,
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invitation_created',
        workspaceId: WORKSPACE_ID,
        actorId: ADMIN_USER_ID,
        subjectType: 'invitation',
        subjectId: 'inv-1',
        data: { role: 'user' },
      }),
    );
    // No PII (email) in audit data.
    const auditCall = auditMocks.recordAudit.mock.calls[0]![0] as { data?: unknown };
    expect(JSON.stringify(auditCall.data ?? {})).not.toContain('new@example.com');
    // The clear token must never leak into the core's return value.
    expect(JSON.stringify(result)).not.toContain(TEST_TOKEN_CLEAR);
  });

  it('invites an Admin', async () => {
    const result = await inviteMemberCore(adminCtx, { email: 'new@example.com', role: 'admin' });
    expect(result).toEqual({ ok: true, email: 'new@example.com', role: 'admin' });
    const args = invitationMocks.issueInvitation.mock.calls[0]![0] as { role: string };
    expect(args.role).toBe('admin');
  });

  it('refuses non-Admin callers (user role)', async () => {
    const result = await inviteMemberCore(userCtx, { email: 'new@example.com', role: 'user' });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(invitationMocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('refuses non-Admin callers (viewer role)', async () => {
    const result = await inviteMemberCore(viewerCtx, { email: 'new@example.com', role: 'user' });
    expect(result).toEqual({ ok: false, message: 'Action réservée aux administrateurs.' });
    expect(invitationMocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('refuses role=viewer: a tool cannot set a scope', async () => {
    const result = await inviteMemberCore(adminCtx, { email: 'new@example.com', role: 'viewer' });
    expect(result).toEqual({
      ok: false,
      message: "Utilise l'interface Équipe pour inviter un Viewer avec son scope.",
    });
    expect(invitationMocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('refuses when the daily rate limit is exceeded', async () => {
    rateLimitMocks.check.mockResolvedValueOnce({ success: false, remaining: 0, reset: 0 });
    const result = await inviteMemberCore(adminCtx, { email: 'new@example.com', role: 'user' });
    expect(result).toEqual({
      ok: false,
      message: 'Limite quotidienne atteinte. Réessayez demain.',
    });
    expect(invitationMocks.issueInvitation).not.toHaveBeenCalled();
  });

  it('refuses when the email already belongs to a member of the workspace', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ memberships: [{ id: 'm-existing' }] });
    const result = await inviteMemberCore(adminCtx, { email: 'new@example.com', role: 'user' });
    expect(result).toEqual({ ok: false, message: "Cette personne est déjà membre de l'espace." });
    expect(invitationMocks.issueInvitation).not.toHaveBeenCalled();
  });
});
