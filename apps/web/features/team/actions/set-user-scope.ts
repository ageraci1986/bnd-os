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
  /** Comma-separated list of client UUIDs to grant. Empty = clear all. */
  clientIds: z.string().optional(),
  /** Comma-separated list of project UUIDs to grant. Empty = clear all. */
  projectIds: z.string().optional(),
  /** When true, removes ALL existing rows (used for "Reset to full workspace"). */
  clearAll: z.string().optional(),
});

export type SetScopeState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export async function setUserScope(
  _prev: SetScopeState,
  formData: FormData,
): Promise<SetScopeState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireAdmin();

  const parsed = Schema.safeParse({
    membershipId: formData.get('membershipId'),
    clientIds: formData.get('clientIds') ?? undefined,
    projectIds: formData.get('projectIds') ?? undefined,
    clearAll: formData.get('clearAll') ?? undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Données invalides.' };
  }

  const target = await prisma.membership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { workspaceId: true, role: true, userId: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) {
    return { status: 'error', message: 'Membre introuvable.' };
  }
  if (target.role === Roles.Admin) {
    return { status: 'error', message: 'Un Admin ne peut pas être restreint.' };
  }

  const clientIds = parseUuidList(parsed.data.clientIds);
  const projectIds = parseUuidList(parsed.data.projectIds);
  const clearAll = parsed.data.clearAll === '1';

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.workspaceAccess.deleteMany({
      where: { workspaceId: ctx.workspaceId, membershipId: parsed.data.membershipId },
    });

    if (clearAll || (clientIds.length === 0 && projectIds.length === 0)) {
      return;
    }

    const rows = [
      ...clientIds.map((clientId) => ({
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        clientId,
        projectId: null,
        createdById: ctx.userId,
      })),
      ...projectIds.map((projectId) => ({
        workspaceId: ctx.workspaceId,
        membershipId: parsed.data.membershipId,
        clientId: null,
        projectId,
        createdById: ctx.userId,
      })),
    ];
    if (rows.length > 0) {
      await tx.workspaceAccess.createMany({ data: rows });
    }
  });

  await recordAudit({
    action:
      clearAll || (clientIds.length === 0 && projectIds.length === 0)
        ? 'workspace_access_revoked'
        : 'workspace_access_granted',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: parsed.data.membershipId,
    data: { clientIds, projectIds, clearAll },
    ip,
    userAgent: ua,
  });

  revalidatePath('/team');
  return { status: 'success' };
}
