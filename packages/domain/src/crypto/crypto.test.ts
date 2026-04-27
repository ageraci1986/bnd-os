import { describe, expect, it } from 'vitest';
import {
  createInvitationToken,
  decodeAesKey,
  decryptString,
  encryptString,
  hmacSha256,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  validateInvitationTokenShape,
  verifyHmacSha256,
} from './index.js';

const TEST_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes
const TEST_KEY_B64_V2 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='; // 32 bytes of 0x01

describe('timingSafeEqual', () => {
  it('returns true on equal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false on different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
  it('returns false on differing same-length strings', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });
});

describe('decodeAesKey', () => {
  it('rejects key shorter than 32 bytes', () => {
    expect(() => decodeAesKey('AAAA', 1)).toThrow(/32 bytes/);
  });
  it('rejects non-positive version', () => {
    expect(() => decodeAesKey(TEST_KEY_B64, 0)).toThrow(/positive integer/);
  });
  it('returns 32-byte material with the requested version', () => {
    const k = decodeAesKey(TEST_KEY_B64, 1);
    expect(k.raw.byteLength).toBe(32);
    expect(k.version).toBe(1);
  });
});

describe('AES-256-GCM encrypt/decrypt round-trip', () => {
  it('round-trips a string', async () => {
    const key = decodeAesKey(TEST_KEY_B64, 1);
    const ciphertext = await encryptString('hello world', key);
    expect(ciphertext).toMatch(/^v1:/);
    const ring = new Map([[1, key]]);
    expect(await decryptString(ciphertext, ring)).toBe('hello world');
  });

  it('produces a different ciphertext each call (random IV)', async () => {
    const key = decodeAesKey(TEST_KEY_B64, 1);
    const a = await encryptString('same plaintext', key);
    const b = await encryptString('same plaintext', key);
    expect(a).not.toBe(b);
  });

  it('rejects unknown key version on decrypt', async () => {
    const key = decodeAesKey(TEST_KEY_B64, 7);
    const ciphertext = await encryptString('value', key);
    const ring = new Map([[1, decodeAesKey(TEST_KEY_B64, 1)]]);
    await expect(decryptString(ciphertext, ring)).rejects.toThrow(/version 7/);
  });

  it('rejects malformed ciphertext (no version prefix)', async () => {
    const key = decodeAesKey(TEST_KEY_B64, 1);
    const ring = new Map([[1, key]]);
    await expect(decryptString('not-a-cipher', ring)).rejects.toThrow(/version prefix/);
  });

  it('decrypts with key version routing (rotation scenario)', async () => {
    const v1 = decodeAesKey(TEST_KEY_B64, 1);
    const v2 = decodeAesKey(TEST_KEY_B64_V2, 2);
    const oldCipher = await encryptString('old payload', v1);
    const newCipher = await encryptString('new payload', v2);
    const ring = new Map([
      [1, v1],
      [2, v2],
    ]);
    expect(await decryptString(oldCipher, ring)).toBe('old payload');
    expect(await decryptString(newCipher, ring)).toBe('new payload');
  });

  it('fails GCM auth on tampered ciphertext', async () => {
    const key = decodeAesKey(TEST_KEY_B64, 1);
    const ring = new Map([[1, key]]);
    const ciphertext = await encryptString('top secret', key);
    // Flip one base64 char to corrupt the auth tag
    const bad = ciphertext.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    await expect(decryptString(bad, ring)).rejects.toThrow();
  });
});

describe('HMAC-SHA-256', () => {
  it('signs deterministically', async () => {
    const a = await hmacSha256('secret', 'message');
    const b = await hmacSha256('secret', 'message');
    expect(a).toBe(b);
  });
  it('verifies a matching signature', async () => {
    const sig = await hmacSha256('secret', 'message');
    expect(await verifyHmacSha256('secret', 'message', sig)).toBe(true);
  });
  it('rejects a forged signature', async () => {
    const sig = await hmacSha256('secret', 'message');
    expect(await verifyHmacSha256('secret', 'tampered', sig)).toBe(false);
  });
  it('rejects empty secret', async () => {
    await expect(hmacSha256('', 'msg')).rejects.toThrow(/empty/);
  });
});

describe('sha256Hex', () => {
  it('hashes "hello" to a known fixed value', async () => {
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('randomToken', () => {
  it('generates url-safe characters only', () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(t.length).toBeGreaterThan(40);
  });
  it('rejects sub-128-bit lengths', () => {
    expect(() => randomToken(8)).toThrow(/at least 16 bytes/);
  });
  it('produces unique tokens', () => {
    const set = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(set.size).toBe(50);
  });
});

describe('invitation tokens (CLAUDE.md §4.3)', () => {
  it('creates a clear+hash pair where hash = sha256(clear)', async () => {
    const { clear, hash } = await createInvitationToken('secret-x');
    expect(clear).toMatch(/^[A-Za-z0-9\-_]+\.[a-f0-9]{32}$/);
    expect(hash).toBe(await sha256Hex(clear));
  });

  it('validates a freshly-issued token', async () => {
    const { clear } = await createInvitationToken('secret-x');
    expect(await validateInvitationTokenShape(clear, 'secret-x')).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const { clear } = await createInvitationToken('secret-a');
    expect(await validateInvitationTokenShape(clear, 'secret-b')).toBe(false);
  });

  it('rejects a token whose random part has been tampered', async () => {
    const { clear } = await createInvitationToken('secret-x');
    const [random, sig] = clear.split('.');
    const tampered = `${random}xx.${sig}`;
    expect(await validateInvitationTokenShape(tampered, 'secret-x')).toBe(false);
  });

  it('rejects a malformed token (no dot)', async () => {
    expect(await validateInvitationTokenShape('no-dot-here', 'secret')).toBe(false);
  });
});
