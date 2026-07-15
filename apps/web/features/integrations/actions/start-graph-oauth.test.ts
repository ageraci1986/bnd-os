import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  signOAuthState: vi.fn(),
  oauthStateCreate: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/oauth/state', () => ({ signOAuthState: mocks.signOAuthState }));
vi.mock('@nexushub/db', () => ({
  prisma: { oAuthState: { create: mocks.oauthStateCreate } },
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    GRAPH_CLIENT_ID: 'CID',
    APP_URL: 'http://localhost:3002',
  }),
}));

import { startGraphOAuth } from './start-graph-oauth';

beforeEach(() => {
  for (const m of Object.values(mocks)) (m as { mockReset?: () => void }).mockReset?.();
  mocks.requireUser.mockResolvedValue({
    userId: 'U1',
    workspaceId: 'W1',
    role: 'admin',
    isSuperAdmin: false,
    email: 'a@b.c',
  });
  mocks.signOAuthState.mockReturnValue('SIGNED.STATE');
  mocks.oauthStateCreate.mockResolvedValue({});
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe('startGraphOAuth', () => {
  it('persists OAuthState and redirects to MS authorize with correct params', async () => {
    await expect(startGraphOAuth()).rejects.toThrow(
      /REDIRECT:https:\/\/login\.microsoftonline\.com/,
    );
    expect(mocks.oauthStateCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        state: 'SIGNED.STATE',
        workspaceId: 'W1',
        userId: 'U1',
        kind: 'graph',
      }),
    });
    const url = mocks.redirect.mock.calls[0]![0] as string;
    expect(url).toContain('client_id=CID');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=offline_access+User.Read+Mail.Read');
    expect(url).toContain('state=SIGNED.STATE');
  });
});
