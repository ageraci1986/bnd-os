import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles, type Role } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getRateLimiter } from '@/lib/rate-limit';
import { issueInvitation } from '@/features/invitations/lib/issue-invitation';
import { isLastAdminProtectedError } from './last-admin-error';

/**
 * Team cores (Plan 5b Task 4).
 *
 * Extracted for the future admin-only assistant tools
 * (`change_member_role` / `remove_member` / `invite_member`), so they reuse
 * the exact same checks as the form-based Server Actions in `../actions/`
 * without FormData/CSRF/`revalidatePath`, which only make sense for a
 * browser navigation. Pattern mirrors `features/clients/lib/client-core.ts`
 * (Plan 5b Task 2).
 *
 * Every core here starts with an explicit `ctx.role !== Roles.Admin` check.
 * This is defense in depth: Task 5 wires `adminOnly` into the tool registry
 * gate, but the core must never trust the caller to have done that.
 *
 * `changeMemberRoleCore` and `removeMemberCore` take a `userId`, not a
 * `membershipId` (unlike `changeMemberRole`/`removeMember`, the underlying
 * form actions). The assistant identifies a team member by who they are,
 * not by an opaque membership row id it has no way of knowing — and
 * `Membership` has a `@@unique([workspaceId, userId])` constraint, so the
 * lookup is a single indexed query either way.
 */

const ADMIN_ONLY_MESSAGE = 'Action réservée aux administrateurs.';
const LAST_ADMIN_MESSAGE = "Impossible : ce membre est le dernier Admin de l'espace.";
const MEMBER_NOT_FOUND_MESSAGE = 'Membre introuvable.';

/**
 * Same normalization + validation as `CreateInvitationSchema` in
 * `create-invitation.ts`. The core validates itself (I1): the caller is an
 * LLM tool loop, not a Zod-validated form — its email must never be trusted
 * raw. The NORMALIZED value is the only one used for the already-member
 * check, `issueInvitation`, and the return value.
 */
const InviteEmailSchema = z.string().trim().toLowerCase().email().max(254);

// =====================================================================
// changeMemberRoleCore
// =====================================================================

export interface ChangeMemberRoleCoreInput {
  readonly userId: string;
  readonly role: Role;
}

export type ChangeMemberRoleCoreResult =
  | { readonly ok: true; readonly role: Role }
  | { readonly ok: false; readonly message: string };

/**
 * Note: unlike `removeMemberCore`, this does NOT refuse an Admin changing
 * their own role. `changeMemberRole` (the form action) never enforced that
 * either — `MemberRow`'s role `<select>` isn't disabled for "Vous" (only
 * the Retirer button is) — so self-demotion is allowed and, when it would
 * leave the workspace without an Admin, is caught by the same
 * `LAST_ADMIN_PROTECTED` DB trigger as any other admin's role change.
 */
export async function changeMemberRoleCore(
  ctx: AuthContext,
  input: ChangeMemberRoleCoreInput,
): Promise<ChangeMemberRoleCoreResult> {
  if (ctx.role !== Roles.Admin) {
    return { ok: false, message: ADMIN_ONLY_MESSAGE };
  }

  const target = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
    select: { id: true, role: true },
  });
  if (!target) {
    return { ok: false, message: MEMBER_NOT_FOUND_MESSAGE };
  }
  if (target.role === input.role) {
    return { ok: true, role: target.role };
  }

  if (input.role === Roles.Viewer) {
    const accessCount = await prisma.workspaceAccess.count({
      where: { workspaceId: ctx.workspaceId, membershipId: target.id },
    });
    if (accessCount === 0) {
      return {
        ok: false,
        message: "Définis d'abord un scope pour ce membre avant de le passer en Viewer.",
      };
    }
  }

  try {
    await prisma.membership.update({
      where: { id: target.id },
      data: { role: input.role },
    });
  } catch (err) {
    if (isLastAdminProtectedError(err)) {
      return { ok: false, message: LAST_ADMIN_MESSAGE };
    }
    throw err;
  }

  await recordAudit({
    action: 'member_role_changed',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: target.id,
    data: { from: target.role, to: input.role },
  });

  // Lecture-après-écriture : le rôle retourné est RELU plutôt qu'assemblé
  // depuis l'input, pour refléter la valeur réellement stockée (mirrors
  // `updateClientCore`).
  const after = await prisma.membership.findUnique({
    where: { id: target.id },
    select: { role: true },
  });
  if (after === null) throw new NotFoundError('Membership');

  return { ok: true, role: after.role };
}

