import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import { disconnectGraph } from './disconnect-graph';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
});

describe('disconnectGraph', () => {
  it('marks the integration revoked + audit logs', async () => {
    mocks.integrationFindFirst.mockResolvedValue({ id: 'I1' });
    mocks.integrationUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await disconnectGraph();
    expect(res).toEqual({ ok: true });
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ status: 'revoked', encryptedTokens: null }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });

  it('returns ok:false when no integration', async () => {
    mocks.integrationFindFirst.mockResolvedValue(null);
    const res = await disconnectGraph();
    expect(res).toEqual({ ok: false, message: 'Aucune intégration à déconnecter.' });
  });
});
