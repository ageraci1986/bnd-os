import { describe, it, expect, vi } from 'vitest';

async function runWithMock(err: Error) {
  vi.resetModules();
  vi.doMock('./client', () => ({
    ImapConnectionError: class extends Error {},
    openImapSession: async () => {
      throw err;
    },
  }));
  const mod = await import('./connection-test');
  return mod.testImapConnection({
    host: 'x',
    port: 993,
    secure: true,
    username: 'u',
    password: 'p',
  });
}

describe('testImapConnection error mapping', () => {
  it('AUTH on auth-related messages', async () => {
    const r = await runWithMock(new Error('Invalid credentials'));
    expect(r).toEqual({ ok: false, code: 'AUTH', message: expect.any(String) });
  });
  it('TLS on TLS-related messages', async () => {
    const r = await runWithMock(new Error('SSL routines: wrong version number'));
    expect(r).toEqual({ ok: false, code: 'TLS', message: expect.any(String) });
  });
  it('HOST on ENOTFOUND / ECONNREFUSED', async () => {
    const r = await runWithMock(new Error('getaddrinfo ENOTFOUND imap.nope'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOST');
  });
  it('TIMEOUT on timeout messages', async () => {
    const r = await runWithMock(new Error('Connection timeout'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TIMEOUT');
  });
  it('UNKNOWN when no pattern matches', async () => {
    const r = await runWithMock(new Error('weird oddity'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNKNOWN');
  });
});

describe('testImapConnection with wrapped errors (real client shape)', () => {
  class Wrapped extends Error {
    constructor(
      message: string,
      override readonly cause?: unknown,
    ) {
      super(message);
    }
  }
  it('HOST when the DNS error is only in the cause', async () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND http://x/'), { code: 'ENOTFOUND' });
    const r = await runWithMock(new Wrapped('IMAP connect failed', dns));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOST');
  });
  it('AUTH when imapflow flags authenticationFailed in the cause', async () => {
    const auth = Object.assign(new Error('Command failed'), {
      authenticationFailed: true,
      responseText: 'AUTHENTICATE failed.',
    });
    const r = await runWithMock(new Wrapped('IMAP connect failed', auth));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('AUTH');
  });
});

describe('testImapConnection — host names that look like other categories', () => {
  it.each(['ssl0.ovh.net', 'login.example.com', 'auth.example.com'])(
    'HOST (not TLS/AUTH) on ENOTFOUND %s',
    async (host) => {
      const r = await runWithMock(new Error(`getaddrinfo ENOTFOUND ${host}`));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('HOST');
    },
  );
});
