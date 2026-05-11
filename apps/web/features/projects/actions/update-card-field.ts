'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { NotFoundError, validateCardTemplateItems } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

const Schema = z.object({
  cardId: z.string().uuid(),
  fieldId: z.string().min(1).max(64),
  value: z.string().max(8000),
});

/**
 * Update a single template-field value on a card. Validates that the
 * field id is actually defined on the card's template (defence in depth
 * against an attacker writing arbitrary keys). The full `field_values`
 * object is rewritten in one statement using Postgres jsonb_set
 * semantics through Prisma.
 */
export async function updateCardField(input: {
  cardId: string;
  fieldId: string;
  value: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Données invalides.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      fieldValues: true,
      template: { select: { items: true } },
    },
  });
  if (!card) throw new NotFoundError('Card');

  const items = validateCardTemplateItems(card.template?.items ?? []) ?? [];
  const def = items.find(
    (it) => it.id === parsed.data.fieldId && it.type !== 'section' && it.type !== 'description',
  );
  if (!def) {
    return { ok: false, message: 'Ce champ n’existe pas dans le template de la carte.' };
  }
  const v = parsed.data.value;
  if (v.length > 0) {
    if (def.type === 'select') {
      if (!def.options || !def.options.includes(v)) {
        return { ok: false, message: 'Valeur invalide pour ce champ.' };
      }
    } else if (def.type === 'checkbox') {
      if (v !== 'true' && v !== 'false') {
        return { ok: false, message: 'Valeur invalide pour une case à cocher.' };
      }
    } else if (def.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) {
        return { ok: false, message: 'Date invalide (AAAA-MM-JJ).' };
      }
    } else if (def.type === 'number') {
      if (Number.isNaN(Number(v))) {
        return { ok: false, message: 'Nombre invalide.' };
      }
    }
  }

  const current =
    card.fieldValues && typeof card.fieldValues === 'object' && !Array.isArray(card.fieldValues)
      ? (card.fieldValues as Record<string, unknown>)
      : {};
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (k === parsed.data.fieldId) continue; // overwritten or cleared below
    if (typeof v === 'string') next[k] = v;
  }
  if (parsed.data.value.length > 0) {
    next[parsed.data.fieldId] = parsed.data.value;
  }

  await prisma.card.update({
    where: { id: card.id },
    data: { fieldValues: next },
  });

  revalidatePath(`/projects/${card.projectId}`);
  return { ok: true };
}
