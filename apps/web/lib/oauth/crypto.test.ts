import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  getServerEnv: () => ({
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 bytes of zeros, base64
    ENCRYPTION_KEY_VERSION: 1,
  }),
}));

import { encryptSecret, decryptSecret, EncryptedSecretError } from './crypto';

describe('crypto', () => {
  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ accessToken: 'abc', refreshToken: 'def' });
    const ciphertext = encryptSecret(payload);
    expect(ciphertext.startsWith('v1:1:')).toBe(true);
    expect(decryptSecret(ciphertext)).toBe(payload);
  });

  it('rejects tampered ciphertext', () => {
    const ciphertext = encryptSecret('hello');
    // Flip a byte in the ciphertext segment (last segment).
    const parts = ciphertext.split(':');
    const tampered = parts.slice(0, 4).concat(parts[4]!.replace(/^.{4}/, 'XXXX')).join(':');
    expect(() => decryptSecret(tampered)).toThrow(EncryptedSecretError);
  });

  it('rejects unknown format version', () => {
    expect(() => decryptSecret('v9:1:aa:bb:cc')).toThrow(EncryptedSecretError);
  });

  it('rejects malformed input', () => {
    expect(() => decryptSecret('not-a-ciphertext')).toThrow(EncryptedSecretError);
  });
});
