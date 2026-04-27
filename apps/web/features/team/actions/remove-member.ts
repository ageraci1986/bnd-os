'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { Prisma, prisma } from '@nexushub/db';
import { requireAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({ membershipId: z.string().uuid() });

export type RemoveMemberState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

export async function removeMember(
  _prev: RemoveMemberState,
  formData: FormData,
): Promise<RemoveMemberState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireAdmin();

  const parsed = Schema.safeParse({ membershipId: formData.get('membershipId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant de membership invalide.' };
  }
  const { membershipId } = parsed.data;

  // Cannot remove yourself.
  const target = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { userId: true, workspaceId: true, role: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Membre introuvable.' };
  }
  if (target.userId === ctx.userId) {
    return {
      status: 'error',
      message: "Vous ne pouvez pas vous retirer vous-même. Promouvez d'abord un autre Admin.",
    };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  // The DB trigger `protect_last_admin` enforces "≥ 1 admin per workspace".
  // We surface its error here as a friendly message.
  try {
    await prisma.membership.delete({ where: { id: membershipId } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.message.includes('LAST_ADMIN_PROTECTED')
    ) {
      return {
        status: 'error',
        message: "Impossible : ce membre est le dernier Admin de l'espace.",
      };
    }
    throw err;
  }

  await recordAudit({
    action: 'member_removed',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: membershipId,
    data: { removedRole: target.role },
    ip,
    userAgent: ua,
  });

  revalidatePath('/team');
  return { status: 'success' };
}
