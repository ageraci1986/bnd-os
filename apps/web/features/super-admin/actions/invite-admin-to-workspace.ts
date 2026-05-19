'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireSuperAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { issueInvitation } from '@/features/invitations/lib/issue-invitation';

const Schema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
});

export type InviteAdminState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly workspaceId: string; readonly email: string }
  | { readonly status: 'error'; readonly message: string };

/**
 * Super-admin adds an additional Admin to an existing workspace.
 * Wraps the shared `issueInvitation` helper with the super-admin auth
 * path. Unlike the in-workspace `createInvitation`, this skips the
 * per-Admin rate limit (super-admin is high-trust) and doesn't
 * pre-check workspace membership (it's safe to invite someone who is
 * already a member — `acceptInvitation` no-ops on a re-accept).
 */
export async function inviteAdminToWorkspace(
  _prev: InviteAdminState,
  formData: FormData,
): Promise<InviteAdminState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireSuperAdmin();

  const parsed = Schema.safeParse({
    workspaceId: formData.get('workspaceId'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Workspace ou email invalide.' };
  }
  const { workspaceId, email } = parsed.data;

  // Confirm the workspace exists before sending the email.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) {
    return { status: 'error', message: 'Workspace introuvable.' };
  }

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  const result = await issueInvitation({
    workspaceId,
    email,
    role: Roles.Admin,
    scopeClientIds: [],
    scopeProjectIds: [],
    actorUserId: ctx.userId,
    anonymousInviter: true,
  });

  await recordAudit({
    action: 'invitation_created',
    workspaceId,
    actorId: ctx.userId,
    subjectType: 'invitation',
    subjectId: result.invitationId,
    data: { role: Roles.Admin, viaSuperAdmin: true },
    ip,
    userAgent: ua,
  });

  revalidatePath('/super-admin');
  revalidatePath(`/super-admin/workspaces/${workspaceId}`);
  return { status: 'success', workspaceId, email };
}
