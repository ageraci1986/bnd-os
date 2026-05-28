import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  getServerEnv: () => ({
    OAUTH_STATE_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 bytes
  }),
}));

import { signOAuthState, verifyOAuthState, OAuthStateError } from './state';

describe('oauth state', () => {
  const payload = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    nonce: 'cafebabecafebabecafebabecafebabe',
    returnTo: '/integrations',
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  it('round-trips a payload', () => {
    const state = signOAuthState(payload);
    const verified = verifyOAuthState(state);
    expect(verified).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const state = signOAuthState(payload);
    // Flip a character in the payload portion (before the dot).
    const [p, sig] = state.split('.');
    const flipped = (p![0] === 'A' ? 'B' : 'A') + p!.slice(1);
    expect(() => verifyOAuthState(`${flipped}.${sig}`)).toThrow(OAuthStateError);
  });

  it('rejects an expired payload', () => {
    const expired = { ...payload, exp: Math.floor(Date.now() / 1000) - 1 };
    const state = signOAuthState(expired);
    expect(() => verifyOAuthState(state)).toThrow(/expired/i);
  });

  it('rejects malformed input', () => {
    expect(() => verifyOAuthState('not-a-state')).toThrow(OAuthStateError);
  });
});
