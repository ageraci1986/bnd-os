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

describe('testSmtpConnection with wrapped errors (real client shape)', () => {
  class Wrapped extends Error {
    constructor(
      message: string,
      override readonly cause?: unknown,
    ) {
      super(message);
    }
  }
  it('HOST when the DNS error is only in the cause', async () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.nope'), { code: 'ENOTFOUND' });
    const r = await runWithMock(new Wrapped('SMTP connect failed', dns));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOST');
  });
  it('AUTH when nodemailer reports EAUTH in the cause', async () => {
    const auth = Object.assign(new Error('Invalid login: 535 5.7.8'), { code: 'EAUTH' });
    const r = await runWithMock(new Wrapped('SMTP connect failed', auth));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('AUTH');
  });
});
