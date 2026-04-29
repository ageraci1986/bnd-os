'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@nexushub/db';
import {
  BUILTIN_PROJECT_TYPES,
  buildProjectColumns,
  findTemplate,
  NotFoundError,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
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

  // Defence in depth: confirm the client belongs to this workspace.
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError('Client');

  const template = findTemplate(data.templateId);
  if (!template) {
    return { status: 'error', message: 'Template Kanban inconnu.' };
  }

  const columnSeeds = buildProjectColumns(template);

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
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          ...(data.startDate ? { startDate: data.startDate } : {}),
          ...(data.endDate ? { endDate: data.endDate } : {}),
        },
        select: { id: true },
      });

      // 3. Insert the columns (user columns + system Bloqué).
      await tx.column.createMany({
        data: columnSeeds.map((c) => ({
          projectId: project.id,
          name: c.name,
          position: c.position,
          isBlockedSystem: c.isBlockedSystem,
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
