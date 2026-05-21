'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles } from '@nexushub/domain';
import { requireUserVerified } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE } from '../lib/scope-error';

const Schema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Soft-delete a project (ADR 0001 #15: corbeille 30j, restore Admin V1.5).
 * The DB row stays — we only flip `deletedAt`. Cards belonging to the
 * project remain in DB; they're filtered out of every query by the
 * existing `deletedAt: null` guards.
 */
export async function deleteProject(input: {
  projectId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUserVerified();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: 'Action réservée aux Admins et Users.' };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant projet invalide.' };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) throw new NotFoundError('Project');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { deletedAt: new Date() },
  });

  revalidatePath('/projects');
  redirect('/projects');
}
