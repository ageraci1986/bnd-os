'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, Roles } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';

// Free-form so users can coin custom workspace-level categories.
const CategorySchema = z.string().trim().min(1).max(32).nullable();

// Each field is `.optional()` at the END of its chain so the parser leaves
// `undefined` untouched (= "not provided, don't update") rather than running
// the transform on undefined and producing `null`. This is what was nulling
// the description every time we saved a different field.
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
    .transform((v) => (v.trim().length > 0 ? v.trim() : null))
    .optional(),
  categoryTag: CategorySchema.optional(),
});

export type UpdateCardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function updateCard(input: {
  cardId: string;
  title?: string;
  description?: string;
  categoryTag?: string | null;
}): Promise<UpdateCardResult> {
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  }
  const parsed = UpdateCardSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');
  }

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: { clientId: true } } },
  });
  if (!card) throw new NotFoundError('Card');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) {
      return { ok: false, message: SCOPE_ERROR_MESSAGE };
    }
  }

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
