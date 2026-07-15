import 'server-only';
import { prisma } from '@nexushub/db';
import { decryptSecret } from '@/lib/oauth/crypto';
import type { ImapCredentials } from '@nexushub/integrations/imap';

interface Args {
  readonly workspaceId: string;
  readonly userId: string;
  readonly integrationId: string;
}

/**
 * Load the encrypted IMAP credentials for an integration owned by (workspace, user),
 * decrypt them, and return the plain object. Ownership check is mandatory
 * (CLAUDE.md §4.4.2 — no multi-tenant leaks).
 * NEVER log the returned value — it contains the mailbox password.
 */
export async function getValidImapCredentials(args: Args): Promise<ImapCredentials> {
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
  return JSON.parse(plaintext) as ImapCredentials;
}
