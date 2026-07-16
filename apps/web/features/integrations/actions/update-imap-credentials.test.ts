import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  encrypt: vi.fn((s: string) => `v1:1:iv:tag:${Buffer.from(s).toString('base64')}`),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  testImapConnection: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/oauth/crypto', () => ({ encryptSecret: mocks.encrypt }));
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@nexushub/integrations/imap', () => ({
  testImapConnection: (...args: unknown[]) => mocks.testImapConnection(...args),
}));

import { updateImapCredentials } from './update-imap-credentials';

const INPUT = {
  integrationId: '11111111-1111-1111-1111-111111111111',
  host: 'h',
  port: 993,
  secure: true,
  password: 'p',
};

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockClear?: () => void }).mockClear?.();
  mocks.requireUser.mockResolvedValue({ userId: 'u', workspaceId: 'w' });
});

describe('updateImapCredentials', () => {
  it('rejects when the integration is not owned by this user/workspace (ownership check)', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce(null);
    const r = await updateImapCredentials(INPUT);
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    // The ownership check must be scoped by workspaceId + ownerUserId + kind.
    expect(mocks.integrationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INPUT.integrationId,
          workspaceId: 'w',
          ownerUserId: 'u',
          kind: 'imap',
        }),
      }),
    );
    expect(mocks.testImapConnection).not.toHaveBeenCalled();
    expect(mocks.integrationUpdate).not.toHaveBeenCalled();
  });

  it('rejects when the pre-save test connection fails', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      externalAccountId: 'me@ex.com',
    });
    mocks.testImapConnection.mockResolvedValueOnce({ ok: false, code: 'AUTH', message: 'nope' });
    const r = await updateImapCredentials(INPUT);
    expect(r.ok).toBe(false);
    expect(mocks.integrationUpdate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('encrypts credentials + updates the row + writes a PII-safe audit event', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      externalAccountId: 'me@ex.com',
    });
    mocks.testImapConnection.mockResolvedValueOnce({ ok: true });
    mocks.integrationUpdate.mockResolvedValueOnce({});
    mocks.auditLogCreate.mockResolvedValueOnce({});

    const r = await updateImapCredentials(INPUT);
    expect(r).toEqual({ ok: true });

    expect(mocks.encrypt).toHaveBeenCalledOnce();
    const plaintextArg = mocks.encrypt.mock.calls[0]?.[0] as string;
    expect(plaintextArg).toContain('"password":"p"');

    expect(mocks.integrationUpdate).toHaveBeenCalledOnce();
    const updateArg = mocks.integrationUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ id: 'int_1' });
    expect(updateArg.data).toMatchObject({ status: 'active', lastError: null });
    expect(typeof updateArg.data['encryptedTokens']).toBe('string');

    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    const auditPayload = (mocks.auditLogCreate.mock.calls[0]?.[0] as { data: { data: unknown } })
      .data.data;
    const auditStr = JSON.stringify(auditPayload);
    expect(auditStr).not.toContain('"password"');
    expect(auditStr).not.toContain('"p"');
    expect(auditStr).not.toContain(plaintextArg);
  });
});
