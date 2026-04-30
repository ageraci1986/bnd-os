'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

// Free-form so users can coin custom workspace-level categories.
const CategorySchema = z.string().trim().min(1).max(32).nullable();

const UpdateCardSchema = z.object({
  cardId: z.string().uuid(),
  title: z
    .string()
    .min(1, 'Titre requis')
    .max(200, 'Titre trop long')
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, 'Titre requis')
    .optional(),
  description: z
    .string()
    .max(8000)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  categoryTag: CategorySchema.optional(),
});

export interface UpdateCardResult {
  readonly ok: true;
}

export async function updateCard(input: {
  cardId: string;
  title?: string;
  description?: string;
  categoryTag?: string | null;
}): Promise<UpdateCardResult> {
  const ctx = await requireUser();
  const parsed = UpdateCardSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!card) throw new NotFoundError('Card');

  const data: { title?: string; description?: string | null; categoryTag?: string | null } = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.categoryTag !== undefined) data.categoryTag = parsed.data.categoryTag;

  if (Object.keys(data).length > 0) {
    await prisma.card.update({ where: { id: card.id }, data });
  }

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
