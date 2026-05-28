import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exchangeCodeForTokens, refreshTokens, GraphAuthError } from './auth';

describe('exchangeCodeForTokens', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns normalized tokens on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        scope: 'Mail.Read User.Read offline_access',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    const tokens = await exchangeCodeForTokens({
      code: 'CODE',
      redirectUri: 'http://x/callback',
      clientId: 'CID',
      clientSecret: 'CSEC',
    });
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.grantedScopes).toEqual(['Mail.Read', 'User.Read', 'offline_access']);
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3595_000);
    expect(tokens.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3601_000);
  });

  it('throws GraphAuthError on 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      }),
    );
    await expect(
      exchangeCodeForTokens({
        code: 'BAD',
        redirectUri: 'http://x/callback',
        clientId: 'CID',
        clientSecret: 'CSEC',
      }),
    ).rejects.toThrow(GraphAuthError);
  });
});

describe('refreshTokens', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns new tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'AT2',
          refresh_token: 'RT2',
          expires_in: 3600,
          scope: 'Mail.Read User.Read offline_access',
        }),
      }),
    );
    const tokens = await refreshTokens({
      refreshToken: 'OLD',
      clientId: 'CID',
      clientSecret: 'CSEC',
    });
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT2');
  });
});
