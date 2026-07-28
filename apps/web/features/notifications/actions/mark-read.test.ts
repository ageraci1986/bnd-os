import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  notificationUpdateMany: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: { notification: { updateMany: mocks.notificationUpdateMany } },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { markNotificationRead } from './mark-read';

const NOTIFICATION_ID = '11111111-1111-1111-1111-111111111111';

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

describe('markNotificationRead', () => {
  it('scopes the update to id + workspaceId + userId and stamps readAt', async () => {
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    const result = await markNotificationRead({ notificationId: NOTIFICATION_ID });
    expect(result).toEqual({ ok: true, affected: 1 });
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, workspaceId: 'W1', userId: 'U1' },
      data: { readAt: expect.any(Date) },
    });
  });

  it('returns affected:0 when the notification does not belong to the caller (scoping)', async () => {
    mocks.notificationUpdateMany.mockResolvedValue({ count: 0 });
    const result = await markNotificationRead({ notificationId: NOTIFICATION_ID });
    expect(result).toEqual({ ok: true, affected: 0 });
  });

  it('is idempotent — calling twice on an already-read notification still succeeds', async () => {
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    const first = await markNotificationRead({ notificationId: NOTIFICATION_ID });
    const second = await markNotificationRead({ notificationId: NOTIFICATION_ID });
    expect(first).toEqual({ ok: true, affected: 1 });
    expect(second).toEqual({ ok: true, affected: 1 });
    expect(mocks.notificationUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid id without calling prisma or requireUser', async () => {
    const result = await markNotificationRead({ notificationId: 'not-a-uuid' });
    expect(result).toEqual({ ok: false, message: 'Identifiant invalide.' });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.notificationUpdateMany).not.toHaveBeenCalled();
  });
});
