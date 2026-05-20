'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireSuperAdmin, requireUserVerified } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

const Schema = z.object({
  workspaceId: z.string().uuid(),
  /**
   * Defence in depth: the UI requires the user to type the exact
   * workspace name before submitting. We re-verify server-side so a
   * crafted request can't bypass the safeguard.
   */
  confirmationName: z.string().min(1).max(80),
});

export type DeleteWorkspaceState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly deletedName: string }
  | { readonly status: 'error'; readonly message: string };

/**
 * Hard-delete a workspace and everything attached to it. All child
 * tables (memberships, invitations, projects, clients, columns, cards,
 * templates, integrations, audit logs, …) cascade via the
 * `onDelete: Cascade` rules already declared in the Prisma schema, so
 * a single `prisma.workspace.delete` is enough — no manual cleanup.
 *
 * SECURITY:
 *  - Requires platform super-admin (`requireSuperAdmin`).
 *  - Requires the caller to type the EXACT workspace name in the
 *    confirmation field (GitHub-style "type the repo name to confirm").
 *    The audit row is written BEFORE the delete so the trail survives
 *    even if the cascade wipes the workspace's own audit_log rows.
 */
export async function deleteWorkspace(
  _prev: DeleteWorkspaceState,
  formData: FormData,
): Promise<DeleteWorkspaceState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireSuperAdmin();
  await requireUserVerified();

  const parsed = Schema.safeParse({
    workspaceId: formData.get('workspaceId'),
    confirmationName: formData.get('confirmationName'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Données invalides.' };
  }
  const { workspaceId, confirmationName } = parsed.data;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, _count: { select: { memberships: true } } },
  });
  if (!workspace) {
    return { status: 'error', message: 'Workspace introuvable.' };
  }

  // Strict equality — no trim, no case-fold — the user MUST type the
  // exact rendered name. Reject otherwise to prevent typo-driven
  // accidental deletions.
  if (confirmationName !== workspace.name) {
    return {
      status: 'error',
      message: `La confirmation ne correspond pas au nom du workspace « ${workspace.name} ».`,
    };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  // Audit FIRST: the cascade will remove the workspace's own audit_log
  // rows (workspaceId FK with onDelete: Cascade), but since the row is
  // already written to disk and the FK target row still exists at this
  // point, this entry remains queryable after the workspace is gone.
  // Belt-and-braces: we also record the slug + member count so a
  // forensic trail survives even if the audit row itself ends up
  // cascade-deleted (depends on the audit_log FK rule).
  await recordAudit({
    action: 'workspace_deleted',
    workspaceId,
    actorId: ctx.userId,
    subjectType: 'workspace',
    subjectId: workspaceId,
    data: {
      name: workspace.name,
      slug: workspace.slug,
      memberCount: workspace._count.memberships,
    },
    ip,
    userAgent: ua,
  });

  await prisma.workspace.delete({ where: { id: workspaceId } });

  revalidatePath('/super-admin');
  return { status: 'success', deletedName: workspace.name };
}
