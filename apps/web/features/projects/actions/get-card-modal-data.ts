'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { validateCardTemplateItems, type CardTemplateItem, type Raci } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE } from '../lib/scope-error';

const Schema = z.object({ cardId: z.string().uuid() });

export interface CardModalData {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string | null;
  readonly shortRef: number;
  readonly categoryTag: string | null;
  readonly columnName: string;
  readonly columnIsBlocked: boolean;
  readonly nextColumnName: string | null;
  readonly fieldValues: Record<string, string>;
  readonly checklist: readonly {
    readonly id: string;
    readonly title: string;
    readonly isChecked: boolean;
    readonly position: number;
    readonly columnSourceId: string | null;
  }[];
  /** Column the card is currently in — used to filter the step-checklist
   *  items (only the current column's are visible). */
  readonly columnId: string;
  readonly assignees: readonly {
    readonly userId: string;
    readonly raci: Raci;
    readonly displayName: string;
    readonly initials: string;
  }[];
  readonly templateId: string | null;
  readonly templateItems: readonly CardTemplateItem[];
}

/**
 * Fetch the full payload the CardModal needs, in a single round-trip.
 * Mirrors the openCard branch of /projects/[id]/page.tsx but is callable
 * from the client so the modal can mount instantly (from the row data
 * already known to the board) and fill in the detail asynchronously,
 * instead of waiting for a full page RSC re-render on every open.
 */
export async function getCardModalData(input: {
  cardId: string;
}): Promise<{ ok: true; data: CardModalData } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant carte invalide.' };

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      columnId: true,
      title: true,
      description: true,
      dueDate: true,
      shortRef: true,
      categoryTag: true,
      fieldValues: true,
      column: { select: { name: true, isBlockedSystem: true } },
      checklistItems: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          title: true,
          isChecked: true,
          position: true,
          columnSourceId: true,
        },
      },
      assignees: {
        select: {
          userId: true,
          raci: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
      templateId: true,
      template: { select: { items: true } },
      project: { select: { clientId: true } },
    },
  });
  if (!card) return { ok: false, message: 'Carte introuvable.' };

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(card.projectId) || scope.clientIds.includes(card.project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }

  // Lookup the project's user-columns to compute the next-column hint
  // shown by the auto-advance bandeau (PRD §8.2). System "Bloqué" excluded.
  const columns = await prisma.column.findMany({
    where: { projectId: card.projectId },
    orderBy: { position: 'asc' },
    select: { name: true, isBlockedSystem: true },
  });
  const userCols = columns.filter((c) => !c.isBlockedSystem);
  const idx = userCols.findIndex((c) => c.name === card.column.name);
  const nextColumnName =
    idx >= 0 && idx < userCols.length - 1 ? (userCols[idx + 1]?.name ?? null) : null;

  const fieldValues =
    card.fieldValues && typeof card.fieldValues === 'object' && !Array.isArray(card.fieldValues)
      ? (Object.fromEntries(
          Object.entries(card.fieldValues as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string',
          ),
        ) as Record<string, string>)
      : {};

  const templateItems = validateCardTemplateItems(card.template?.items ?? []) ?? [];

  return {
    ok: true,
    data: {
      id: card.id,
      title: card.title,
      description: card.description,
      dueDate: card.dueDate ? card.dueDate.toISOString() : null,
      shortRef: card.shortRef,
      categoryTag: card.categoryTag,
      columnId: card.columnId,
      columnName: card.column.name,
      columnIsBlocked: card.column.isBlockedSystem,
      nextColumnName,
      fieldValues,
      checklist: card.checklistItems,
      assignees: card.assignees.map((a) => {
        const displayName =
          [a.user.firstName, a.user.lastName]
            .filter((s): s is string => Boolean(s))
            .join(' ')
            .trim() || a.user.email;
        const initials =
          [a.user.firstName?.[0], a.user.lastName?.[0]]
            .filter((c): c is string => Boolean(c))
            .join('')
            .toUpperCase() || a.user.email.slice(0, 2).toUpperCase();
        return {
          userId: a.userId,
          raci: a.raci as Raci,
          displayName,
          initials,
        };
      }),
      templateId: card.templateId,
      templateItems,
    },
  };
}
