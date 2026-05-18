'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum([Roles.Admin, Roles.User, Roles.Viewer]),
});

export type ChangeRoleState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

export async function changeMemberRole(
  _prev: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireAdmin();

  const parsed = Schema.safeParse({
    membershipId: formData.get('membershipId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Données invalides.' };
  }
  const { membershipId, role } = parsed.data;

  const target = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { workspaceId: true, role: true, userId: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Membre introuvable.' };
  }
  if (target.role === role) {
    return { status: 'success' };
  }

  if (role === Roles.Viewer) {
    const accessCount = await prisma.workspaceAccess.count({
      where: { workspaceId: ctx.workspaceId, membershipId },
    });
    if (accessCount === 0) {
      return {
        status: 'error',
        message: "Définis d'abord un scope pour ce membre avant de le passer en Viewer.",
      };
    }
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  try {
    await prisma.membership.update({
      where: { id: membershipId },
      data: { role },
    });
  } catch (err) {
    // Detect the `protect_last_admin` trigger error by message string.
    // Turbopack's RSC module boundary loads Prisma twice, so
    // `instanceof Prisma.PrismaClientKnownRequestError` is unreliable —
    // and PG raise-exception errors actually surface as
    // PrismaClientUnknownRequestError, which would never match anyway.
    if (err instanceof Error && err.message.includes('LAST_ADMIN_PROTECTED')) {
      return {
        status: 'error',
        message: "Impossible : ce membre est le dernier Admin de l'espace.",
      };
    }
    throw err;
  }

  await recordAudit({
    action: 'member_role_changed',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: membershipId,
    data: { from: target.role, to: role },
    ip,
    userAgent: ua,
  });

  revalidatePath('/team');
  return { status: 'success' };
}
