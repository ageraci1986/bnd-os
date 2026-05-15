import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  membershipFindUnique: vi.fn(),
  waDeleteMany: vi.fn(),
  waCreateMany: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    membership: { findUnique: mocks.membershipFindUnique },
    workspaceAccess: { deleteMany: mocks.waDeleteMany, createMany: mocks.waCreateMany },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        workspaceAccess: { deleteMany: mocks.waDeleteMany, createMany: mocks.waCreateMany },
      }),
  },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: mocks.assertCsrf }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { setUserScope } from './set-user-scope';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fd(overrides: Record<string, string | undefined>): FormData {
  const f = new FormData();
  f.set('membershipId', UUID);
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireAdmin.mockResolvedValue({
    userId: 'admin-1',
    workspaceId: 'ws-1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'admin@test',
  });
  mocks.membershipFindUnique.mockResolvedValue({
    workspaceId: 'ws-1',
    role: 'user',
    userId: 'other',
  });
});

describe('setUserScope', () => {
  it('replaces rows with a new set when given client + project UUIDs', async () => {
    const c = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const p = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: c, projectIds: p }));
    expect(res).toEqual({ status: 'success' });
    expect(mocks.waDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it('clearAll=1 wipes rows and inserts nothing', async () => {
    const res = await setUserScope({ status: 'idle' }, fd({ clearAll: '1' }));
    expect(res.status).toBe('success');
    expect(mocks.waDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.waCreateMany).not.toHaveBeenCalled();
  });

  it('refuses to scope an Admin membership', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'admin',
      userId: 'x',
    });
    const c = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: c }));
    expect(res).toEqual({ status: 'error', message: 'Un Admin ne peut pas être restreint.' });
  });

  it('refuses to touch a membership of a different workspace', async () => {
    mocks.membershipFindUnique.mockResolvedValueOnce({
      workspaceId: 'ws-other',
      role: 'user',
      userId: 'x',
    });
    const res = await setUserScope({ status: 'idle' }, fd({}));
    expect(res).toMatchObject({ status: 'error' });
  });

  it('drops malformed UUIDs in the CSV silently', async () => {
    const res = await setUserScope({ status: 'idle' }, fd({ clientIds: 'not-a-uuid,also-bad' }));
    expect(res.status).toBe('success');
    expect(mocks.waCreateMany).not.toHaveBeenCalled();
  });
});
