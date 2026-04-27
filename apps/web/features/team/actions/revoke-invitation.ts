'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({ invitationId: z.string().uuid() });

export type RevokeInvitationState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

export async function revokeInvitation(
  _prev: RevokeInvitationState,
  formData: FormData,
): Promise<RevokeInvitationState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireAdmin();

  const parsed = Schema.safeParse({ invitationId: formData.get('invitationId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant invalide.' };
  }
  const { invitationId } = parsed.data;

  const target = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { workspaceId: true, status: true, email: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Invitation introuvable.' };
  }
  if (target.status !== 'pending') {
    return { status: 'error', message: "Cette invitation n'est plus en attente." };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'revoked' },
  });

  await recordAudit({
    action: 'invitation_revoked',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'invitation',
    subjectId: invitationId,
    ip,
    userAgent: ua,
  });

  revalidatePath('/team');
  return { status: 'success' };
}
