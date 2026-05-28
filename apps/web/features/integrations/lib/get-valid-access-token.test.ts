import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  integrationFindUnique: vi.fn(),
  integrationUpdate: vi.fn(),
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  refreshTokens: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { findUnique: mocks.integrationFindUnique, update: mocks.integrationUpdate },
  },
}));
vi.mock('@/lib/oauth/crypto', () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret,
}));
vi.mock('@nexushub/integrations/graph', () => ({ refreshTokens: mocks.refreshTokens }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    GRAPH_CLIENT_SECRET: 'CSEC',
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { getValidAccessToken } from './get-valid-access-token';

const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
});

describe('getValidAccessToken', () => {
  it('returns the stored access token when not near expiry', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: future,
        grantedScopes: [],
      }),
    );
    const tok = await getValidAccessToken('I1');
    expect(tok).toBe('AT');
    expect(mocks.refreshTokens).not.toHaveBeenCalled();
  });

  it('refreshes when expired and persists the new ciphertext', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'OLD',
        refreshToken: 'RT',
        expiresAt: past,
        grantedScopes: [],
      }),
    );
    mocks.refreshTokens.mockResolvedValue({
      accessToken: 'NEW',
      refreshToken: 'RT2',
      expiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ['Mail.Read'],
    });
    mocks.encryptSecret.mockReturnValue('CT2');
    mocks.integrationUpdate.mockResolvedValue({});
    const tok = await getValidAccessToken('I1');
    expect(tok).toBe('NEW');
    expect(mocks.encryptSecret).toHaveBeenCalled();
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ encryptedTokens: 'CT2', status: 'active' }),
    });
  });

  it('marks status=error and rethrows when refresh fails', async () => {
    mocks.integrationFindUnique.mockResolvedValue({
      id: 'I1',
      encryptedTokens: 'CT',
      status: 'active',
    });
    mocks.decryptSecret.mockReturnValue(
      JSON.stringify({
        accessToken: 'OLD',
        refreshToken: 'RT',
        expiresAt: past,
        grantedScopes: [],
      }),
    );
    mocks.refreshTokens.mockRejectedValue(new Error('invalid_grant'));
    mocks.integrationUpdate.mockResolvedValue({});
    await expect(getValidAccessToken('I1')).rejects.toThrow(/invalid_grant/);
    expect(mocks.integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: expect.objectContaining({ status: 'error' }),
    });
  });
});
