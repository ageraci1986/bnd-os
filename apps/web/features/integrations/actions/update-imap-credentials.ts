'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/oauth/crypto';
import { testImapConnection } from '@nexushub/integrations/imap';

const inputSchema = z.object({
  integrationId: z.string().uuid(),
  host: z.string().min(1).max(255),
  port: z.number().int().positive().max(65535),
  secure: z.boolean(),
  password: z.string().min(1).max(1024),
});

export type UpdateImapInput = z.infer<typeof inputSchema>;
export type UpdateImapResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** See `add-imap-mailbox.ts` — keeps the DB column in sync with the ciphertext's own prefix. */
function keyVersionFromCiphertext(ciphertext: string): number {
  const version = Number(ciphertext.split(':')[1]);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

/**
 * Server Action: rotate credentials for an existing IMAP mailbox (Reconnect
 * flow, e.g. after a password change). CLAUDE.md §4.2, §4.4.
 *
 * SECURITY: the ownership check (workspaceId + ownerUserId + kind='imap')
 * happens via `findFirst` before anything else — a mismatched
 * `integrationId` (someone else's row, another workspace, another kind)
 * returns a generic "unknown mailbox" error instead of leaking existence.
 */
export async function updateImapCredentials(raw: UpdateImapInput): Promise<UpdateImapResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);

  const row = await prisma.integration.findFirst({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
    },
    select: { id: true, externalAccountId: true },
  });
  if (!row) return { ok: false, message: 'Boîte inconnue.' };

  const username = row.externalAccountId ?? '';
  const test = await testImapConnection({
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username,
    password: parsed.password,
  });
  if (!test.ok) {
    return { ok: false, message: `Connexion refusée (${test.code}).` };
  }

  const encrypted = encryptSecret(
    JSON.stringify({
      host: parsed.host,
      port: parsed.port,
      secure: parsed.secure,
      username,
      password: parsed.password,
    }),
  );

  await prisma.integration.update({
    where: { id: row.id },
    data: {
      encryptedTokens: encrypted,
      keyVersion: keyVersionFromCiphertext(encrypted),
      status: 'active',
      lastError: null,
    },
  });

  // SECURITY: audit log must be PII-safe re: secrets — no password, no encrypted blob.
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'integration_connected',
      data: {
        kind: 'imap',
        reason: 'credentials_updated',
        integrationId: row.id,
        host: parsed.host,
        port: parsed.port,
        secure: parsed.secure,
      },
    },
  });

  return { ok: true };
}
