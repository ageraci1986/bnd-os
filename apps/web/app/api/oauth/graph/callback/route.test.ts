import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  oauthStateFindUnique: vi.fn(),
  oauthStateUpdate: vi.fn(),
  integrationUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
  verifyOAuthState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  encryptSecret: vi.fn(),
  graphFetch: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    oAuthState: { findUnique: mocks.oauthStateFindUnique, update: mocks.oauthStateUpdate },
    integration: { upsert: mocks.integrationUpsert },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock('@/lib/oauth/state', () => ({
  verifyOAuthState: mocks.verifyOAuthState,
  OAuthStateError: class OAuthStateError extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'OAuthStateError';
    }
  },
}));
vi.mock('@/lib/oauth/crypto', () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock('@nexushub/integrations/graph', () => ({
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  graphFetch: mocks.graphFetch,
}));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    GRAPH_CLIENT_SECRET: 'CSEC',
    APP_URL: 'http://localhost:3002',
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { GET } from './route';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
});

function makeReq(url: string): Request {
  return new Request(url);
}

describe('GET /api/oauth/graph/callback', () => {
  it('exchanges code, encrypts tokens, upserts Integration, marks state consumed, redirects', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    mocks.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ['Mail.Read'],
    });
    mocks.graphFetch.mockResolvedValue({
      mail: 'angelo@brandnewday.agency',
      userPrincipalName: 'u',
    });
    mocks.encryptSecret.mockReturnValue('CT');
    mocks.integrationUpsert.mockResolvedValue({ id: 'I1' });
    mocks.oauthStateUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});

    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3002/integrations?connected=graph');
    expect(mocks.integrationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ encryptedTokens: 'CT', kind: 'graph', scope: 'user' }),
      }),
    );
    expect(mocks.oauthStateUpdate).toHaveBeenCalledWith({
      where: { state: 'S' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });

  it('rejects an already-consumed state with 400', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid HMAC with 400', async () => {
    mocks.verifyOAuthState.mockImplementation(() => {
      const E = class extends Error {
        constructor(m: string) {
          super(m);
          this.name = 'OAuthStateError';
        }
      };
      throw new E('Signature mismatch');
    });
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=BAD'));
    expect(res.status).toBe(400);
  });

  it('redirects to error page on token exchange failure', async () => {
    mocks.verifyOAuthState.mockReturnValue({
      workspaceId: 'W1',
      userId: 'U1',
      nonce: 'n',
      returnTo: '/integrations',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.oauthStateFindUnique.mockResolvedValue({
      state: 'S',
      workspaceId: 'W1',
      userId: 'U1',
      kind: 'graph',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    mocks.exchangeCodeForTokens.mockRejectedValue(new Error('invalid_grant'));
    mocks.oauthStateUpdate.mockResolvedValue({});
    const res = await GET(makeReq('http://localhost/api/oauth/graph/callback?code=C&state=S'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/integrations?error=');
  });
});
