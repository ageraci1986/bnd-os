import 'server-only';
import { Prisma, prisma } from '@nexushub/db';
import { NotFoundError, Roles, canDeleteClient } from '@nexushub/domain';
import type { ClientColorToken, Raci } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { recordAudit } from '@/lib/audit';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '@/features/projects/lib/scope-error';
import type { CreateClientInput, CreateContactInput } from './schemas';

/**
 * Client + Contact cores (Plan 5b Task 2).
 *
 * Extracted from the form-based Server Actions in `../actions/` so the
 * assistant's mutant tools can reuse the exact same checks (Viewer refusal,
 * scope, ADR §10 #14 deletion guard) without FormData/CSRF/redirect, which
 * only make sense for a browser navigation. Pattern mirrors
 * `features/projects/lib/project-core.ts` (Plan 5a) and
 * `features/projects/lib/card-core.ts` (Plan 2a).
 *
 * Every core here is workspace-scoped and Viewer-refused: PRD §6.7 grants
 * `client.crud` to Admin + Membre, not Viewer — the original form actions
 * never enforced this explicitly (Zod + CSRF only), so this extraction also
 * closes that gap.
 */

const DUPLICATE_NAME_MESSAGE = 'Un client porte déjà ce nom.';

// =====================================================================
// createClientCore
// =====================================================================

export type CreateClientCoreResult =
  | { readonly ok: true; readonly clientId: string; readonly slug: string }
  | { readonly ok: false; readonly message: string };

export async function createClientCore(
  ctx: AuthContext,
  input: CreateClientInput,
): Promise<CreateClientCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    // Restricted users cannot create top-level resources outside their scope.
    return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  try {
    const created = await prisma.client.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        colorToken: input.colorToken,
        initials: input.initials,
        domains: input.domains,
        notes: input.notes,
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      action: 'client_created',
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      subjectType: 'client',
      subjectId: created.id,
    });

    return {
      ok: true,
      clientId: created.id,
      slug: created.name.toLowerCase().replaceAll(/\s+/g, '-'),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, message: DUPLICATE_NAME_MESSAGE };
    }
    throw err;
  }
}

// =====================================================================
// updateClientCore
// =====================================================================

export interface UpdateClientCoreInput {
  readonly clientId: string;
  readonly name?: string;
  readonly colorToken?: ClientColorToken;
  readonly initials?: string;
  readonly domains?: readonly string[];
  readonly notes?: string | null;
}

export type UpdateClientCoreResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly colorToken: string;
      readonly initials: string;
      readonly domains: readonly string[];
      readonly notes: string | null;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Only the keys present in `input` are written — `undefined` means "leave
 * untouched" (exactOptionalPropertyTypes-friendly conditional spread).
 * Returns the post-write, RELU state (mirrors `updateProjectCore`): the
 * caller — assistant tool or UI — gets back the value actually stored.
 */
