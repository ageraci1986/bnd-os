'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';

const inputSchema = z.object({ integrationId: z.string().uuid() });

export type DisconnectImapMailboxInput = z.infer<typeof inputSchema>;
export type DisconnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Server Action: disconnect an IMAP mailbox (CLAUDE.md §4.2, §4.4).
 *
 * Marks the Integration `revoked`, clears the encrypted credentials, and
 * resets both UID cursors (`imapUidValidity` / `imapLastSeenUid`) so a
 * future re-connect refetches from scratch rather than resuming a stale
 * sync position. `EmailMessage` rows are intentionally left in place —
 * mails stay visible and linked to their client for continuity, matching
 * the Graph disconnect convention (see `disconnect-graph.ts`).
 *
 * Uses `updateMany` (not `update`) so the ownership check (workspaceId +
 * ownerUserId + kind) happens in the same query — `update` would throw a
 * runtime error on a non-matching id, whereas `updateMany` returns
 * `count: 0` that we can inspect cleanly.
 */
export async function disconnectImapMailbox(
  raw: DisconnectImapMailboxInput,
): Promise<DisconnectResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const r = await prisma.integration.updateMany({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      kind: 'imap',
    },
    data: {
      status: 'revoked',
      encryptedTokens: null,
      imapUidValidity: null,
      imapLastSeenUid: null,
    },
  });
  if (r.count === 0) return { ok: false, message: 'Boîte inconnue.' };

  // SECURITY: audit log must be PII-safe — no credentials, no email
  // content. `integration_disconnected` is reused from the closed
  // AuditAction enum (no dedicated `mailbox_disconnected` value; see
  // the Graph adapter's `disconnect-graph.ts` for the same convention).
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'integration_disconnected',
      data: { kind: 'imap', integrationId: parsed.integrationId },
    },
  });
  return { ok: true };
}
