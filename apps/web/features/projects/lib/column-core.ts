import 'server-only';
import { prisma } from '@nexushub/db';
import { BLOCKED_COLUMN_POSITION, NotFoundError, Roles } from '@nexushub/domain';
import type { AuthContext } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from './scope-error';

const BLOCKED_LOCKED_MESSAGE =
  'La colonne « Bloqué » est gérée par le système et ne peut pas être modifiée.';
const REORDER_MISMATCH_MESSAGE =
  'La liste doit contenir exactement toutes les colonnes du projet (hors « Bloqué »), sans doublon.';
const DELETE_LAST_COLUMN_MESSAGE = 'Impossible de supprimer la dernière colonne du projet.';
const NAME_REQUIRED_MESSAGE = 'Nom de colonne requis.';
const POSITION_STEP = 1000;

export interface ColumnSnapshot {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}
type Ok<T> = { readonly ok: true } & T;
interface Err {
  readonly ok: false;
  readonly message: string;
}

export interface AddColumnCoreInput {
  readonly projectId: string;
  readonly name: string;
}

export interface RenameColumnCoreInput {
  readonly columnId: string;
  readonly name: string;
}

export interface ReorderColumnsCoreInput {
  readonly projectId: string;
  readonly orderedColumnIds: readonly string[];
}

export interface DeleteColumnCoreInput {
  readonly columnId: string;
}

/** Post-état : colonnes du projet, ordonnées, Bloqué incluse. */
async function readColumns(projectId: string): Promise<ColumnSnapshot[]> {
  return prisma.column.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, position: true },
  });
}

/** Guards communs : rôle non-Viewer, projet du workspace, scope. */
async function guardProject(ctx: AuthContext, projectId: string): Promise<{ ok: true } | Err> {
  if (ctx.role === Roles.Viewer) return { ok: false, message: VIEWER_READ_ONLY_MESSAGE };
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!project) throw new NotFoundError('Project');
  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed =
      scope.projectIds.includes(project.id) || scope.clientIds.includes(project.clientId);
    if (!allowed) return { ok: false, message: SCOPE_ERROR_MESSAGE };
  }
  return { ok: true };
}

export async function addColumnCore(
  ctx: AuthContext,
  input: AddColumnCoreInput,
): Promise<Ok<{ columnId: string; columns: ColumnSnapshot[] }> | Err> {
  const guard = await guardProject(ctx, input.projectId);
  if (!guard.ok) return guard;

  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, message: NAME_REQUIRED_MESSAGE };
  }

  // Insert just before the always-last "Bloqué" system column
  // (BLOCKED_COLUMN_POSITION = 9999): take the current max position among
  // non-system columns and add one step.
  const [top] = await prisma.column.findMany({
    where: { projectId: input.projectId, isBlockedSystem: false },
    orderBy: { position: 'desc' },
    take: 1,
    select: { position: true },
  });
  const candidate = (top?.position ?? 0) + POSITION_STEP;

  if (candidate < BLOCKED_COLUMN_POSITION) {
    const created = await prisma.column.create({
      data: { projectId: input.projectId, name, position: candidate, isBlockedSystem: false },
      select: { id: true },
    });
    return { ok: true, columnId: created.id, columns: await readColumns(input.projectId) };
  }

  // Overflow guard (CLAUDE.md §6.3): naively appending would place the new
  // column at/after Bloqué's fixed position 9999, making it render AFTER the
  // system column in every position-ordered view. Compact instead: renumber
  // the existing non-system columns with an even step that keeps every
  // position — including the new column's — strictly below 9999, then create
  // the new column, all in one transaction. Bloqué itself is never touched
  // (the renumbering only reads and updates isBlockedSystem: false rows).
  const nonSystem = await prisma.column.findMany({
    where: { projectId: input.projectId, isBlockedSystem: false },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  const count = nonSystem.length;
  const step = Math.max(1, Math.floor(BLOCKED_COLUMN_POSITION / (count + 2)));

  const results = await prisma.$transaction([
    ...nonSystem.map((c, index) =>
      prisma.column.update({ where: { id: c.id }, data: { position: (index + 1) * step } }),
    ),
    prisma.column.create({
      data: {
        projectId: input.projectId,
        name,
        position: (count + 1) * step,
        isBlockedSystem: false,
      },
      select: { id: true },
    }),
  ]);
  const created = results[results.length - 1] as { id: string };

  return { ok: true, columnId: created.id, columns: await readColumns(input.projectId) };
}

export async function renameColumnCore(
  ctx: AuthContext,
  input: RenameColumnCoreInput,
): Promise<Ok<{ name: string }> | Err> {
  // Defence in depth: the column must belong to a (non-deleted) project of
  // the caller's workspace.
  const column = await prisma.column.findFirst({
    where: { id: input.columnId, project: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: { id: true, projectId: true, isBlockedSystem: true },
  });
  if (!column) throw new NotFoundError('Column');

  const guard = await guardProject(ctx, column.projectId);
  if (!guard.ok) return guard;

  if (column.isBlockedSystem) {
    return { ok: false, message: BLOCKED_LOCKED_MESSAGE };
  }

  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, message: NAME_REQUIRED_MESSAGE };
  }

  const updated = await prisma.column.update({
    where: { id: column.id },
    data: { name },
    select: { name: true },
  });

  return { ok: true, name: updated.name };
}

