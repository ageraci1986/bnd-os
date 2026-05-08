'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { NotFoundError, computeCardPosition } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { CreateCardSchema } from '../lib/card-schemas';

export type CreateCardState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly cardId: string }
  | { readonly status: 'error'; readonly message: string };

export async function createCard(
  _prev: CreateCardState,
  formData: FormData,
): Promise<CreateCardState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateCardSchema.safeParse({
    projectId: formData.get('projectId'),
    columnId: formData.get('columnId'),
    title: formData.get('title'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }
  const { projectId, columnId, title } = parsed.data;
  const templateIdRaw = formData.get('templateId');
  const explicitTemplateId =
    typeof templateIdRaw === 'string' && templateIdRaw.length > 0 ? templateIdRaw : null;

  // Defence in depth: project belongs to workspace, column belongs to project.
  const column = await prisma.column.findFirst({
    where: {
      id: columnId,
      project: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    },
    select: { id: true },
  });
  if (!column) throw new NotFoundError('Column');

  // Resolve the template to apply: explicit `?templateId=...` wins, otherwise
  // fall back to the workspace default. Either may be null (no template).
  const template = await prisma.cardTemplate.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(explicitTemplateId ? { id: explicitTemplateId } : { isDefault: true }),
    },
    select: { body: true, defaultChecklist: true },
  });

  // Append at the bottom: read the max position in this column.
  const siblings = await prisma.card.findMany({
    where: { columnId, deletedAt: null },
    orderBy: { position: 'asc' },
    select: { position: true },
  });
  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });

  const created = await prisma.$transaction(async (tx) => {
    const card = await tx.card.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        columnId,
        title,
        position,
        ...(template && template.body.length > 0 ? { description: template.body } : {}),
      },
      select: { id: true },
    });

    if (template && template.defaultChecklist.length > 0) {
      await tx.checklistItem.createMany({
        data: template.defaultChecklist.map((itemTitle, idx) => ({
          cardId: card.id,
          title: itemTitle,
          position: (idx + 1) * 1024,
          isChecked: false,
        })),
      });
    }

    return card;
  });

  revalidatePath(`/projects/${projectId}`);
  return { status: 'success', cardId: created.id };
}
