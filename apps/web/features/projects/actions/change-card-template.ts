'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import {
  NotFoundError,
  validateCardTemplateItems,
  pruneFieldValuesByItems,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

const Schema = z.object({
  cardId: z.string().uuid(),
  templateId: z.string().uuid().or(z.literal('')),
});

export async function changeCardTemplate(input: {
  cardId: string;
  templateId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, projectId: true, fieldValues: true },
  });
  if (!card) throw new NotFoundError('Card');

  let newTemplateId: string | null = null;
  let newItems: ReturnType<typeof validateCardTemplateItems> = [];
  if (parsed.data.templateId.length > 0) {
    const tpl = await prisma.cardTemplate.findFirst({
      where: { id: parsed.data.templateId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, items: true },
    });
    if (!tpl) return { ok: false, message: 'Template introuvable.' };
    newTemplateId = tpl.id;
    newItems = validateCardTemplateItems(tpl.items) ?? [];
  }

  const currentValues =
    card.fieldValues && typeof card.fieldValues === 'object' && !Array.isArray(card.fieldValues)
      ? (card.fieldValues as Record<string, unknown>)
      : {};
  const prunedValues = pruneFieldValuesByItems(currentValues, newItems ?? []);

  // If the new template doesn't include a checklist item, the card's
  // checklist becomes orphan and the modal would hide it anyway. Drop
  // the rows so we don't leave dangling data in the DB.
  const newHasChecklist = (newItems ?? []).some((it) => it.type === 'checklist');

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: card.id },
      data: {
        templateId: newTemplateId,
        fieldValues: prunedValues,
      },
    });
    if (!newHasChecklist) {
      await tx.checklistItem.deleteMany({ where: { cardId: card.id } });
    }
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
