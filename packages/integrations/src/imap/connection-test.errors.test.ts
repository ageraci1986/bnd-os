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
