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

  // Defence in depth: project belongs to workspace, column belongs to project.
  const column = await prisma.column.findFirst({
    where: {
      id: columnId,
      project: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    },
    select: { id: true },
  });
  if (!column) throw new NotFoundError('Column');

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

  const created = await prisma.card.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId,
      columnId,
      title,
      position,
    },
    select: { id: true },
  });

  revalidatePath(`/projects/${projectId}`);
  return { status: 'success', cardId: created.id };
}
