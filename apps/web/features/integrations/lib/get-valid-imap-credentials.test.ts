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

  it('decrypts and returns credentials for the matching row', async () => {
    (prisma.integration.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'x',
      encryptedTokens: 'v1:1:iv:tag:ct',
    });
    decryptSpy.mockReturnValue(
      JSON.stringify({ host: 'h', port: 993, secure: true, username: 'u', password: 'p' }),
    );
    const r = await getValidImapCredentials({ workspaceId: 'w', userId: 'u', integrationId: 'x' });
    expect(r).toEqual({ host: 'h', port: 993, secure: true, username: 'u', password: 'p' });
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
