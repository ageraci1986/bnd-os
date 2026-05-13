'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { NotFoundError, computeCardPosition, validateCardTemplateItems } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { CreateCardSchema } from '../lib/card-schemas';

export type CreateCardState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'success';
      readonly cardId: string;
      readonly shortRef: number;
      readonly title: string;
    }
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

  // Client may provide the desired UUID so it can open the modal
  // optimistically (same id on client + server, no waiting for round-trip).
  const proposedIdRaw = formData.get('proposedId');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const proposedId =
    typeof proposedIdRaw === 'string' && UUID_RE.test(proposedIdRaw) ? proposedIdRaw : null;

  // Three independent lookups in parallel — on remote Supabase each
  // round-trip is ~50-200ms, so serialising them used to stack up to
  // ~600ms before we even started the INSERT.
  const [column, template, siblings] = await Promise.all([
    // Defence in depth: project belongs to workspace, column belongs to project.
    prisma.column.findFirst({
      where: {
        id: columnId,
        project: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
      },
      select: { id: true },
    }),
    // Resolve the template to apply: explicit `?templateId=...` wins, otherwise
    // fall back to the workspace default. Either may be null (no template).
    prisma.cardTemplate.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        ...(explicitTemplateId ? { id: explicitTemplateId } : { isDefault: true }),
      },
      select: { id: true, body: true, defaultChecklist: true, items: true },
    }),
    // Append at the bottom: read the max position in this column.
    prisma.card.findMany({
      where: { columnId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { position: true },
    }),
  ]);
  if (!column) throw new NotFoundError('Column');

  const position = computeCardPosition({
    orderedSiblingPositions: siblings.map((s) => s.position),
    targetIndex: siblings.length,
  });

  const created = await prisma.$transaction(async (tx) => {
    const card = await tx.card.create({
      data: {
        ...(proposedId ? { id: proposedId } : {}),
        workspaceId: ctx.workspaceId,
        projectId,
        columnId,
        title,
        position,
        ...(template ? { templateId: template.id } : {}),
        ...(template && template.body.length > 0 ? { description: template.body } : {}),
      },
      select: { id: true, shortRef: true, title: true },
    });

    // The new model stores the default checklist as a `checklist` item
    // inside template.items. If the template does NOT include a
    // checklist item, the card is created without a pre-filled checklist
    // — the user explicitly opted out of it on this template.
    const templateItems = template ? (validateCardTemplateItems(template.items) ?? []) : [];
    const checklistItem = templateItems.find((it) => it.type === 'checklist');
    const defaults: readonly string[] =
      checklistItem && checklistItem.type === 'checklist' ? checklistItem.items : [];

    if (defaults.length > 0) {
      await tx.checklistItem.createMany({
        data: defaults.map((itemTitle, idx) => ({
          cardId: card.id,
          title: itemTitle,
          position: (idx + 1) * 1024,
          isChecked: false,
        })),
      });
    }

    return card;
  });

  // No revalidatePath: the client appends the new card to the board
  // optimistically (nx:card-created event) and opens the modal directly
  // — a full route re-render here would only delay the action response.
  return {
    status: 'success',
    cardId: created.id,
    shortRef: created.shortRef,
    title: created.title,
  };
}
