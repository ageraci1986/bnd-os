'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, validateCardFields, pruneFieldValues } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

const Schema = z.object({
  cardId: z.string().uuid(),
  /** Empty string clears the template (card becomes template-less). */
  templateId: z.string().uuid().or(z.literal('')),
});

/**
 * Switch the template attached to a card. Field values for ids that
 * survive in the new template are kept; everything else is pruned so
 * the modal doesn't show stale orphan values. The card's template_id
 * is updated; the new template's structured fields are resolved at
 * render time, no copy needed.
 */
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
  let newFields: ReturnType<typeof validateCardFields> = [];
  if (parsed.data.templateId.length > 0) {
    const tpl = await prisma.cardTemplate.findFirst({
      where: { id: parsed.data.templateId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, fields: true },
    });
    if (!tpl) return { ok: false, message: 'Template introuvable.' };
    newTemplateId = tpl.id;
    newFields = validateCardFields(tpl.fields) ?? [];
  }

  // Preserve values for fields that exist in the new template, drop the rest.
  const currentValues =
    card.fieldValues && typeof card.fieldValues === 'object' && !Array.isArray(card.fieldValues)
      ? (card.fieldValues as Record<string, unknown>)
      : {};
  const prunedValues = pruneFieldValues(currentValues, newFields ?? []);

  await prisma.card.update({
    where: { id: card.id },
    data: {
      templateId: newTemplateId,
      fieldValues: prunedValues,
    },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
