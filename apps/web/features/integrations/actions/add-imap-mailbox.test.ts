import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  encrypt: vi.fn((s: string) => `v1:1:iv:tag:${Buffer.from(s).toString('base64')}`),
  integrationCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  testImapConnection: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/oauth/crypto', () => ({ encryptSecret: mocks.encrypt }));
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { create: mocks.integrationCreate },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@nexushub/integrations/imap', () => ({
  testImapConnection: (...args: unknown[]) => mocks.testImapConnection(...args),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { addImapMailbox } from './add-imap-mailbox';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockClear?: () => void }).mockClear?.();
  mocks.requireUser.mockResolvedValue({ userId: 'u', workspaceId: 'w' });
});

describe('addImapMailbox', () => {
  it('rejects when the pre-save test connection fails', async () => {
    mocks.testImapConnection.mockResolvedValueOnce({ ok: false, code: 'AUTH', message: 'nope' });
    const r = await addImapMailbox({
      email: 'me@ex.com',
      host: 'h',
      port: 993,
      secure: true,
      password: 'p',
    });
    expect(r.ok).toBe(false);
    expect(mocks.integrationCreate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate mailbox without leaking the DB error', async () => {
    mocks.testImapConnection.mockResolvedValueOnce({ ok: true });
    mocks.integrationCreate.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const r = await addImapMailbox({
      email: 'me@ex.com',
      host: 'h',
      port: 993,
      secure: true,
      password: 'p',
    });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('encrypts credentials + creates the row + writes a PII-safe audit event + redirects', async () => {
    mocks.testImapConnection.mockResolvedValueOnce({ ok: true });
    mocks.integrationCreate.mockResolvedValueOnce({ id: 'int_1' });
    mocks.auditLogCreate.mockResolvedValueOnce({});

    await addImapMailbox({
      email: 'me@ex.com',
      host: 'h',
      port: 993,
      secure: true,
      password: 'p',
    }).catch((e: Error) => {
      expect(e.message).toContain('NEXT_REDIRECT');
      expect(e.message).toContain('/integrations?connected=imap');
    });

    expect(mocks.encrypt).toHaveBeenCalledOnce();
    const plaintextArg = mocks.encrypt.mock.calls[0]?.[0] as string;
    // The plaintext handed to encryptSecret must carry all credential parts.
    expect(plaintextArg).toContain('"password":"p"');
    expect(plaintextArg).toContain('"host":"h"');

    expect(mocks.integrationCreate).toHaveBeenCalledOnce();
    const createArg = mocks.integrationCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      workspaceId: 'w',
      ownerUserId: 'u',
      kind: 'imap',
      scope: 'user',
      status: 'active',
      externalAccountId: 'me@ex.com',
    });

    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    const auditPayload = (mocks.auditLogCreate.mock.calls[0]?.[0] as { data: { data: unknown } })
      .data.data;
    const auditStr = JSON.stringify(auditPayload);
    // Audit payload MUST NOT contain the raw password or the encrypted blob.
    expect(auditStr).not.toContain('"password"');
    expect(auditStr).not.toContain('"p"');
    expect(auditStr).not.toContain(plaintextArg);
  });
});
