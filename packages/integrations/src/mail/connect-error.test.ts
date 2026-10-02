import { describe, it, expect } from 'vitest';
import { connectErrorSignals } from './connect-error';

class Wrapper extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

describe('connectErrorSignals', () => {
  it('reads the message of a plain error', () => {
    expect(connectErrorSignals(new Error('boom'))).toEqual({ text: 'boom', authFailed: false });
  });

  it('walks the cause chain (wrapped DNS failure)', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND http://ex3.mail.ovh.net/'), {
      code: 'ENOTFOUND',
    });
    const s = connectErrorSignals(new Wrapper('IMAP connect failed', dns));
    expect(s.text).toContain('ENOTFOUND');
    expect(s.authFailed).toBe(false);
  });

  it('flags imapflow authentication failures', () => {
    const auth = Object.assign(new Error('Command failed'), {
      authenticationFailed: true,
      responseText: 'AUTHENTICATE failed.',
    });
    const s = connectErrorSignals(new Wrapper('IMAP connect failed', auth));
    expect(s.authFailed).toBe(true);
    expect(s.text).toContain('AUTHENTICATE failed.');
  });

  it('includes nodemailer code + response', () => {
    const e = Object.assign(new Error('Invalid login'), {
      code: 'EAUTH',
      response: '535 5.7.8 Error',
    });
    const s = connectErrorSignals(new Wrapper('SMTP connect failed', e));
    expect(s.text).toContain('EAUTH');
    expect(s.text).toContain('535 5.7.8');
  });

  it('handles non-Error values and cyclic causes', () => {
    expect(connectErrorSignals('raw')).toEqual({ text: 'raw', authFailed: false });
    const a: { message: string; cause?: unknown } = { message: 'a' };
    a.cause = a;
    expect(connectErrorSignals(a).text).toBe('a');
  });
});
