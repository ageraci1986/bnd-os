import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  emailUpdateMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: { emailMessage: { updateMany: mocks.emailUpdateMany } },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { markEmailRead } from './mark-email-read';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'user',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('markEmailRead', () => {
  it('flips isRead on a mail of the caller own mailbox and returns ok:true', async () => {
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    const res = await markEmailRead({ emailId: '11111111-1111-1111-1111-111111111111' });
    expect(res).toEqual({ ok: true });
    expect(mocks.emailUpdateMany).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-1111-1111-111111111111',
        workspaceId: 'W1',
        integration: { workspaceId: 'W1', ownerUserId: 'U1' },
      },
      data: { isRead: true },
    });
  });

  it("refuses a mail from another member's mailbox (owner scope, 0 row updated)", async () => {
    mocks.emailUpdateMany.mockResolvedValue({ count: 0 });
    const res = await markEmailRead({ emailId: '11111111-1111-1111-1111-111111111111' });
    expect(res).toEqual({ ok: false, message: 'Mail introuvable.' });
  });

  it('rejects invalid id', async () => {
    const res = await markEmailRead({ emailId: 'not-a-uuid' });
    expect(res).toEqual({ ok: false, message: 'Identifiant invalide.' });
  });
});
