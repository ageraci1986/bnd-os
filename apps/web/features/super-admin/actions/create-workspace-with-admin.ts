'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { Prisma, prisma } from '@nexushub/db';
import { Roles } from '@nexushub/domain';
import { requireSuperAdmin } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { issueInvitation } from '@/features/invitations/lib/issue-invitation';

// Bounded quantifier on a flat character class — ReDoS-safe but the
// plugin flags any {n,m} repetition by default.
// eslint-disable-next-line security/detect-unsafe-regex
const SlugRegex = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;

const Schema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SlugRegex,
      'Slug invalide : minuscules, chiffres et tirets uniquement (3-60 caractères).',
    ),
  adminEmail: z.string().trim().toLowerCase().email().max(254),
});

export type CreateWorkspaceState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'success';
      readonly workspaceId: string;
      readonly workspaceName: string;
      readonly adminEmail: string;
    }
  | { readonly status: 'error'; readonly message: string };

/**
 * Phase C super-admin action: provisions a brand-new workspace and
 * sends an Admin invitation to the email provided. The super-admin
 * does NOT become a member of the new workspace — they stay external
 * at the platform level.
 */
export async function createWorkspaceWithAdmin(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireSuperAdmin();

  const parsed = Schema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    adminEmail: formData.get('adminEmail'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }
  const { name, slug, adminEmail } = parsed.data;

  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? null;

  // Create the workspace row. We surface the unique-slug collision as a
  // friendly message; everything else propagates.
  let workspaceId: string;
  try {
    const workspace = await prisma.workspace.create({
      data: { name, slug },
      select: { id: true },
    });
    workspaceId = workspace.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        status: 'error',
        message: 'Ce slug est déjà utilisé par un autre workspace.',
      };
    }
    throw err;
  }

  // Send the Admin invitation. Failures here don't roll back the
  // workspace — the super-admin can retry via inviteAdminToWorkspace.
  await issueInvitation({
    workspaceId,
    email: adminEmail,
    role: Roles.Admin,
    scopeClientIds: [],
    scopeProjectIds: [],
    actorUserId: ctx.userId,
    // Super-admin isn't a member of the new workspace — show the
    // platform brand as the inviter instead of leaking the super-admin's
    // identity to the recipient.
    anonymousInviter: true,
  });

  await recordAudit({
    action: 'workspace_created',
    workspaceId,
    actorId: ctx.userId,
    subjectType: 'workspace',
    subjectId: workspaceId,
    data: { name, slug, firstAdminEmail: adminEmail },
    ip,
    userAgent: ua,
  });

  revalidatePath('/super-admin');
  return {
    status: 'success',
    workspaceId,
    workspaceName: name,
    adminEmail,
  };
}