export async function reorderColumnsCore(
  ctx: AuthContext,
  input: ReorderColumnsCoreInput,
): Promise<Ok<{ columns: ColumnSnapshot[] }> | Err> {
  const guard = await guardProject(ctx, input.projectId);
  if (!guard.ok) return guard;

  const columns = await prisma.column.findMany({
    where: { projectId: input.projectId },
    select: { id: true, isBlockedSystem: true },
  });

  const blockedIds = new Set(columns.filter((c) => c.isBlockedSystem).map((c) => c.id));
  if (input.orderedColumnIds.some((id) => blockedIds.has(id))) {
    return { ok: false, message: BLOCKED_LOCKED_MESSAGE };
  }

  const nonSystemIds = columns.filter((c) => !c.isBlockedSystem).map((c) => c.id);
  const providedSet = new Set(input.orderedColumnIds);
  const isExactMatch =
    providedSet.size === input.orderedColumnIds.length &&
    providedSet.size === nonSystemIds.length &&
    nonSystemIds.every((id) => providedSet.has(id));
  if (!isExactMatch) {
    return { ok: false, message: REORDER_MISMATCH_MESSAGE };
  }

  const updates = input.orderedColumnIds.map((id, index) =>
    prisma.column.update({ where: { id }, data: { position: (index + 1) * POSITION_STEP } }),
  );
  await prisma.$transaction(updates);

  return { ok: true, columns: await readColumns(input.projectId) };
}

export async function deleteColumnCore(
  ctx: AuthContext,
  input: DeleteColumnCoreInput,
): Promise<Ok<{ movedCards: number; movedTo: string | null; columns: ColumnSnapshot[] }> | Err> {
  const column = await prisma.column.findFirst({
    where: { id: input.columnId, project: { workspaceId: ctx.workspaceId, deletedAt: null } },
    select: { id: true, projectId: true, isBlockedSystem: true },
  });
  if (!column) throw new NotFoundError('Column');

  const guard = await guardProject(ctx, column.projectId);
  if (!guard.ok) return guard;

  if (column.isBlockedSystem) {
    return { ok: false, message: BLOCKED_LOCKED_MESSAGE };
  }

  const [target, cards] = await Promise.all([
    // First non-system column of the project other than this one, in
    // display order — the fallback destination for its cards.
    prisma.column.findFirst({
      where: { projectId: column.projectId, isBlockedSystem: false, NOT: { id: column.id } },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.card.findMany({
      where: { columnId: column.id, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    }),
  ]);

  if (!target) {
    return { ok: false, message: DELETE_LAST_COLUMN_MESSAGE };
  }

  const cardUpdates =
    cards.length > 0
      ? await (async () => {
          const [topTargetCard] = await prisma.card.findMany({
            where: { columnId: target.id, deletedAt: null },
            orderBy: { position: 'desc' },
            take: 1,
            select: { position: true },
          });
          const base = (topTargetCard?.position ?? 0) + POSITION_STEP;
          return cards.map((card, index) =>
            prisma.card.update({
              where: { id: card.id },
              data: { columnId: target.id, position: base + index * POSITION_STEP },
            }),
          );
        })()
      : [];

  // `Card.previousColumnId` (packages/db/prisma/schema.prisma ~l.482) is a
  // plain scalar column with NO `@relation`/FK declared — Postgres will
  // neither cascade nor null it out when the referenced column disappears.
  // Cards currently parked in "Bloqué" whose previousColumnId points at the
  // column being deleted must be re-pointed to the fallback column so
  // `shouldRestoreFromBlocked` (packages/domain/src/kanban/index.ts) can
  // still send them somewhere valid once unblocked. Harmless no-op when no
  // card references this column.
  const previousColumnRerouting = prisma.card.updateMany({
    // workspaceId is redundant here (the column lookup is already
    // workspace-scoped) but kept per CLAUDE.md §4.4: every Prisma query
    // includes workspace_id systematically — Card carries it denormalised.
    where: { workspaceId: ctx.workspaceId, previousColumnId: column.id },
    data: { previousColumnId: target.id },
  });

  await prisma.$transaction([
    ...cardUpdates,
    previousColumnRerouting,
    prisma.column.delete({ where: { id: column.id } }),
  ]);

  return {
    ok: true,
    movedCards: cards.length,
    movedTo: cards.length > 0 ? target.name : null,
    columns: await readColumns(column.projectId),
  };
}
