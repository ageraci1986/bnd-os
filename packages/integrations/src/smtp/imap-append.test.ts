import { describe, it, expect } from 'vitest';
import { appendToSentFolder } from './imap-append';

function makeFakeImap(opts: { folders: readonly string[]; appendThrows?: Error }) {
  const appended: { folder: string; source: Buffer; flags: readonly string[] }[] = [];
  return {
    appended,
    async list() {
      return opts.folders.map((path) => ({ path, name: path, delimiter: '/' }));
    },
    async append(folder: string, source: Buffer, flags: readonly string[]) {
      if (opts.appendThrows) throw opts.appendThrows;
      appended.push({ folder, source, flags });
      return { destination: folder, uid: 42, uidValidity: 100n };
    },
  };
}

describe('appendToSentFolder', () => {
  it('prefers "Sent Items" when both Sent and Sent Items exist', async () => {
    const s = makeFakeImap({ folders: ['INBOX', 'Sent', 'Sent Items', 'Trash'] });
    await appendToSentFolder(s as never, Buffer.from('raw'));
    expect(s.appended).toHaveLength(1);
    expect(s.appended[0]?.folder).toBe('Sent Items');
    expect(s.appended[0]?.flags).toEqual(['\\Seen']);
  });

  it('falls back to "Sent" when "Sent Items" is missing', async () => {
    const s = makeFakeImap({ folders: ['INBOX', 'Sent', 'Trash'] });
    await appendToSentFolder(s as never, Buffer.from('raw'));
    expect(s.appended[0]?.folder).toBe('Sent');
  });

  it('supports INBOX-prefixed Sent folders', async () => {
    const s = makeFakeImap({ folders: ['INBOX', 'INBOX.Sent', 'INBOX.Trash'] });
    await appendToSentFolder(s as never, Buffer.from('raw'));
    expect(s.appended[0]?.folder).toBe('INBOX.Sent');
  });

  it('is a no-op when no Sent-style folder exists', async () => {
    const s = makeFakeImap({ folders: ['INBOX', 'Weird'] });
    await appendToSentFolder(s as never, Buffer.from('raw'));
    expect(s.appended).toHaveLength(0);
  });

  it('swallows APPEND errors (best-effort semantics)', async () => {
    const s = makeFakeImap({ folders: ['Sent'], appendThrows: new Error('quota') });
    await expect(appendToSentFolder(s as never, Buffer.from('raw'))).resolves.toBeUndefined();
  });
});
