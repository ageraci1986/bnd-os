import { describe, it, expect } from 'vitest';
import { listInboxInitial, listInboxIncremental, UidValidityChangedError } from './messages';
import type { RawImapMessage } from './parse';

function makeFakeSession(opts: { uidValidity: number; messages: readonly RawImapMessage[] }) {
  return {
    async mailboxOpen(_: string) {
      return { uidValidity: BigInt(opts.uidValidity) };
    },
    async *fetch(_range: string, _opts: unknown, _more: unknown) {
      for (const m of opts.messages) {
        yield {
          uid: m.uid,
          envelope: m.envelope,
          flags: m.flags,
          internalDate: m.internalDate,
          bodyStructure: null,
          source: null,
        };
      }
    },
    async download(_uid: number, _selector: string) {
      return { content: Buffer.from('') };
    },
    async logout() {
      // noop: session lifecycle is owned by the caller, not exercised here
    },
  };
}

const oneMsg: RawImapMessage = {
  uid: 42,
  envelope: {
    date: new Date('2026-07-15T10:00:00Z'),
    subject: 'x',
    from: [{ address: 'a@ex.com' }],
    to: [],
    cc: [],
    inReplyTo: null,
    messageId: '<a@ex.com>',
  },
  flags: new Set(),
  bodyText: null,
  bodyHtml: null,
};

describe('listInboxInitial', () => {
  it('returns messages + uidValidity + max uid', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [oneMsg] });
    const r = await listInboxInitial({ session: s as never, sinceDays: 30, maxMessages: 200 });
    expect(r.messages).toHaveLength(1);
    expect(r.uidValidity).toBe(100n);
    expect(r.lastSeenUid).toBe(42n);
  });

  it('returns lastSeenUid = 0n when the mailbox is empty', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [] });
    const r = await listInboxInitial({ session: s as never, sinceDays: 30, maxMessages: 200 });
    expect(r.messages).toHaveLength(0);
    expect(r.lastSeenUid).toBe(0n);
  });
});

describe('listInboxIncremental', () => {
  it('throws UidValidityChangedError when server uidValidity differs', async () => {
    const s = makeFakeSession({ uidValidity: 999, messages: [oneMsg] });
    await expect(
      listInboxIncremental({ session: s as never, uidValidity: 100n, lastSeenUid: 40n }),
    ).rejects.toBeInstanceOf(UidValidityChangedError);
  });

  it('fetches only messages with UID greater than lastSeenUid', async () => {
    const s = makeFakeSession({ uidValidity: 100, messages: [oneMsg] });
    const r = await listInboxIncremental({
      session: s as never,
      uidValidity: 100n,
      lastSeenUid: 41n,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.lastSeenUid).toBe(42n);
  });
});
