'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@nexushub/db';
import {
  BLOCKED_COLUMN_NAME,
  BLOCKED_COLUMN_POSITION,
  BUILTIN_PROJECT_TYPES,
  Roles,
  buildProjectColumns,
  findTemplate,
  NotFoundError,
} from '@nexushub/domain';

/** UUID v4 ↔ built-in id discriminator. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '../lib/scope-error';
import { CreateProjectSchema } from '../lib/schemas';

export type CreateProjectState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Create a project (PRD §7 wizard). In a single Prisma transaction:
 *   1. ensure-or-create the ProjectType row (built-in id → upsert per workspace)
 *   2. insert the Project
 *   3. insert the Kanban columns from the chosen template + the system
 *      "Bloqué" column at position 9999 (PRD §6.4 + §8.3)
 *   4. add the creator as Lead (PRD §10 #5)
 * Then redirect to /projects/[id] which Phase 5.D.2 will turn into the
 * Kanban board.
 */
export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();
  if (ctx.role === Roles.Viewer) {
    return { status: 'error', message: VIEWER_READ_ONLY_MESSAGE };
  }

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get('name'),
    clientId: formData.get('clientId'),
    description: formData.get('description') ?? undefined,
    startDate: formData.get('startDate') ?? undefined,
    endDate: formData.get('endDate') ?? undefined,
    typeId: formData.get('typeId') === '' ? null : (formData.get('typeId') ?? null),
    templateId: formData.get('templateId'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }
  const data = parsed.data;

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(data.clientId);
    if (!allowed) {
      return { status: 'error', message: SCOPE_ERROR_MESSAGE };
    }
  }

  // Defence in depth: confirm the client belongs to this workspace.
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError('Client');

  // Templates are EITHER a hard-coded built-in (string id like 'creative')
  // OR a workspace-defined DB template (UUID). Resolve to a uniform list
  // of column seeds with optional stepChecklist.
  interface ColumnSeed {
    readonly name: string;
    readonly position: number;
    readonly isBlockedSystem: boolean;
    readonly stepChecklist: readonly string[];
  }
  let columnSeeds: readonly ColumnSeed[];
  // Snapshot of the Kanban template's card-template override at
  // project-creation time (PRD §7.2: templates are frozen). Built-in
  // Kanban templates have no override, so this stays null in that path.
  let defaultCardTemplateIdSnapshot: string | null = null;

  if (UUID_RE.test(data.templateId)) {
    const dbTpl = await prisma.kanbanTemplate.findFirst({
      where: { id: data.templateId, workspaceId: ctx.workspaceId },
      select: {
        id: true,
        defaultCardTemplateId: true,
        columns: {
          orderBy: { position: 'asc' },
          select: { name: true, stepChecklist: true },
        },
      },
    });
    if (!dbTpl) {
      return { status: 'error', message: 'Template Kanban introuvable.' };
    }
    defaultCardTemplateIdSnapshot = dbTpl.defaultCardTemplateId;
    const userCols: ColumnSeed[] = dbTpl.columns.map((c, idx) => ({
      name: c.name,
      position: (idx + 1) * 1024,
      isBlockedSystem: false,
      stepChecklist: c.stepChecklist,
    }));
    columnSeeds = [
      ...userCols,
      {
        name: BLOCKED_COLUMN_NAME,
        position: BLOCKED_COLUMN_POSITION,
        isBlockedSystem: true,
        stepChecklist: [],
      },
    ];
  } else {
    const builtin = findTemplate(data.templateId);
    if (!builtin) {
      return { status: 'error', message: 'Template Kanban inconnu.' };
    }
    columnSeeds = buildProjectColumns(builtin).map((c) => ({
      ...c,
      stepChecklist: [],
    }));
  }

  let projectId: string;
  try {
    projectId = await prisma.$transaction(async (tx) => {
      // 1. Ensure-or-create the built-in ProjectType for this workspace.
      let typeRowId: string | null = null;
      if (data.typeId) {
        const builtin = BUILTIN_PROJECT_TYPES.find((t) => t.id === data.typeId);
        if (builtin) {
          const existing = await tx.projectType.findUnique({
            where: {
              workspaceId_name: { workspaceId: ctx.workspaceId, name: builtin.name },
            },
            select: { id: true },
          });
          if (existing) {
            typeRowId = existing.id;
          } else {
            const created = await tx.projectType.create({
              data: {
                workspaceId: ctx.workspaceId,
                name: builtin.name,
                icon: builtin.icon,
                description: builtin.description,
                isBuiltin: true,
              },
              select: { id: true },
            });
            typeRowId = created.id;
          }
        }
      }

      // 2. Insert the project.
      const project = await tx.project.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId: data.clientId,
          ...(typeRowId ? { typeId: typeRowId } : {}),
          ...(defaultCardTemplateIdSnapshot
            ? { defaultCardTemplateId: defaultCardTemplateIdSnapshot }
            : {}),
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          ...(data.startDate ? { startDate: data.startDate } : {}),
          ...(data.endDate ? { endDate: data.endDate } : {}),
        },
        select: { id: true },
      });

      // 3. Insert the columns (user columns + system Bloqué). Step
      //    checklists are copied as TEXT[] on the Column itself; cards
      //    that later land in the column will get ChecklistItem rows
      //    seeded from this list.
      await tx.column.createMany({
        data: columnSeeds.map((c) => ({
          projectId: project.id,
          name: c.name,
          position: c.position,
          isBlockedSystem: c.isBlockedSystem,
          stepChecklist: [...c.stepChecklist],
        })),
      });

      // 4. Add the creator as Lead (PRD §10 #5).
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: ctx.userId,
          role: 'lead',
        },
      });

      return project.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'error', message: 'Un projet porte déjà ce nom.' };
    }
    throw err;
  }

  revalidatePath('/projects');
  revalidatePath('/(app)/layout', 'layout');
  redirect(`/projects/${projectId}`);
}
