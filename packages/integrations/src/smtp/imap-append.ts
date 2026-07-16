import type { ImapFlow } from 'imapflow';

/**
 * Preferred folder name order — `Sent Items` (Outlook / Exchange) wins over
 * `Sent` (Gmail / most IMAPs) wins over `Sent Mail` (older accounts) wins
 * over `INBOX.Sent*` (Cyrus / cPanel / Courier — INBOX-prefixed namespace).
 */
const CANDIDATES = ['Sent Items', 'Sent', 'Sent Mail', 'INBOX.Sent', 'INBOX.Sent Items'];

interface ImapMailboxLike {
  readonly path: string;
}

/**
 * Append the RFC 822 raw source to the mailbox's Sent folder, if one exists.
 * Best-effort: any failure (folder missing, quota, APPEND errored) is
 * swallowed so that a successful send is never rolled back by a Sent-folder
 * hiccup. Callers should mark the mail sent regardless of this return.
 */
export async function appendToSentFolder(session: ImapFlow, rawRfc822: Buffer): Promise<void> {
  try {
    const boxes = (await session.list()) as readonly ImapMailboxLike[];
    const paths = new Set(boxes.map((b) => b.path));
    for (const c of CANDIDATES) {
      if (paths.has(c)) {
        try {
          await session.append(c, rawRfc822, ['\\Seen']);
        } catch {
          /* swallow — best-effort */
        }
        return;
      }
    }
    /* No candidate matched — no-op */
  } catch {
    /* LIST failed — swallow, best-effort */
  }
}
