import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getServerEnv } from '../env';

/**
 * AES-256-GCM encryption for short secrets (OAuth refresh tokens etc.) stored
 * at rest in Postgres. The ciphertext format is self-describing so we can
 * rotate keys without re-encrypting everything at once:
 *
 *   v1:<keyVersion>:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * `keyVersion` is the value of `ENCRYPTION_KEY_VERSION` at encrypt time. Decryption
 * uses the same env var — a future rotation will accept multiple keys.
 *
 * SECURITY: never log the cleartext or the ciphertext. Plus rule: never call
 * from a 'use client' module (the `server-only` import enforces it).
 */
export class EncryptedSecretError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EncryptedSecretError';
  }
}

const FORMAT = 'v1' as const;
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = getServerEnv().ENCRYPTION_KEY;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new EncryptedSecretError('ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const version = getServerEnv().ENCRYPTION_KEY_VERSION;
  return [
    FORMAT,
    String(version),
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== FORMAT) {
    throw new EncryptedSecretError('Unknown ciphertext format');
  }
  const ivB64 = parts[2];
  const tagB64 = parts[3];
  const ctB64 = parts[4];
  let iv: Buffer;
  let tag: Buffer;
  let ct: Buffer;
  try {
    iv = Buffer.from(ivB64 ?? '', 'base64');
    tag = Buffer.from(tagB64 ?? '', 'base64');
    ct = Buffer.from(ctB64 ?? '', 'base64');
  } catch {
    throw new EncryptedSecretError('Malformed base64 in ciphertext');
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EncryptedSecretError('Wrong IV or tag length');
  }
  try {
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new EncryptedSecretError(
      `Decryption failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}
