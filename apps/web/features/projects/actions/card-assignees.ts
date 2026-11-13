'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, RACI_VALUES, Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';

/**
 * `instanceof Prisma.PrismaClientKnownRequestError` doesn't reliably hold
 * across Turbopack's RSC module boundary (Prisma is loaded twice and the
 * class identity diverges), so we sniff by error.code directly.
 */
function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

const RaciSchema = z.enum(RACI_VALUES);

const AddSchema = z.object({
  cardId: z.string().uuid(),
  userId: z.string().uuid(),
  raci: RaciSchema,
});

const UpdateSchema = z.object({
  cardId: z.string().uuid(),
  userId: z.string().uuid(),
  raci: RaciSchema,
});

const RemoveSchema = z.object({
  cardId: z.string().uuid(),
  userId: z.string().uuid(),
});

async function loadCardOrThrow(workspaceId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, workspaceId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: { clientId: true } } },
  });
  if (!card) throw new NotFoundError('Card');
  return card;
}

async function checkCardScope(
  ctx: Awaited<ReturnType<typeof requireUser>>,
  card: { projectId: string; project: { clientId: string } },
): Promise<{ ok: false; message: string } | null> {
  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
  return null;
}

/**
 * Assign a workspace member to a card with a RACI role. Several people may
 * share the same role (R/A/C/I) since 2026-11-13; the PK (card_id, user_id)
 * still gives each person a single role per card.
 */
export async function addCardAssignee(input: {
  cardId: string;
  userId: string;
  raci: (typeof RACI_VALUES)[number];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  const scopeErr = await checkCardScope(ctx, card);
  if (scopeErr) return scopeErr;

  // Defence in depth: only members of this workspace can be assigned.
  const member = await prisma.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: parsed.data.userId },
    select: { id: true },
  });
  if (!member) return { ok: false, message: 'Cet utilisateur n’appartient pas à l’espace.' };

  await prisma.cardAssignee.upsert({
    where: { cardId_userId: { cardId: card.id, userId: parsed.data.userId } },
    create: {
      cardId: card.id,
      userId: parsed.data.userId,
      raci: parsed.data.raci,
    },
    update: { raci: parsed.data.raci },
  });

  // No revalidatePath: assignees only show in the modal side rail, not
  // on the kanban card. The modal already updates optimistically.
  return { ok: true };
}

export async function updateCardAssigneeRaci(input: {
  cardId: string;
  userId: string;
  raci: (typeof RACI_VALUES)[number];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  const scopeErr = await checkCardScope(ctx, card);
  if (scopeErr) return scopeErr;

  try {
    await prisma.cardAssignee.update({
      where: {
        cardId_userId: { cardId: card.id, userId: parsed.data.userId },
      },
      data: { raci: parsed.data.raci },
    });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === 'P2025') return { ok: false, message: 'Assignation introuvable.' };
    throw err;
  }

  // No revalidatePath: assignees only show in the modal side rail, not
  // on the kanban card. The modal already updates optimistically.
  return { ok: true };
}

export async function removeCardAssignee(input: {
  cardId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  const scopeErr = await checkCardScope(ctx, card);
  if (scopeErr) return scopeErr;

  await prisma.cardAssignee.deleteMany({
    where: { cardId: card.id, userId: parsed.data.userId },
  });

  // No revalidatePath: assignees only show in the modal side rail, not
  // on the kanban card. The modal already updates optimistically.
  return { ok: true };
}
