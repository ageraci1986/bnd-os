'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

export type DisconnectGraphResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function disconnectGraph(): Promise<DisconnectGraphResult> {
  const ctx = await requireUser();
  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      kind: 'graph',
      ownerUserId: ctx.userId,
      status: { in: ['active', 'error'] },
    },
    select: { id: true },
  });
  if (!integration) {
    return { ok: false, message: 'Aucune intégration à déconnecter.' };
  }
  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: 'revoked',
      encryptedTokens: null,
      lastSyncedAt: null,
      deltaToken: null,
    },
  });
  // SECURITY: audit log must be PII-safe — no tokens, no email content.
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: 'integration_disconnected',
      data: { kind: 'graph' },
    },
  });
  return { ok: true };
}
