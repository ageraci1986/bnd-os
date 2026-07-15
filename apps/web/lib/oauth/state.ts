import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '../env';

export class OAuthStateError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OAuthStateError';
  }
}

export interface OAuthStatePayload {
  readonly workspaceId: string;
  readonly userId: string;
  /** Hex-encoded random bytes (≥ 16 bytes recommended). */
  readonly nonce: string;
  readonly returnTo: string;
  /** UNIX seconds. */
  readonly exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

function sign(payload: string): string {
  const secret = Buffer.from(getServerEnv().OAUTH_STATE_SECRET, 'base64');
  if (secret.length !== 32) {
    throw new OAuthStateError('OAUTH_STATE_SECRET must decode to 32 bytes');
  }
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

/** Returns `<payload_b64url>.<hmac_b64url>` — pass to Microsoft as `state`. */
export function signOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const p = b64url(Buffer.from(json, 'utf8'));
  return `${p}.${sign(p)}`;
}

/** Throws OAuthStateError if signature mismatch, malformed, or expired. */
export function verifyOAuthState(state: string): OAuthStatePayload {
  const dot = state.indexOf('.');
  if (dot < 1 || dot === state.length - 1) {
    throw new OAuthStateError('Malformed state');
  }
  const p = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(p);
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = b64urlDecode(sig);
    expBuf = b64urlDecode(expected);
  } catch {
    throw new OAuthStateError('Malformed signature');
  }
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new OAuthStateError('Signature mismatch');
  }
  let parsed: OAuthStatePayload;
  try {
    parsed = JSON.parse(b64urlDecode(p).toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError('Malformed payload');
  }
  if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) {
    throw new OAuthStateError('State expired');
  }
  return parsed;
}
