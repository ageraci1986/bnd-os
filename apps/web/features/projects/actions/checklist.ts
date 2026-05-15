'use server';
import 'server-only';
import { prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE } from '../lib/scope-error';
import {
  CreateChecklistItemSchema,
  DeleteChecklistItemSchema,
  ToggleChecklistItemSchema,
} from '../lib/checklist-schemas';

/**
 * The 1.8s auto-advance timer (PRD §8.2) lives client-side: the modal
 * starts a timer when the user ticks the last unchecked item and
 * cancels it if they untick before the deadline. Once the timer fires
 * the client calls `advanceCard` (sibling action). These three actions
 * only persist the toggle/create/delete state.
 */

export interface ChecklistItemDTO {
  readonly id: string;
  readonly title: string;
  readonly isChecked: boolean;
  readonly position: number;
  /** Set when the item was seeded by a column's step-checklist; null
   *  for regular template-driven items owned by the card. */
  readonly columnSourceId: string | null;
}

export interface ChecklistMutationResult {
  readonly ok: true;
  readonly items: readonly ChecklistItemDTO[];
  /** True when every item is checked AND the list is non-empty. */
  readonly allChecked: boolean;
}

async function loadCardOrThrow(workspaceId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, workspaceId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: { clientId: true } } },
  });
  if (!card) throw new NotFoundError('Card');
  return card;
}

async function readChecklist(cardId: string): Promise<ChecklistMutationResult> {
  const items = await prisma.checklistItem.findMany({
    where: { cardId },
    orderBy: { position: 'asc' },
    select: { id: true, title: true, isChecked: true, position: true, columnSourceId: true },
  });
  const allChecked = items.length > 0 && items.every((i) => i.isChecked);
  return { ok: true, items, allChecked };
}

export async function createChecklistItem(input: {
  cardId: string;
  title: string;
}): Promise<ChecklistMutationResult> {
  const ctx = await requireUser();
  const parsed = CreateChecklistItemSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');

  const card = await loadCardOrThrow(ctx.workspaceId, parsed.data.cardId);

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) throw new Error(SCOPE_ERROR_MESSAGE);
  }

  const last = await prisma.checklistItem.findFirst({
    where: { cardId: card.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1024;

  await prisma.checklistItem.create({
    data: { cardId: card.id, title: parsed.data.title, position },
  });

  // No revalidatePath: checklist items live only in the modal. The action
  // returns the fresh list so the modal updates instantly; revalidating
  // here would refetch the entire board for nothing visible there.
  return readChecklist(card.id);
}

export async function toggleChecklistItem(input: {
  itemId: string;
  isChecked: boolean;
}): Promise<ChecklistMutationResult> {
  const ctx = await requireUser();
  const parsed = ToggleChecklistItemSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');

  // Workspace-scoped lookup via the card join.
  const item = await prisma.checklistItem.findFirst({
    where: { id: parsed.data.itemId, card: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: {
      id: true,
      cardId: true,
      card: { select: { projectId: true, project: { select: { clientId: true } } } },
    },
  });
  if (!item) throw new NotFoundError('ChecklistItem');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(item.card.projectId) ||
      scope.clientIds.includes(item.card.project.clientId);
    if (!allowed) throw new Error(SCOPE_ERROR_MESSAGE);
  }

  await prisma.checklistItem.update({
    where: { id: item.id },
    data: { isChecked: parsed.data.isChecked },
  });

  // No revalidatePath: see createChecklistItem above. Auto-advance, when
  // it fires after the last toggle, has its own revalidatePath because
  // it actually moves the card across columns (board change).
  return readChecklist(item.cardId);
}

export async function deleteChecklistItem(input: {
  itemId: string;
}): Promise<ChecklistMutationResult> {
  const ctx = await requireUser();
  const parsed = DeleteChecklistItemSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides.');

  const item = await prisma.checklistItem.findFirst({
    where: { id: parsed.data.itemId, card: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: {
      id: true,
      cardId: true,
      card: { select: { projectId: true, project: { select: { clientId: true } } } },
    },
  });
  if (!item) throw new NotFoundError('ChecklistItem');

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(item.card.projectId) ||
      scope.clientIds.includes(item.card.project.clientId);
    if (!allowed) throw new Error(SCOPE_ERROR_MESSAGE);
  }

  await prisma.checklistItem.delete({ where: { id: item.id } });

  // No revalidatePath: see createChecklistItem above. Auto-advance, when
  // it fires after the last toggle, has its own revalidatePath because
  // it actually moves the card across columns (board change).
  return readChecklist(item.cardId);
}
