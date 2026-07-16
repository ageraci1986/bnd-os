import { describe, it, expect, vi } from 'vitest';

const decryptSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oauth/crypto', () => ({ decryptSecret: decryptSpy }));
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@nexushub/db';
import { getValidImapCredentials } from './get-valid-imap-credentials';

describe('getValidImapCredentials', () => {
  it('throws when integration is missing or not owned', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('decrypts and returns credentials for the matching row (v1 imap-only blob)', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: 'v1:1:iv:tag:ct',
    });
    decryptSpy.mockReturnValue(
      JSON.stringify({ host: 'h', port: 993, secure: true, username: 'u', password: 'p' }),
    );
    const r = await getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' });
    expect(r).toEqual({
      imap: { host: 'h', port: 993, secure: true, username: 'u', password: 'p' },
      smtp: null,
    });
  });

  it('decodes v2 blob shape with both imap and smtp', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: 'v1:1:iv:tag:ct',
    });
    decryptSpy.mockReturnValue(
      JSON.stringify({
        imap: { host: 'imap.h', port: 993, secure: true, username: 'u', password: 'p' },
        smtp: {
          host: 'smtp.h',
          port: 587,
          secure: false,
          requireTls: true,
          username: 'u',
          password: 'p',
        },
      }),
    );
    const r = await getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' });
    expect(r.imap.host).toBe('imap.h');
    expect(r.smtp?.host).toBe('smtp.h');
  });

  it('decodes v2 blob shape with imap only (smtp missing → null)', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: 'v1:1:iv:tag:ct',
    });
    decryptSpy.mockReturnValue(
      JSON.stringify({
        imap: { host: 'imap.h', port: 993, secure: true, username: 'u', password: 'p' },
      }),
    );
    const r = await getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' });
    expect(r.imap.host).toBe('imap.h');
    expect(r.smtp).toBeNull();
  });

  it('throws when encryptedTokens is null', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: null,
    });
    await expect(
      getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' }),
    ).rejects.toThrow(/no credentials/i);
  });
});
