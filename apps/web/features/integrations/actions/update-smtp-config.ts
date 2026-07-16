'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { decryptSecret, encryptSecret } from '@/lib/oauth/crypto';
import { testSmtpConnection } from '@nexushub/integrations/smtp';
import type { ImapCredentials } from '@nexushub/integrations/imap';
import type { SmtpCredentials } from '@nexushub/integrations/smtp';

const inputSchema = z.object({
  integrationId: z.string().uuid(),
  smtp: z.object({
    host: z.string().min(1).max(255),
    port: z.number().int().positive().max(65535),
    secure: z.boolean(),
    requireTls: z.boolean().optional(),
  }),
  password: z.string().min(1).max(1024),
});

export type UpdateSmtpConfigInput = z.infer<typeof inputSchema>;
export type UpdateSmtpConfigResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** See `add-imap-mailbox.ts` — keeps the DB column in sync with the ciphertext's own prefix. */
function keyVersionFromCiphertext(ciphertext: string): number {
  const version = Number(ciphertext.split(':')[1]);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

/**
 * Server Action: add/replace the SMTP half of an existing IMAP mailbox's
 * credentials blob (CLAUDE.md §4.2, §4.4). Triggered from the ComposePanel
 * "SMTP not configured" banner via `AddMailboxModal`'s `updateSmtpFor` mode.
 *
 * SECURITY:
 * - Ownership check (workspaceId + ownerUserId + kind='imap') via `findFirst`
 *   before anything else — a mismatched `integrationId` returns a generic
 *   "unknown mailbox" error instead of leaking existence across tenants.
 * - `testSmtpConnection` MUST succeed before the new blob is persisted —
 *   never save credentials we haven't verified.
 * - The existing IMAP credentials are preserved verbatim in the blob; only
 *   the `smtp` half is replaced. Accepts both the legacy flat blob shape
 *   (`{host,port,secure,username,password}`, treated as the IMAP creds) and
 *   the current `{imap, smtp}` shape — same read convention as
 *   `get-valid-imap-credentials.ts`.
 * - Re-encrypted with `encryptSecret` (same key, same versioned format);
 *   `keyVersion` column kept in sync with the ciphertext's own prefix.
 * - NEVER log the decrypted blob, the password, or the ciphertext.
 */
export async function updateSmtpConfig(
  raw: UpdateSmtpConfigInput,
): Promise<UpdateSmtpConfigResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  const row = await prisma.integration.findFirst({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
    },
    select: { id: true, encryptedTokens: true, externalAccountId: true },
  });
  if (!row || !row.encryptedTokens) return { ok: false, message: 'Boîte inconnue.' };

  const plaintext = decryptSecret(row.encryptedTokens);
  const existing = JSON.parse(plaintext) as
    | ImapCredentials
    | { imap: ImapCredentials; smtp?: SmtpCredentials };
  const imap: ImapCredentials = 'imap' in existing ? existing.imap : existing;

  const smtp: SmtpCredentials = {
    host: parsed.smtp.host,
    port: parsed.smtp.port,
    secure: parsed.smtp.secure,
    ...(parsed.smtp.requireTls !== undefined ? { requireTls: parsed.smtp.requireTls } : {}),
    username: row.externalAccountId ?? '',
    password: parsed.password,
  };

  const test = await testSmtpConnection(smtp);
  if (!test.ok) {
    return { ok: false, message: `Test SMTP échoué (${test.code}).` };
  }

  const encrypted = encryptSecret(JSON.stringify({ imap, smtp }));

  await prisma.integration.update({
    where: { id: row.id },
    data: {
      encryptedTokens: encrypted,
      keyVersion: keyVersionFromCiphertext(encrypted),
      status: 'active',
      lastError: null,
    },
  });

  return { ok: true };
}
