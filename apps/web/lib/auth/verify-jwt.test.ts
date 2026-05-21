// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

const TEST_SECRET = 'test-secret-at-least-32-bytes-long-xxxxx';

// Mutable holder so the ES256 test can inject a public JWKS into the mocked env.
const envHolder = vi.hoisted(() => ({ jwks: undefined as string | undefined }));

vi.mock('../env', () => ({
  getServerEnv: () => ({ SUPABASE_JWT_SECRET: TEST_SECRET, SUPABASE_JWKS: envHolder.jwks }),
  getPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }),
}));

import { verifyAccessToken } from './verify-jwt';

const key = new TextEncoder().encode(TEST_SECRET);

async function makeToken(opts: { sub?: string; email?: string; expSecondsFromNow?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: opts.email ?? 'u@test' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.sub ?? 'user-123')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyAccessToken', () => {
  it('accepts a valid HS256 token and returns sub + email', async () => {
    const token = await makeToken({ sub: 'abc', email: 'a@b.c' });
    const res = await verifyAccessToken(token);
    expect(res).toEqual({ sub: 'abc', email: 'a@b.c' });
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({ expSecondsFromNow: -10 });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const wrong = new TextEncoder().encode('another-secret-that-is-also-32-bytes-xx');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'x@y.z' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('abc')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(wrong);
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await makeToken({ sub: 'abc' });
    const tampered = `${token.slice(0, -3)}xyz`;
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });

  it('returns null email when the claim is absent', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('abc')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    expect(await verifyAccessToken(token)).toEqual({ sub: 'abc', email: null });
  });

  it('verifies an ES256 token LOCALLY via SUPABASE_JWKS (zero network)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const pubJwk = await exportJWK(publicKey);
    pubJwk.kid = 'test-kid';
    pubJwk.alg = 'ES256';
    pubJwk.use = 'sig';
    envHolder.jwks = JSON.stringify({ keys: [pubJwk] });

    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'es@test' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-kid' })
      .setSubject('es-user')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    expect(await verifyAccessToken(token)).toEqual({ sub: 'es-user', email: 'es@test' });
  });
});
