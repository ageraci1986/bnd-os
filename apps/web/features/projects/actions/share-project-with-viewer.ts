'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({
  projectId: z.string().uuid(),
  membershipId: z.string().uuid(),
  /** 'share' to grant, 'unshare' to revoke. */
  mode: z.enum(['share', 'unshare']),
});

export type ShareResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Grant or revoke a single Viewer's access to a project. The action takes
 * a plain object (called via useTransition from the modal); the CSRF
 * token is folded into a FormData internally so we reuse the same guard
 * as the form-driven actions.
 */
export async function shareProjectWithViewer(input: {
  projectId: string;
  membershipId: string;
  mode: 'share' | 'unshare';
  csrfToken: string;
}): Promise<ShareResult> {
  const fd = new FormData();
  fd.set('projectId', input.projectId);
  fd.set('membershipId', input.membershipId);
  fd.set('mode', input.mode);
  fd.set('_csrf', input.csrfToken);
  await assertCsrfFromFormData(fd);

  const ctx = await requireUser();

  const parsed = Schema.safeParse({
    projectId: input.projectId,
    membershipId: input.membershipId,
    mode: input.mode,
  });
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) return { ok: false, message: 'Projet introuvable.' };

  // Permission: Admin/super-admin always pass; a User passes if their
  // scope covers the project. A Viewer never shares.
  if (ctx.role !== Roles.Admin && !ctx.isSuperAdmin) {
    if (ctx.role === Roles.Viewer) {
      return { ok: false, message: 'Action réservée aux Admins.' };
    }
    const scope = await loadUserScope(ctx);
    if (scope.kind === 'restricted') {
      const allowed =
        scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
      if (!allowed) return { ok: false, message: 'Projet hors de ton scope.' };
    }
  }

  // Target must be a Viewer in this workspace.
  const target = await prisma.membership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { workspaceId: true, role: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { ok: false, message: 'Membre introuvable.' };
  }
  if (target.role !== Roles.Viewer) {
    return { ok: false, message: 'Le partage projet ne concerne que les Viewers.' };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  if (parsed.data.mode === 'share') {
    const existing = await prisma.workspaceAccess.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        projectId: parsed.data.projectId,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.workspaceAccess.create({
        data: {
          workspaceId: ctx.workspaceId,
          membershipId: parsed.data.membershipId,
          projectId: parsed.data.projectId,
          clientId: null,
          createdById: ctx.userId,
        },
      });
      await recordAudit({
        action: 'workspace_access_granted',
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        subjectType: 'membership',
        subjectId: parsed.data.membershipId,
        data: { projectId: parsed.data.projectId },
        ip,
        userAgent: ua,
      });
    }
  } else {
    const { count } = await prisma.workspaceAccess.deleteMany({
      where: {
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        projectId: parsed.data.projectId,
      },
    });
    if (count > 0) {
      await recordAudit({
        action: 'workspace_access_revoked',
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        subjectType: 'membership',
        subjectId: parsed.data.membershipId,
        data: { projectId: parsed.data.projectId },
        ip,
        userAgent: ua,
      });
    }
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
