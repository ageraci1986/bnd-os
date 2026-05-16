'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { checkInvitationUsable, crypto as nhCrypto } from '@nexushub/domain';
import { createSupabaseAdmin, createSupabaseServer } from '@/lib/supabase/server';
import { getServerEnv } from '@/lib/env';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getRateLimiter, getClientIp } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';

const AcceptSchema = z.object({
  token: z.string().min(40).max(256),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  password: z.string().min(12, { message: 'Mot de passe minimum 12 caractères.' }).max(256),
  passwordConfirm: z.string().min(12).max(256),
  acceptTerms: z.literal('on', { message: 'Vous devez accepter les conditions.' }),
});

export type AcceptInvitationState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

const GENERIC_ERROR =
  "Le lien d'invitation est invalide, expiré ou déjà utilisé. Demandez un nouvel envoi.";

export async function acceptInvitation(
  _prev: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  await assertCsrfFromFormData(formData);

  const parsed = AcceptSchema.safeParse({
    token: formData.get('token'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
    acceptTerms: formData.get('acceptTerms'),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { status: 'error', message: first?.message ?? GENERIC_ERROR };
  }
  const { token, firstName, lastName, password, passwordConfirm } = parsed.data;

  if (password !== passwordConfirm) {
    return { status: 'error', message: 'Les mots de passe ne correspondent pas.' };
  }

  // Rate limit per token: 5 attempts/hour. Prevents online password tries
  // against a known leaked invitation link.
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;
  const rl = getRateLimiter('signup_token');
  const limit = await rl.check(`${ip}:${token.slice(0, 16)}`);
  if (!limit.success) {
    return {
      status: 'error',
      message: 'Trop de tentatives. Réessayez dans une heure.',
    };
  }

  // Validate the token shape (HMAC) before touching the DB.
  const env = getServerEnv();
  const shapeOk = await nhCrypto.validateInvitationTokenShape(token, env.INVITATION_SECRET);
  if (!shapeOk) {
    return { status: 'error', message: GENERIC_ERROR };
  }

  const tokenHash = await nhCrypto.sha256Hex(token);

  // Look up + atomically consume in a transaction.
  const consumed = await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        scopeClientIds: true,
        scopeProjectIds: true,
        expiresAt: true,
        consumedAt: true,
        status: true,
        workspaceId: true,
        createdById: true,
      },
    });
    if (!inv) return null;

    const usable = checkInvitationUsable(
      { status: inv.status, expiresAt: inv.expiresAt, consumedAt: inv.consumedAt },
      new Date(),
    );
    if (!usable.ok) return null;

    return inv;
  });

  if (!consumed) {
    return { status: 'error', message: GENERIC_ERROR };
  }

  // Create the auth.users row via admin API. Email is set as confirmed since
  // the invitation link itself proved control of the inbox.
  const admin = createSupabaseAdmin();
  const created = await admin.auth.admin.createUser({
    email: consumed.email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName },
  });

  if (created.error || !created.data.user) {
    return { status: 'error', message: GENERIC_ERROR };
  }
  const newUserId = created.data.user.id;

  // Mark invitation consumed + create membership + update profile in one tx.
  // The DB trigger `handle_new_auth_user` already inserted public.users for us.
  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: consumed.id },
      data: {
        status: 'accepted',
        consumedAt: new Date(),
        consumedByUserId: newUserId,
      },
    });
    await tx.user.update({
      where: { id: newUserId },
      data: { firstName, lastName },
    });
    const newMembership = await tx.membership.create({
      data: {
        workspaceId: consumed.workspaceId,
        userId: newUserId,
        role: consumed.role,
      },
      select: { id: true },
    });

    // Materialise the persisted scope as WorkspaceAccess rows. Empty arrays
    // = no restriction (the default for User). Viewer always has at least
    // one row because createInvitation refused otherwise.
    const accessRows = [
      ...consumed.scopeClientIds.map((clientId) => ({
        workspaceId: consumed.workspaceId,
        membershipId: newMembership.id,
        clientId,
        projectId: null,
        createdById: consumed.createdById,
      })),
      ...consumed.scopeProjectIds.map((projectId) => ({
        workspaceId: consumed.workspaceId,
        membershipId: newMembership.id,
        clientId: null,
        projectId,
        createdById: consumed.createdById,
      })),
    ];
    if (accessRows.length > 0) {
      await tx.workspaceAccess.createMany({ data: accessRows });
    }
  });

  await recordAudit({
    action: 'invitation_accepted',
    workspaceId: consumed.workspaceId,
    actorId: newUserId,
    subjectType: 'invitation',
    subjectId: consumed.id,
    data: { role: consumed.role },
    ip,
    userAgent: ua,
  });

  // Sign the user in immediately.
  const supabase = await createSupabaseServer();
  await supabase.auth.signInWithPassword({ email: consumed.email, password });

  redirect('/overview');
}
