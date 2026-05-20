// Note: `server-only` intentionally removed so this module can be imported
// from Next.js middleware (Edge Runtime). The module contains no secrets and
// performs only cryptographic verification — it is safe to call from the edge.
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, type JWTPayload } from 'jose';
import { getPublicEnv, getServerEnv } from '../env';

export interface VerifiedToken {
  readonly sub: string;
  readonly email: string | null;
}

// JWKS set is created lazily and cached across calls (createRemoteJWKSet
// memoises the fetched keys internally, refetching only on key rotation).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
    jwks = createRemoteJWKSet(new URL(`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

/**
 * Verify a Supabase access token's signature LOCALLY (no network round-trip
 * for the common, non-expired case). Supports both signing schemes:
 *  - HS256 (legacy symmetric) → verified with SUPABASE_JWT_SECRET.
 *  - ES256/RS256 (asymmetric) → verified with the project's JWKS (cached).
 *
 * `jwtVerify` also enforces `exp`. Any failure (expired, tampered, wrong
 * key, malformed) resolves to `null`.
 *
 * SECURITY: this checks the cryptographic signature — it is NOT the same as
 * decoding the cookie. Conforms to CLAUDE.md §4.3.8.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!token) return null;
  try {
    const header = decodeProtectedHeader(token);
    let payload: JWTPayload;
    if (header.alg === 'HS256') {
      const secret = new TextEncoder().encode(getServerEnv().SUPABASE_JWT_SECRET);
      ({ payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] }));
    } else {
      ({ payload } = await jwtVerify(token, getJwks(), { algorithms: ['ES256', 'RS256'] }));
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}
