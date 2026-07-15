import { describe, it, expect, vi } from 'vitest';
import { testImapConnection } from './connection-test';

vi.mock('./client', () => ({
  ImapConnectionError: class extends Error {},
  async openImapSession(_: unknown) {
    return {
      async mailboxOpen(_folder: string) {
        return { uidValidity: 1n };
      },
      async logout() {
        // noop: session lifecycle is owned by the caller, not exercised here
      },
    };
  },
}));

describe('testImapConnection', () => {
  it('returns ok when list INBOX succeeds', async () => {
    const r = await testImapConnection({
      host: 'imap.ex',
      port: 993,
      secure: true,
      username: 'u',
      password: 'p',
    });
    expect(r).toEqual({ ok: true });
  });
});
