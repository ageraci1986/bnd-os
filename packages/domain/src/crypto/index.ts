/**
 * NexusHub crypto helpers (CLAUDE.md §4.2).
 *
 * Pure Node WebCrypto. No external runtime dependency.
 *
 * Provides:
 *  - AES-256-GCM encrypt/decrypt with key versioning (token storage)
 *  - HMAC-SHA-256 sign/verify (invitation tokens, OAuth state)
 *  - SHA-256 hex hashing (token-at-rest hashing for invitations)
 *  - Constant-time string compare
 *
 * SECURITY notes:
 *  - Never log ciphertext or plaintext. Helpers must remain side-effect free.
 *  - Argon2id password hashing is NOT here: Supabase Auth handles passwords.
 *    This module only handles app-level secrets and invitation tokens.
 *  - Keys are passed in by callers; the module knows nothing about env vars.
 */

import type { webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;
type KeyUsage = webcrypto.KeyUsage;

const SUBTLE = globalThis.crypto.subtle as webcrypto.SubtleCrypto;
const VERSION_PREFIX_REGEX = /^v(\d+):/;

/* =====================================================================
 * Helpers
 * =================================================================== */

/** Fixed-time string compare. Throws on length mismatch (= mismatch). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid Buffer to keep this Edge-runtime compatible.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

/* =====================================================================
 * AES-256-GCM
 * Format: `v{version}:{base64(iv | ciphertext | tag)}`
 * GCM ciphertext returned by WebCrypto already has the tag appended.
 * =================================================================== */

export interface AesKeyMaterial {
  /** Decoded 32-byte key material (raw). */
  readonly raw: Uint8Array;
  /** Version number (>= 1). Persisted alongside ciphertext for rotation. */
  readonly version: number;
}

/** Decode a base64 32-byte AES-256 key. Throws if length isn't 32 bytes. */
export function decodeAesKey(base64Key: string, version: number): AesKeyMaterial {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('AES key version must be a positive integer');
  }
  const raw = base64ToBytes(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error(`AES key must be 32 bytes (got ${raw.byteLength})`);
  }
  return { raw, version };
}

async function importAesKey(material: AesKeyMaterial): Promise<CryptoKey> {
  return SUBTLE.importKey('raw', material.raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Generate a random 96-bit IV (NIST recommendation for GCM). */
function randomIv(): Uint8Array {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  return iv;
}

export async function encryptString(plain: string, key: AesKeyMaterial): Promise<string> {
  const aesKey = await importAesKey(key);
  const iv = randomIv();
  const cipher = new Uint8Array(
    await SUBTLE.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(plain)),
  );
  const payload = concat(iv, cipher);
  return `v${key.version}:${bytesToBase64(payload)}`;
}

/**
 * Decrypt a value previously produced by `encryptString`.
 * Looks up the key from the provided keyring by version.
 * Throws on unknown version, malformed payload, or auth-tag failure.
 */
export async function decryptString(
  ciphertext: string,
  keyring: ReadonlyMap<number, AesKeyMaterial>,
): Promise<string> {
  const match = VERSION_PREFIX_REGEX.exec(ciphertext);
  if (!match) throw new Error('Malformed ciphertext: missing version prefix');
  const version = Number(match[1]);
  const key = keyring.get(version);
  if (!key) throw new Error(`No AES key registered for version ${version}`);
  const payload = base64ToBytes(ciphertext.slice(match[0].length));
  if (payload.byteLength <= 12) throw new Error('Malformed ciphertext: too short');
  const iv = payload.subarray(0, 12);
  const body = payload.subarray(12);
  const aesKey = await importAesKey(key);
  const plain = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, aesKey, body);
  return dec.decode(plain);
}

/* =====================================================================
 * HMAC-SHA-256
 * =================================================================== */

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return SUBTLE.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

/** Returns hex-encoded HMAC-SHA-256(message). */
export async function hmacSha256(secret: string, message: string): Promise<string> {
  if (!secret) throw new Error('HMAC secret must not be empty');
  const key = await importHmacKey(secret, ['sign']);
  const sig = new Uint8Array(await SUBTLE.sign('HMAC', key, enc.encode(message)));
  return bytesToHex(sig);
}

export async function verifyHmacSha256(
  secret: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const expected = await hmacSha256(secret, message);
  return timingSafeEqual(expected, signatureHex);
}

/* =====================================================================
 * SHA-256 hashing (invitation token at rest)
 * =================================================================== */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await SUBTLE.digest('SHA-256', enc.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/* =====================================================================
 * Random tokens
 * =================================================================== */

/** url-safe base64, no padding. 32 bytes ≈ 256-bit entropy. */
export function randomToken(byteLength = 32): string {
  if (byteLength < 16) {
    throw new Error('Token must be at least 16 bytes (128-bit entropy)');
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/* =====================================================================
 * Invitation tokens (CLAUDE.md §4.3)
 * Public token = `{random}.{hmac(random)}` — single-use.
 * Stored hash in DB = sha256(public token). Compared at acceptance.
 * =================================================================== */

export interface InvitationToken {
  /** The full token sent in the email link. Sensitive. */
  readonly clear: string;
  /** SHA-256 hex hash to persist alongside the invitation row. */
  readonly hash: string;
}

export async function createInvitationToken(secret: string): Promise<InvitationToken> {
  const random = randomToken(32);
  const sig = await hmacSha256(secret, random);
  // Truncate sig to 32 hex chars (128-bit) to keep token compact in URLs.
  const clear = `${random}.${sig.slice(0, 32)}`;
  const hash = await sha256Hex(clear);
  return { clear, hash };
}

export async function validateInvitationTokenShape(
  clear: string,
  secret: string,
): Promise<boolean> {
  const idx = clear.lastIndexOf('.');
  if (idx <= 0 || idx === clear.length - 1) return false;
  const random = clear.slice(0, idx);
  const sig = clear.slice(idx + 1);
  if (sig.length !== 32) return false;
  const expected = await hmacSha256(secret, random);
  return timingSafeEqual(expected.slice(0, 32), sig);
}
