import { describe, it, expect, vi } from 'vitest';
import { testSmtpConnection } from './connection-test';

vi.mock('./client', () => ({
  SmtpConnectionError: class extends Error {},
  async openSmtpTransport(_: unknown) {
    return {
      async verify() {
        return true;
      },
      async close() {
        /* noop */
      },
    };
  },
}));

describe('testSmtpConnection', () => {
  it('returns ok when verify succeeds', async () => {
    const r = await testSmtpConnection({
      host: 'smtp.ex.com',
      port: 587,
      secure: false,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: true });
  });
});
