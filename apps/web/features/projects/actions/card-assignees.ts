'use server';
import 'server-only';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { NotFoundError, RACI_VALUES } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

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

function raciUniqueMessage(raci: (typeof RACI_VALUES)[number]): string {
  return raci === 'responsible'
    ? 'Une seule personne peut être Responsable. Réassignez le Responsable actuel d’abord.'
    : raci === 'approver'
      ? 'Une seule personne peut être Approbateur. Réassignez l’Approbateur actuel d’abord.'
      : 'Conflit d’unicité.';
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
    select: { id: true, projectId: true },
  });
  if (!card) throw new NotFoundError('Card');
  return card;
}

/**
 * Assign a workspace member to a card with a RACI role. The PG partial
 * unique indexes on `(card_id) WHERE raci = 'responsible'` and
 * `(card_id) WHERE raci = 'approver'` enforce at-most-one R / A per card;
 * we surface that as a friendly error.
 */
export async function addCardAssignee(input: {
  cardId: string;
  userId: string;
  raci: (typeof RACI_VALUES)[number];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  // Defence in depth: only members of this workspace can be assigned.
  const member = await prisma.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: parsed.data.userId },
    select: { id: true },
  });
  if (!member) return { ok: false, message: 'Cet utilisateur n’appartient pas à l’espace.' };

  try {
    await prisma.cardAssignee.upsert({
      where: { cardId_userId: { cardId: card.id, userId: parsed.data.userId } },
      create: {
        cardId: card.id,
        userId: parsed.data.userId,
        raci: parsed.data.raci,
      },
      update: { raci: parsed.data.raci },
    });
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: raciUniqueMessage(parsed.data.raci) };
    }
    throw err;
  }

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}

export async function updateCardAssigneeRaci(input: {
  cardId: string;
  userId: string;
  raci: (typeof RACI_VALUES)[number];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

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
    if (code === 'P2002') return { ok: false, message: raciUniqueMessage(parsed.data.raci) };
    throw err;
  }

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}

export async function removeCardAssignee(input: {
  cardId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  await prisma.cardAssignee.deleteMany({
    where: { cardId: card.id, userId: parsed.data.userId },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
