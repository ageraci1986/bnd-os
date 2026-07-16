'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@nexushub/db';
import { sanitizeMailHtml } from '@nexushub/integrations/mail';

const inputSchema = z.object({
  integrationId: z.string().uuid(),
  signatureHtml: z.string().max(50_000),
});

export type UpdateSignatureInput = z.infer<typeof inputSchema>;
export type UpdateSignatureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Server Action: update the HTML signature spliced into future outbound
 * mails for an Integration (mailbox). CLAUDE.md §4.4, §4.5.
 *
 * SECURITY: `sanitizeMailHtml` runs here as a second barrier on top of the
 * one applied at send-time (CLAUDE.md §4.5.3) — signatures are user-supplied
 * HTML that gets persisted and later re-embedded verbatim into outbound
 * messages, so they must never carry scripts/handlers into storage either.
 *
 * Ownership check via `updateMany` (workspaceId + ownerUserId) — `count: 0`
 * means "not found or not owned", same pattern as `disconnectImapMailbox`.
 *
 * AUDIT: no dedicated `integration_updated` value exists in the (closed)
 * `AuditAction` enum — reusing `integration_connected` with a
 * `field: 'signature_html'` discriminator per the mail-send iteration plan
 * (Task 17), matching the `update-imap-credentials.ts` convention. Payload
 * never includes the signature content (PII/content leak, CLAUDE.md §4.7).
 */
export async function updateSignature(raw: UpdateSignatureInput): Promise<UpdateSignatureResult> {
  const ctx = await requireUser();
  const parsed = inputSchema.parse(raw);
  const sanitized = sanitizeMailHtml(parsed.signatureHtml);
  const r = await prisma.integration.updateMany({
    where: {
      id: parsed.integrationId,
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
    },
    data: { signatureHtml: sanitized.length > 0 ? sanitized : null },
  });
  if (r.count === 0) return { ok: false, message: 'Boîte inconnue.' };

  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'integration_connected',
      data: { integrationId: parsed.integrationId, field: 'signature_html' },
    },
  });
  return { ok: true };
}
