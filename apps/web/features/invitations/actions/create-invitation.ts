'use server';
import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { Roles, computeInvitationExpiry, crypto as nhCrypto } from '@nexushub/domain';
import { requireAdmin } from '@/lib/auth';
import { getServerEnv, getPublicEnv } from '@/lib/env';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getRateLimiter, getClientIp } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';
import { getEmail } from '@/lib/email';
import { renderInvitationEmail } from '../email/templates';

const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum([Roles.Admin, Roles.User, Roles.Viewer]).default(Roles.User),
});

export type CreateInvitationState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly email: string }
  | { readonly status: 'error'; readonly message: string };

export async function createInvitation(
  _prev: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  await assertCsrfFromFormData(formData);

  // Admin only — throws (redirect) if unauthenticated, throws Response 403 otherwise.
  const ctx = await requireAdmin();

  const parsed = CreateInvitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? Roles.User,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Adresse e-mail ou rôle invalide.' };
  }
  const { email, role } = parsed.data;

  // Phase A: Viewer requires a scope picker (Phase B). The UI disables
  // the option; this is the defence-in-depth.
  if (role === Roles.Viewer) {
    return {
      status: 'error',
      message: 'Le rôle Viewer sera disponible dans une prochaine mise à jour.',
    };
  }

  // Rate limit per Admin: 20 invitations / 24h
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;
  const rl = getRateLimiter('invitation');
  const limit = await rl.check(ctx.userId);
  if (!limit.success) {
    return {
      status: 'error',
      message: 'Limite quotidienne atteinte. Réessayez demain.',
    };
  }

  // Refuse if the email is already a member of the workspace.
  const existingMembership = await prisma.user.findUnique({
    where: { email },
    select: {
      memberships: {
        where: { workspaceId: ctx.workspaceId },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (existingMembership && existingMembership.memberships.length > 0) {
    return {
      status: 'error',
      message: "Cette personne est déjà membre de l'espace.",
    };
  }

  // Fetch workspace + inviter name for the email body.
  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);

  // Mint the token. Clear value goes ONLY in the email; DB stores the hash.
  const env = getServerEnv();
  const token = await nhCrypto.createInvitationToken(env.INVITATION_SECRET);
  const expiresAt = computeInvitationExpiry(new Date());

  // Replace any pending invitation for this email/workspace (idempotent UX).
  await prisma.invitation.updateMany({
    where: { workspaceId: ctx.workspaceId, email, status: 'pending' },
    data: { status: 'revoked' },
  });

  const created = await prisma.invitation.create({
    data: {
      workspaceId: ctx.workspaceId,
      email,
      role,
      tokenHash: token.hash,
      expiresAt,
      status: 'pending',
      createdById: ctx.userId,
    },
    select: { id: true },
  });

  // Send the email. Errors here do not roll back: we keep the invitation row
  // and the Admin can resend later.
  const acceptUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/signup/${token.clear}`;
  const inviterName =
    [inviter.firstName, inviter.lastName]
      .filter((s): s is string => Boolean(s))
      .join(' ')
      .trim() || inviter.email;

  const tpl = renderInvitationEmail({
    inviterName,
    workspaceName: workspace.name,
    acceptUrl,
    expiresAt,
  });

  try {
    await getEmail().send({
      to: email,
      subject: tpl.subject,
      text: tpl.text,
      htmlSanitized: tpl.htmlSanitized,
      tag: 'invitation',
    });
  } catch (err) {
    console.error('[createInvitation] email send failed', {
      invitationId: created.id,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  await recordAudit({
    action: 'invitation_created',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'invitation',
    subjectId: created.id,
    data: { role },
    ip,
    userAgent: ua,
  });

  return { status: 'success', email };
}
