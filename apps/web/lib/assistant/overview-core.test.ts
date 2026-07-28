import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — repo convention (see
// lib/assistant/tools/read-tools.test.ts).
const prismaMock = vi.hoisted(() => ({
  card: { count: vi.fn() },
  emailMessage: { count: vi.fn() },
  notification: { count: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn(async () => ({ kind: 'workspace' as const })),
  scopedCardWhere: vi.fn(() => ({})),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

import { loadTodayOverview } from './overview-core';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadTodayOverview', () => {
  it('agrège cartes bloquées, dues, mails et notifications', async () => {
    prismaMock.card.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    prismaMock.emailMessage.count.mockResolvedValue(5);
    prismaMock.notification.count.mockResolvedValue(1);
    const out = await loadTodayOverview(ctx);
    expect(out).toEqual({
      blockedCards: 2,
      dueTodayCards: 3,
      unreadMails: 5,
      unreadNotifications: 1,
    });
    expect(prismaMock.card.count.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    expect(prismaMock.emailMessage.count.mock.calls[0]?.[0]?.where?.workspaceId).toBe('w1');
    const notifWhere = prismaMock.notification.count.mock.calls[0]?.[0]?.where;
    expect(notifWhere?.workspaceId).toBe('w1');
    expect(notifWhere?.userId).toBe('u1');
    expect(scopeMocks.loadUserScope).toHaveBeenCalledWith(ctx);
    expect(scopeMocks.scopedCardWhere).toHaveBeenCalled();
  });

  it("borne « dû aujourd'hui » sur minuit UTC (convention card-filter)", async () => {
    prismaMock.card.count.mockResolvedValue(0);
    prismaMock.emailMessage.count.mockResolvedValue(0);
    prismaMock.notification.count.mockResolvedValue(0);
    await loadTodayOverview(ctx);
    const dueWhere = prismaMock.card.count.mock.calls[1]?.[0]?.where?.dueDate;
    const start: Date = dueWhere.gte;
    const end: Date = dueWhere.lt;
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
