import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  emailUpdate: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: { emailMessage: { update: mocks.emailUpdate } },
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
  it('flips isRead and returns ok:true', async () => {
    mocks.emailUpdate.mockResolvedValue({});
    const res = await markEmailRead({ emailId: '11111111-1111-1111-1111-111111111111' });
    expect(res).toEqual({ ok: true });
    expect(mocks.emailUpdate).toHaveBeenCalledWith({
      where: { id: '11111111-1111-1111-1111-111111111111', workspaceId: 'W1' },
      data: { isRead: true },
    });
  });

  it('rejects invalid id', async () => {
    const res = await markEmailRead({ emailId: 'not-a-uuid' });
    expect(res).toEqual({ ok: false, message: 'Identifiant invalide.' });
  });
});
