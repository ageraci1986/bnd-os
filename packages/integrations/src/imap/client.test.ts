import { describe, it, expect, vi } from 'vitest';
import { openImapSession, ImapConnectionError } from './client';

vi.mock('imapflow', () => {
  return {
    ImapFlow: class {
      connectCalled = 0;
      logoutCalled = 0;
      constructor(public readonly opts: unknown) {}
      async connect() {
        this.connectCalled++;
      }
      async logout() {
        this.logoutCalled++;
      }
    },
  };
});

describe('openImapSession', () => {
  it('constructs ImapFlow with mapped options and calls connect', async () => {
    const s = await openImapSession({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user@example.com',
      password: 'pw',
    });
    expect((s as unknown as { connectCalled: number }).connectCalled).toBe(1);
  });

  it('surfaces a typed error when connect throws', async () => {
    const { ImapFlow } = await import('imapflow');
    // any: overriding mocked class instance behavior for this test only
    (ImapFlow as unknown as { prototype: { connect: () => Promise<void> } }).prototype.connect =
      async () => {
        throw new Error('ECONNREFUSED');
      };
    await expect(
      openImapSession({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(ImapConnectionError);
  });
});
