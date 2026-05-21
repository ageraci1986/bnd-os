// Note: `server-only` intentionally removed so this module can be imported
// from Next.js middleware (Edge Runtime). The module contains no secrets and
// performs only cryptographic verification — it is safe to call from the edge.
import {
  jwtVerify,
  createRemoteJWKSet,
  createLocalJWKSet,
  decodeProtectedHeader,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { getPublicEnv, getServerEnv } from '../env';

export interface VerifiedToken {
  readonly sub: string;
  readonly email: string | null;
}

// Asymmetric (ES256/RS256) key resolver, created lazily + cached.
//
// PERF: this Supabase project signs tokens with ES256, whose public keys
// live in the JWKS. Fetching the JWKS over the network on every verify
// (createRemoteJWKSet, uncached across dev hot-reloads + serverless cold
// starts) re-introduces the latency we set out to remove. So when the
// public JWKS is provided via `SUPABASE_JWKS` (it is NOT a secret — it's the
// verify-only public key set, published at the JWKS URL), we verify fully
// LOCALLY with zero network. Falls back to the remote (cached) set when the
// env is absent so verification still works out of the box.
let keySet: JWTVerifyGetKey | null = null;
function getAsymmetricKeySet(): JWTVerifyGetKey {
  if (keySet) return keySet;
  const localJwks = getServerEnv().SUPABASE_JWKS;
  if (localJwks) {
    try {
      keySet = createLocalJWKSet(JSON.parse(localJwks) as Parameters<typeof createLocalJWKSet>[0]);
      return keySet;
    } catch {
      // Malformed env → fall through to the remote set.
    }
  }
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  keySet = createRemoteJWKSet(new URL(`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return keySet;
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
      ({ payload } = await jwtVerify(token, getAsymmetricKeySet(), {
        algorithms: ['ES256', 'RS256'],
      }));
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}
