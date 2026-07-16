import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  encrypt: vi.fn((s: string) => `v1:1:iv:tag:${Buffer.from(s).toString('base64')}`),
  decrypt: vi.fn((s: string) => Buffer.from(s.split(':')[4] ?? '', 'base64').toString('utf8')),
  integrationFindFirst: vi.fn(),
  integrationUpdate: vi.fn(),
  testSmtpConnection: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/oauth/crypto', () => ({
  encryptSecret: mocks.encrypt,
  decryptSecret: mocks.decrypt,
}));
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: mocks.integrationFindFirst, update: mocks.integrationUpdate },
  },
}));
vi.mock('@nexushub/integrations/smtp', () => ({
  testSmtpConnection: (...args: unknown[]) => mocks.testSmtpConnection(...args),
}));

import { updateSmtpConfig } from './update-smtp-config';

const INPUT = {
  integrationId: '11111111-1111-1111-1111-111111111111',
  smtp: { host: 's.example.com', port: 587, secure: false, requireTls: true },
  password: 'smtp-pass',
};

function encryptedBlobFor(plain: unknown): string {
  return `v1:1:iv:tag:${Buffer.from(JSON.stringify(plain)).toString('base64')}`;
}

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockClear?: () => void }).mockClear?.();
  mocks.requireUser.mockResolvedValue({ userId: 'u', workspaceId: 'w' });
  mocks.decrypt.mockImplementation((s: string) =>
    Buffer.from(s.split(':')[4] ?? '', 'base64').toString('utf8'),
  );
});

describe('updateSmtpConfig', () => {
  it('rejects when the integration is not owned by this user/workspace (ownership check)', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce(null);
    const r = await updateSmtpConfig(INPUT);
    expect(r).toEqual({ ok: false, message: expect.any(String) });
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
    expect(mocks.testSmtpConnection).not.toHaveBeenCalled();
    expect(mocks.integrationUpdate).not.toHaveBeenCalled();
  });

  it('rejects when the row has no credentials on file', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedTokens: null,
      externalAccountId: 'me@ex.com',
    });
    const r = await updateSmtpConfig(INPUT);
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    expect(mocks.testSmtpConnection).not.toHaveBeenCalled();
  });

  it('rejects and does NOT persist when the pre-save SMTP test fails', async () => {
    const existingBlob = encryptedBlobFor({
      host: 'i.h',
      port: 993,
      secure: true,
      username: 'me@ex.com',
      password: 'imap-pass',
    });
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedTokens: existingBlob,
      externalAccountId: 'me@ex.com',
    });
    mocks.testSmtpConnection.mockResolvedValueOnce({ ok: false, code: 'AUTH', message: 'nope' });

    const r = await updateSmtpConfig(INPUT);
    expect(r.ok).toBe(false);
    expect(mocks.integrationUpdate).not.toHaveBeenCalled();
  });

  it('preserves legacy flat IMAP creds, tests, re-encrypts as {imap,smtp}, and persists', async () => {
    const existingBlob = encryptedBlobFor({
      host: 'i.h',
      port: 993,
      secure: true,
      username: 'me@ex.com',
      password: 'imap-pass',
    });
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedTokens: existingBlob,
      externalAccountId: 'me@ex.com',
    });
    mocks.testSmtpConnection.mockResolvedValueOnce({ ok: true });
    mocks.integrationUpdate.mockResolvedValueOnce({});

    const r = await updateSmtpConfig(INPUT);
    expect(r).toEqual({ ok: true });

    // The SMTP test must run against the fully-assembled creds (server-side
    // username, never trusting a client-supplied one).
    expect(mocks.testSmtpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 's.example.com',
        port: 587,
        secure: false,
        requireTls: true,
        username: 'me@ex.com',
        password: 'smtp-pass',
      }),
    );

    expect(mocks.encrypt).toHaveBeenCalledOnce();
    const plaintextArg = mocks.encrypt.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(plaintextArg) as { imap: unknown; smtp: unknown };
    expect(parsed.imap).toEqual({
      host: 'i.h',
      port: 993,
      secure: true,
      username: 'me@ex.com',
      password: 'imap-pass',
    });
    expect(parsed.smtp).toMatchObject({ host: 's.example.com', password: 'smtp-pass' });

    expect(mocks.integrationUpdate).toHaveBeenCalledOnce();
    const updateArg = mocks.integrationUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ id: 'int_1' });
    expect(updateArg.data).toMatchObject({ status: 'active', lastError: null });
    expect(typeof updateArg.data['encryptedTokens']).toBe('string');
  });

  it('preserves the imap half of an already-{imap,smtp}-shaped blob', async () => {
    const existingBlob = encryptedBlobFor({
      imap: { host: 'i.h', port: 993, secure: true, username: 'me@ex.com', password: 'imap-pass' },
      smtp: {
        host: 'old.smtp.com',
        port: 465,
        secure: true,
        username: 'me@ex.com',
        password: 'old-pass',
      },
    });
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: 'int_1',
      encryptedTokens: existingBlob,
      externalAccountId: 'me@ex.com',
    });
    mocks.testSmtpConnection.mockResolvedValueOnce({ ok: true });
    mocks.integrationUpdate.mockResolvedValueOnce({});

    await updateSmtpConfig(INPUT);

    const plaintextArg = mocks.encrypt.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(plaintextArg) as { imap: unknown; smtp: unknown };
    expect(parsed.imap).toEqual({
      host: 'i.h',
      port: 993,
      secure: true,
      username: 'me@ex.com',
      password: 'imap-pass',
    });
    // New smtp config replaces the old one entirely.
    expect(parsed.smtp).toMatchObject({ host: 's.example.com', port: 587 });
  });
});
