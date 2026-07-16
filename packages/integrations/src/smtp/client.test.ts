import { describe, it, expect, vi } from 'vitest';
import { openSmtpTransport, SmtpConnectionError } from './client';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn((opts: unknown) => ({
      opts,
      async verify() {
        return true;
      },
      async close() {
        /* noop */
      },
    })),
  },
}));

describe('openSmtpTransport', () => {
  it('constructs a transport with mapped options', async () => {
    const t = await openSmtpTransport({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'u@example.com',
      password: 'pw',
    });
    const opts = (t as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u@example.com', pass: 'pw' },
    });
  });

  it('surfaces a typed error when verify fails', async () => {
    const nm = await import('nodemailer');
    // any: overriding mocked class instance behavior for this test only
    (
      nm.default.createTransport as unknown as {
        mockImplementationOnce: (fn: () => unknown) => void;
      }
    ).mockImplementationOnce(() => ({
      async verify() {
        throw new Error('ECONNREFUSED');
      },
      async close() {
        /* noop */
      },
    }));
    await expect(
      openSmtpTransport({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(SmtpConnectionError);
  });
});