// =====================================================================
// removeMemberCore
// =====================================================================

export interface RemoveMemberCoreInput {
  readonly userId: string;
}

export type RemoveMemberCoreResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function removeMemberCore(
  ctx: AuthContext,
  input: RemoveMemberCoreInput,
): Promise<RemoveMemberCoreResult> {
  if (ctx.role !== Roles.Admin) {
    return { ok: false, message: ADMIN_ONLY_MESSAGE };
  }

  // Cannot remove yourself — checked before the lookup since it never
  // needs one (mirrors `remove-member.ts`'s message exactly).
  if (input.userId === ctx.userId) {
    return {
      ok: false,
      message: "Vous ne pouvez pas vous retirer vous-même. Promouvez d'abord un autre Admin.",
    };
  }

  const target = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId } },
    select: { id: true, role: true },
  });
  if (!target) {
    return { ok: false, message: MEMBER_NOT_FOUND_MESSAGE };
  }

  // The DB trigger `protect_last_admin` enforces "≥ 1 admin per workspace".
  // We surface its error here as a friendly message.
  try {
    await prisma.membership.delete({ where: { id: target.id } });
  } catch (err) {
    if (isLastAdminProtectedError(err)) {
      return { ok: false, message: LAST_ADMIN_MESSAGE };
    }
    throw err;
  }

  await recordAudit({
    action: 'member_removed',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'membership',
    subjectId: target.id,
    data: { removedRole: target.role },
  });

  return { ok: true };
}

// =====================================================================
// inviteMemberCore
// =====================================================================

export interface InviteMemberCoreInput {
  /** Raw caller-provided email — normalized (trim + lowercase) and validated inside the core. */
  readonly email: string;
  readonly role: Role;
}

export type InviteMemberCoreResult =
  | { readonly ok: true; readonly email: string; readonly role: Role }
  | { readonly ok: false; readonly message: string };

/**
 * Admin-only. Unlike `createInvitation` (the form action, which lets an
 * Admin pick a client/project scope for a Viewer in the same submit),
 * a tool call has no scope-picker step — so Viewer is refused outright
 * rather than only when the scope is empty. The Admin is pointed back at
 * the Équipe UI, which does support inviting a scoped Viewer.
 */
export async function inviteMemberCore(
  ctx: AuthContext,
  input: InviteMemberCoreInput,
): Promise<InviteMemberCoreResult> {
  if (ctx.role !== Roles.Admin) {
    return { ok: false, message: ADMIN_ONLY_MESSAGE };
  }

  // I1: normalize + validate before ANY use. Everything below (already-member
  // check, issueInvitation, return value) uses only the normalized form.
  const parsedEmail = InviteEmailSchema.safeParse(input.email);
  if (!parsedEmail.success) {
    return { ok: false, message: 'Adresse email invalide.' };
  }
  const email = parsedEmail.data;

  if (input.role === Roles.Viewer) {
    return {
      ok: false,
      message: "Utilise l'interface Équipe pour inviter un Viewer avec son scope.",
    };
  }

  // Rate limit per Admin: 20 invitations / 24h — same limiter key + message
  // as `createInvitation`.
  const rl = getRateLimiter('invitation');
  const limit = await rl.check(ctx.userId);
  if (!limit.success) {
    return { ok: false, message: 'Limite quotidienne atteinte. Réessayez demain.' };
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
    return { ok: false, message: "Cette personne est déjà membre de l'espace." };
  }

  const result = await issueInvitation({
    workspaceId: ctx.workspaceId,
    email,
    role: input.role,
    scopeClientIds: [],
    scopeProjectIds: [],
    actorUserId: ctx.userId,
  });

  // No PII (email) in audit data — mirrors `createInvitation`'s
  // `data: { role }` and `inviteAdminToWorkspace`'s `data: { role, ... }`.
  // The clear invitation token is never available here: `issueInvitation`
  // only returns `invitationId` / `expiresAt` / `sentToEmail`.
  await recordAudit({
    action: 'invitation_created',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'invitation',
    subjectId: result.invitationId,
    data: { role: input.role },
  });

  return { ok: true, email, role: input.role };
}