export async function updateClientCore(
  ctx: AuthContext,
  input: UpdateClientCoreInput,
): Promise<UpdateClientCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(input.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  try {
    await prisma.client.update({
      where: {
        id: input.clientId,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.colorToken !== undefined ? { colorToken: input.colorToken } : {}),
        ...(input.initials !== undefined ? { initials: input.initials } : {}),
        ...(input.domains !== undefined ? { domains: [...input.domains] } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return { ok: false, message: DUPLICATE_NAME_MESSAGE };
      if (err.code === 'P2025') throw new NotFoundError('Client');
    }
    throw err;
  }

  await recordAudit({
    action: 'client_updated',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'client',
    subjectId: input.clientId,
  });

  // Lecture-après-écriture : le post-état est RELU plutôt qu'assemblé depuis
  // l'input, pour refléter la valeur réellement stockée.
  const after = await prisma.client.findFirst({
    where: { id: input.clientId, workspaceId: ctx.workspaceId },
    select: { name: true, colorToken: true, initials: true, domains: true, notes: true },
  });
  if (after === null) throw new NotFoundError('Client');

  return {
    ok: true,
    name: after.name,
    colorToken: after.colorToken,
    initials: after.initials,
    domains: after.domains,
    notes: after.notes,
  };
}

// =====================================================================
// deleteClientCore
// =====================================================================

export interface DeleteClientCoreInput {
  readonly clientId: string;
  /**
   * Optional request context for the audit trail. The Server Action wrapper
   * (browser navigation, has `next/headers`) supplies these; callers without
   * a request (e.g. the assistant tool loop) simply omit them and the audit
   * entry is recorded with `ip`/`userAgent` set to `null`.
   */
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export type DeleteClientCoreResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Soft-delete a client (ADR §10 #14): refused if any active project is
 * still attached. Contacts cascade-soft-delete via the same `deletedAt`
 * stamp, in the SAME transaction as the client, so the count updates
 * immediately in the sidebar and there is no window with orphaned "active"
 * contacts on a deleted client.
 */
export async function deleteClientCore(
  ctx: AuthContext,
  input: DeleteClientCoreInput,
): Promise<DeleteClientCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      _count: {
        select: { projects: { where: { deletedAt: null, archivedAt: null } } },
      },
    },
  });
  if (!client) {
    return { ok: false, message: 'Client introuvable.' };
  }

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(input.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  const guard = canDeleteClient({ activeProjectsCount: client._count.projects });
  if (!guard.ok) {
    return {
      ok: false,
      message:
        guard.activeProjectsCount === 1
          ? 'Suppression impossible : 1 projet actif est encore attaché à ce client.'
          : `Suppression impossible : ${guard.activeProjectsCount} projets actifs sont encore attachés à ce client.`,
    };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { clientId: input.clientId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.client.update({
      where: { id: input.clientId },
      data: { deletedAt: now },
    }),
  ]);

  await recordAudit({
    action: 'client_deleted',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'client',
    subjectId: input.clientId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { ok: true };
}

// =====================================================================
// createContactCore
// =====================================================================

export type CreateContactCoreResult =
  | { readonly ok: true; readonly contactId: string }
  | { readonly ok: false; readonly message: string };

export async function createContactCore(
  ctx: AuthContext,
  input: CreateContactInput,
): Promise<CreateContactCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  // Defence in depth: confirm the client belongs to this workspace.
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError('Client');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(input.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  const created = await prisma.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      clientId: input.clientId,
      firstName: input.name.firstName,
      lastName: input.name.lastName,
      jobTitle: input.jobTitle,
      email: input.email,
      phone: input.phone,
      raci: input.raci ?? null,
      notes: input.notes,
    },
    select: { id: true },
  });

  await recordAudit({
    action: 'contact_created',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'contact',
    subjectId: created.id,
  });

  return { ok: true, contactId: created.id };
}

// =====================================================================
// updateContactCore
// =====================================================================

export interface UpdateContactCoreInput {
  readonly contactId: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly jobTitle?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  /** Nullable RACI (also consumed by the future `set_contact_raci` tool). */
  readonly raci?: Raci | null;
  readonly notes?: string | null;
}

export type UpdateContactCoreResult =
  | {
      readonly ok: true;
      readonly firstName: string;
      readonly lastName: string;
      readonly raci: Raci | null;
      readonly email: string | null;
    }
  | { readonly ok: false; readonly message: string };

export async function updateContactCore(
  ctx: AuthContext,
  input: UpdateContactCoreInput,
): Promise<UpdateContactCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!contact) return { ok: false, message: 'Contact introuvable.' };

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(contact.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  try {
    await prisma.contact.update({
      where: {
        id: input.contactId,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.raci !== undefined ? { raci: input.raci } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new NotFoundError('Contact');
    }
    throw err;
  }

  await recordAudit({
    action: 'contact_updated',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'contact',
    subjectId: input.contactId,
  });

  const after = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: ctx.workspaceId },
    select: { firstName: true, lastName: true, raci: true, email: true },
  });
  if (after === null) throw new NotFoundError('Contact');

  return {
    ok: true,
    firstName: after.firstName,
    lastName: after.lastName,
    raci: after.raci,
    email: after.email,
  };
}

// =====================================================================
// deleteContactCore
// =====================================================================

export type DeleteContactCoreResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function deleteContactCore(
  ctx: AuthContext,
  input: { readonly contactId: string },
): Promise<DeleteContactCoreResult> {
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!contact) return { ok: false, message: 'Contact introuvable.' };

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(contact.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  await prisma.contact.updateMany({
    where: {
      id: input.contactId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  await recordAudit({
    action: 'contact_deleted',
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    subjectType: 'contact',
    subjectId: input.contactId,
  });

  return { ok: true };
}
