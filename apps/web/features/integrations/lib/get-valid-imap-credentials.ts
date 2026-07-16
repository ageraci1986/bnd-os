import 'server-only';
import { prisma } from '@nexushub/db';
import { decryptSecret } from '@/lib/oauth/crypto';
import type { ImapCredentials } from '@nexushub/integrations/imap';
import type { SmtpCredentials } from '@nexushub/integrations/smtp';

interface Args {
  readonly workspaceId: string;
  readonly userId: string;
  readonly integrationId: string;
}

export interface ImapMailboxCredentials {
  readonly imap: ImapCredentials;
  readonly smtp: SmtpCredentials | null;
}

/**
 * Load and decrypt the IMAP (+ optional SMTP) credentials for a mailbox
 * owned by (workspace, user). Ownership check mandatory (CLAUDE.md §4.4.2).
 *
 * Blob shape v1: `{ host, port, secure, username, password }` — old
 * imap-only rows (Communications iter 2).
 * Blob shape v2: `{ imap: { … }, smtp: { … } | undefined }` — this iter.
 *
 * We accept both shapes on read and treat the missing-smtp case as
 * "SMTP not configured yet" — send actions surface `SMTP_NOT_CONFIGURED`.
 * NEVER log the returned value — it contains the mailbox password(s).
 */
export async function getValidImapCredentials(args: Args): Promise<ImapMailboxCredentials> {
  const row = await prisma.integration.findFirst({
    where: {
      id: args.integrationId,
      workspaceId: args.workspaceId,
      ownerUserId: args.userId,
      kind: 'imap',
    },
    select: { id: true, encryptedTokens: true },
  });
  if (!row) {
    throw new Error('IMAP integration not found or not owned by the caller');
  }
  if (!row.encryptedTokens) {
    throw new Error('IMAP integration has no credentials on file');
  }
  const plaintext = decryptSecret(row.encryptedTokens);
  const parsed = JSON.parse(plaintext) as
    | ImapCredentials
    | { imap: ImapCredentials; smtp?: SmtpCredentials };
  if ('imap' in parsed) {
    return { imap: parsed.imap, smtp: parsed.smtp ?? null };
  }
  return { imap: parsed, smtp: null };
}
