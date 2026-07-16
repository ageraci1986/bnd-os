import { describe, it, expect, vi } from 'vitest';

async function runWithMock(err: Error) {
  vi.resetModules();
  vi.doMock('./client', () => ({
    SmtpConnectionError: class extends Error {},
    openSmtpTransport: async () => {
      throw err;
    },
  }));
  const mod = await import('./connection-test');
  return mod.testSmtpConnection({
    host: 'x',
    port: 587,
    secure: false,
    username: 'u',
    password: 'p',
  });
}

describe('testSmtpConnection error mapping', () => {
  it('AUTH on auth-related messages', async () => {
    const r = await runWithMock(new Error('535 5.7.8 Authentication credentials invalid'));
    expect(r).toEqual({ ok: false, code: 'AUTH', message: expect.any(String) });
  });
  it('TLS on TLS-related messages', async () => {
    const r = await runWithMock(new Error('SSL routines: wrong version number'));
    expect(r).toEqual({ ok: false, code: 'TLS', message: expect.any(String) });
  });
  it('HOST on ENOTFOUND / ECONNREFUSED', async () => {
    const r = await runWithMock(new Error('getaddrinfo ENOTFOUND smtp.nope'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOST');
  });
  it('TIMEOUT on timeout messages', async () => {
    const r = await runWithMock(new Error('Greeting never received'));
    expect(r.ok).toBe(false);
  });
  it('UNKNOWN when no pattern matches', async () => {
    const r = await runWithMock(new Error('weird oddity'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNKNOWN');
  });
});
