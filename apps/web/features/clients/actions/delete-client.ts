'use server';
import 'server-only';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { canDeleteClient } from '@nexushub/domain';
import { requireUserVerified } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { SCOPE_ERROR_MESSAGE } from '@/features/projects/lib/scope-error';
import { DeleteClientSchema } from '../lib/schemas';

export type DeleteClientState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Soft-delete a client (PRD §10 #14): refused if any active project is
 * still attached. Contacts cascade-soft-delete via the same `deletedAt`
 * stamp so the count updates immediately in the sidebar.
 */
export async function deleteClient(
  _prev: DeleteClientState,
  formData: FormData,
): Promise<DeleteClientState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUserVerified();

  const parsed = DeleteClientSchema.safeParse({ clientId: formData.get('clientId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant client invalide.' };
  }
  const { clientId } = parsed.data;

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      _count: {
        select: { projects: { where: { deletedAt: null, archivedAt: null } } },
      },
    },
  });
  if (!client) {
    return { status: 'error', message: 'Client introuvable.' };
  }

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(clientId);
    if (!allowed) return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }

  const guard = canDeleteClient({ activeProjectsCount: client._count.projects });
  if (!guard.ok) {
    return {
      status: 'error',
      message:
        guard.activeProjectsCount === 1
          ? 'Suppression impossible : 1 projet actif est encore attaché à ce client.'
          : `Suppression impossible : ${guard.activeProjectsCount} projets actifs sont encore attachés à ce client.`,
    };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { clientId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.client.update({
      where: { id: clientId },
      data: { deletedAt: now },
    }),
  ]);

  const reqHeaders = await headers();
  await recordAudit({
    action: 'client_deleted',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'client',
    subjectId: clientId,
    ip: getClientIp(reqHeaders),
    userAgent: reqHeaders.get('user-agent') ?? null,
  });

  revalidatePath('/clients');
  revalidatePath('/(app)/layout', 'layout');
  redirect('/clients');
}
