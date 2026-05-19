import 'server-only';
import { prisma } from '@nexushub/db';
import { computeInvitationExpiry, crypto as nhCrypto, type Role } from '@nexushub/domain';
import { getServerEnv, getPublicEnv } from '@/lib/env';
import { getEmail } from '@/lib/email';
import { renderInvitationEmail } from '../email/templates';

export interface IssueInvitationInput {
  readonly workspaceId: string;
  readonly email: string;
  readonly role: Role;
  readonly scopeClientIds: readonly string[];
  readonly scopeProjectIds: readonly string[];
  readonly actorUserId: string;
  /**
   * When true, the email's `From: <inviter name>` is overridden with a
   * generic platform label instead of looking the actor up. Useful for
   * the super-admin path where the actor may not be a member of the
   * target workspace and the recipient wouldn't know who they are.
   */
  readonly anonymousInviter?: boolean;
}

export interface IssueInvitationResult {
  readonly invitationId: string;
  readonly expiresAt: Date;
  readonly sentToEmail: string;
}

/**
 * Mint an invitation token, persist the row (revoking any pending one
 * for the same email/workspace), build and send the email, and return
 * the new id. Auth, CSRF, rate-limit and audit logging stay in the
 * calling server action — this helper is purely the "issue an
 * invitation" mechanism.
 */
export async function issueInvitation(input: IssueInvitationInput): Promise<IssueInvitationResult> {
  const env = getServerEnv();
  const token = await nhCrypto.createInvitationToken(env.INVITATION_SECRET);
  const expiresAt = computeInvitationExpiry(new Date());

  // Idempotent: any pending invitation for this email/workspace is
  // revoked, then we insert the new one in the same transaction so the
  // recipient never holds two valid links at once.
  const created = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { workspaceId: input.workspaceId, email: input.email, status: 'pending' },
      data: { status: 'revoked' },
    });
    return tx.invitation.create({
      data: {
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        scopeClientIds: [...input.scopeClientIds],
        scopeProjectIds: [...input.scopeProjectIds],
        tokenHash: token.hash,
        expiresAt,
        status: 'pending',
        createdById: input.actorUserId,
      },
      select: { id: true },
    });
  });

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      select: { name: true },
    }),
    input.anonymousInviter
      ? Promise.resolve(null)
      : prisma.user.findUniqueOrThrow({
          where: { id: input.actorUserId },
          select: { firstName: true, lastName: true, email: true },
        }),
  ]);

  const acceptUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/signup/${token.clear}`;
  const inviterName = inviter
    ? [inviter.firstName, inviter.lastName]
        .filter((s): s is string => Boolean(s))
        .join(' ')
        .trim() || inviter.email
    : 'NexusHub';

  const tpl = renderInvitationEmail({
    inviterName,
    workspaceName: workspace.name,
    acceptUrl,
    expiresAt,
  });

  try {
    await getEmail().send({
      to: input.email,
      subject: tpl.subject,
      text: tpl.text,
      htmlSanitized: tpl.htmlSanitized,
      tag: 'invitation',
    });
  } catch (err) {
    // Don't roll back: the row is in DB, the admin can resend later.
    console.error('[issueInvitation] email send failed', {
      invitationId: created.id,
      workspaceId: input.workspaceId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  return {
    invitationId: created.id,
    expiresAt,
    sentToEmail: input.email,
  };
}
